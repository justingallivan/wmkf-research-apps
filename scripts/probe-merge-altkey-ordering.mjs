#!/usr/bin/env node
/**
 * NON-MOCKED ALT-KEY ORDERING PROBE (S290, reviewer-merge chunk 5 / O8).
 *
 * PROD-WRITE, REVERSIBLE. Exercises the REAL Dataverse alternate-key ordering that
 * mocked adapters cannot reproduce — the exact bug class the chunk 1–4 Codex passes
 * kept catching. Design: docs/REVIEWER_MERGE_DESIGN.md §"Chunk 5" + O8.
 *
 *   node scripts/probe-merge-altkey-ordering.mjs            # plan-only (NO writes)
 *   node scripts/probe-merge-altkey-ordering.mjs --run      # real run + auto-cleanup
 *   node scripts/probe-merge-altkey-ordering.mjs --run --keep   # real run, leave rows
 *   node scripts/probe-merge-altkey-ordering.mjs cleanup    # teardown from state file
 *   node scripts/probe-merge-altkey-ordering.mjs cleanup --person <guid>   # GUID fallback
 *
 * THREE sub-probes (each on its own throwaway rows):
 *   A — wmkf_emailaddress_unique: setting keeper.email to loser's email WITHOUT
 *       clearing the loser first must 412; the REAL error must round-trip through
 *       the shared translateDuplicateKeyError (the load-bearing my-candidates 409
 *       path); then clear-then-set must succeed.
 *   B — (person,request) alt-key on wmkf_appreviewersuggestion: repointing a loser
 *       suggestion into a request the keeper already occupies must fail on the key
 *       (justifying the merge's delete-collision design); a non-colliding repoint
 *       must succeed.
 *   C — end-to-end executeMerge: collision-delete + email-move + deactivate, with
 *       a pre-merge plan assertion (blocked=false, 1 collision, 0 repoint, etag set).
 *
 * SAFETY (mirrors scripts/smoke-test-candidate.mjs):
 *   - Only ever DELETE rows whose GUIDs we recorded creating (written to the state
 *     file IMMEDIATELY at create, so a crash is recoverable via `cleanup`).
 *   - Teardown reads each person first and REFUSES to delete unless its (normalized)
 *     wmkf_name CONTAINS the marker. Suggestions are deleted ONLY inside that
 *     marker-gated teardown. Nothing ever stamps the marker on a real record, so the
 *     gate can only block a wrong delete, never cause one.
 *   - create refuses any email already present as a real potential-reviewer OR a CRM
 *     contact (synthetic `.invalid` addresses, never deliverable).
 *   - --run cleanup runs in a `finally` (so an assertion failure still tears down)
 *     unless --keep is passed (which prints a loud notice + the recovery command).
 *   - Uses request 1002788 (the dedicated test request) only — never a real grant —
 *     and never promotes a contact, so there is no un-deletable orphan class.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const MARKER_FIRST = 'ZZZ Merge';
const MARKER_LAST = 'Probe (DELETE)';
const MARKER_NAME = 'ZZZ Merge Probe (DELETE)';
const TEST_REQUEST_NUM = '1002788';
const PR_ENTITY = 'wmkf_potentialreviewerses';
const SUG_ENTITY = 'wmkf_appreviewersuggestions';
const STATE_PATH = path.join(__dirname, '.merge-probe-altkey.json');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const suggestion = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const contact = await import('../lib/dataverse/adapters/contact.js');
const { planMerge, executeMerge } = await import('../lib/services/reviewer-merge.js');
const { translateDuplicateKeyError } = await import('../lib/dataverse/duplicate-key.js');

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
const log = (m) => console.log(m);
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ───────── state ─────────
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { persons: [], suggestions: [] }; }
}
function writeState(state) {
  if (!state.persons.length && !state.suggestions.length) { try { fs.unlinkSync(STATE_PATH); } catch { /* none */ } return; }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
let STATE = readState();
function recordPerson(id) { if (!STATE.persons.some((p) => p.id === id)) { STATE.persons.push({ id }); writeState(STATE); } }
function recordSuggestion(id, personId) { if (id && !STATE.suggestions.some((s) => s.id === id)) { STATE.suggestions.push({ id, personId }); writeState(STATE); } }

// ───────── create helpers (record GUID immediately) ─────────
function freshEmail(role, suffix) { return `zzz-merge-probe-${role}-${suffix}@example.invalid`; }

async function createPerson(role, email) {
  const existing = await potentialReviewer.getByEmail(email);
  if (existing) throw new Error(`REFUSING: email ${email} already exists as reviewer "${existing.wmkf_name}" (${existing.wmkf_potentialreviewersid}).`);
  const existingContact = await contact.findByEmail(email);
  if (existingContact) throw new Error(`REFUSING: email ${email} already exists as CRM contact "${existingContact.fullname}" (${existingContact.contactid}).`);
  const rec = await DynamicsService.createRecord(PR_ENTITY, {
    wmkf_firstname: MARKER_FIRST,
    wmkf_lastname: MARKER_LAST,
    wmkf_emailaddress: email,
    wmkf_organizationname: 'Merge Probe Institution',
    wmkf_areaofexpertise: 'merge probe',
    wmkf_whyreviewerwaschosen: 'Throwaway alt-key ordering probe row — safe to delete.',
  });
  const id = rec.wmkf_potentialreviewersid;
  recordPerson(id);
  log(`  created person ${role} ${id} <${email}>`);
  return id;
}

async function createSuggestion(personId, requestId, label) {
  const sug = await suggestion.upsert({
    potentialReviewerId: personId,
    requestId,
    suggestionLabel: label || 'Merge probe',
    matchReason: 'Throwaway merge-probe suggestion — safe to delete.',
    sources: 'merge-probe',
    selected: true,
  });
  recordSuggestion(sug.id, personId);
  log(`  created suggestion ${sug.id} (person ${personId} on request ${requestId})`);
  return sug.id;
}

async function resolveTestRequest() {
  const safe = String(TEST_REQUEST_NUM).replace(/'/g, "''");
  const { records } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,akoya_title',
    filter: `akoya_requestnum eq '${safe}'`,
    top: 1,
  });
  if (!records[0]) throw new Error(`Test request ${TEST_REQUEST_NUM} not found`);
  return records[0].akoya_requestid;
}

// ───────── sub-probes ─────────
async function subprobeA(suffix) {
  log('\n── A: email alt-key (wmkf_emailaddress_unique) + 409-translation fidelity ──');
  const eA = freshEmail('a', suffix);
  const eB = freshEmail('b', suffix);
  const A = await createPerson('A', eA);
  const B = await createPerson('B', eB);

  // 1. set A.email = eB while B still owns it → expect a 412 alt-key violation.
  let err = null;
  try {
    await DynamicsService.updateRecord(PR_ENTITY, A, { wmkf_emailaddress: eB });
  } catch (e) { err = e; }
  assert(err, 'A1: setting A.email to B\'s email WITHOUT clearing B succeeded — the email alt-key is NOT enforced (would corrupt the merge).');
  log(`  A1 update rejected: status=${err.status}`);
  // Diagnostic: persist the FULL raw 412 body so the alt-key error shape stays
  // analysable offline (this is the body that proved conflictingRecordId is NOT in
  // the 412 — the DuplicateEntity is the row being written, not the owner B).
  try { fs.writeFileSync(path.join(__dirname, '.merge-probe-412-email.txt'), `expected conflicting record (B) = ${B}\n\n${String(err.message)}`); log(`  (raw 412 body → scripts/.merge-probe-412-email.txt)`); } catch { /* non-fatal */ }

  // 2. the REAL error must round-trip through the shared translateDuplicateKeyError
  //    (the my-candidates 409 path; a miss falls through to an opaque 500). The 412
  //    only carries field/value — NOT the conflicting record id.
  const translated = translateDuplicateKeyError(err);
  assert(translated, `A2: real 412 did NOT translate (status=${err.status}). my-candidates would 500. RAW: ${String(err.message).slice(0, 500)}`);
  assert(translated.field === 'wmkf_emailaddress', `A2: translated.field=${translated.field}, expected wmkf_emailaddress. RAW: ${String(err.message).slice(0, 500)}`);
  assert(norm(translated.value) === norm(eB), `A2: translated.value=${translated.value} !== ${eB}`);
  log(`  A2 translateDuplicateKeyError ✓ field=${translated.field} value=${translated.value}`);

  // 2b. the conflicting owner is resolved BY VALUE (the route's real path:
  //     findByEmailCandidates → the single active owner), since the 412 doesn't
  //     carry it. This is what feeds chunk-4 merge mode's loserId.
  const match = await potentialReviewer.findByEmailCandidates(eB);
  assert(match.one, `A2b: findByEmailCandidates(eB) did not resolve a single owner (got ${JSON.stringify(match).slice(0, 200)}).`);
  assert(norm(match.id) === norm(B), `A2b: resolved owner ${match.id} !== B=${B} — merge mode would target the wrong loser.`);
  assert((match.row?.statecode ?? 0) === 0, 'A2b: resolved owner B is not active.');
  log(`  A2b resolve-by-email ✓ findByEmailCandidates(eB) → B (active)`);

  // 3. clear-then-set must succeed (the ordering the merge uses).
  await potentialReviewer.clearEmail(B);
  await DynamicsService.updateRecord(PR_ENTITY, A, { wmkf_emailaddress: eB });
  const Aafter = await DynamicsService.getRecord(PR_ENTITY, A, { select: 'wmkf_emailaddress' });
  const Bafter = await DynamicsService.getRecord(PR_ENTITY, B, { select: 'wmkf_emailaddress' });
  assert(norm(Aafter.wmkf_emailaddress) === norm(eB), 'A3: keeper did not take the email after clear-then-set.');
  assert(!Bafter.wmkf_emailaddress, 'A3: loser email not cleared.');
  log('  A3 clear-before-set ordering ✓');
}

async function subprobeB(suffix, requestId) {
  log('\n── B: (person,request) alt-key on wmkf_appreviewersuggestion ──');
  const P = await createPerson('P', freshEmail('p', suffix));
  const Q = await createPerson('Q', freshEmail('q', suffix));
  await createSuggestion(P, requestId, 'Merge probe P');
  const qSug = await createSuggestion(Q, requestId, 'Merge probe Q');

  // 1. repoint Q's suggestion → P, while P already has a row on this request →
  //    would make a duplicate (P,request) → expect the alt-key to reject it.
  let err = null;
  try {
    await suggestion.repointToPotentialReviewer(qSug, P);
  } catch (e) { err = e; }
  assert(
    err,
    'B1: repointing into an occupied (person,request) slot SUCCEEDED — the (person,request) alt-key is NOT enforced on a lookup PATCH; the merge\'s delete-collision design would create duplicates.',
  );
  log(`  B1 colliding repoint rejected ✓ status=${err.status}`);
  try { fs.writeFileSync(path.join(__dirname, '.merge-probe-412-personrequest.txt'), String(err.message)); } catch { /* non-fatal */ }

  // 2. free the slot (delete P's row), then the same repoint must succeed.
  const { records: pSugs } = await DynamicsService.queryRecords(SUG_ENTITY, {
    select: 'wmkf_appreviewersuggestionid', filter: `_wmkf_potentialreviewer_value eq ${P}`, top: 5,
  });
  for (const s of pSugs) await suggestion.hardDeleteById(s.wmkf_appreviewersuggestionid);
  await suggestion.repointToPotentialReviewer(qSug, P);
  const moved = await DynamicsService.getRecord(SUG_ENTITY, qSug, { select: '_wmkf_potentialreviewer_value' });
  assert(norm(moved._wmkf_potentialreviewer_value) === norm(P), 'B2: non-colliding repoint did not move the suggestion to P.');
  log('  B2 non-colliding repoint ✓');
}

async function subprobeC(suffix, requestId) {
  log('\n── C: end-to-end executeMerge (collision-delete + email-move + deactivate) ──');
  const eK = freshEmail('k', suffix);
  const eL = freshEmail('l', suffix);
  const K = await createPerson('K(keeper)', eK);
  const L = await createPerson('L(loser)', eL);
  await createSuggestion(K, requestId, 'Merge probe keeper');
  await createSuggestion(L, requestId, 'Merge probe loser'); // collision: both on requestId

  // Pre-merge plan must be the intended branch.
  const plan = await planMerge({ keeperId: K, loserId: L });
  assert(plan.blocked === false, `C: plan unexpectedly blocked: ${JSON.stringify(plan.reasons)}`);
  assert(plan.collisions.length === 1, `C: expected exactly 1 collision, got ${plan.collisions.length}`);
  assert(plan.repoint.length === 0, `C: expected 0 repoint, got ${plan.repoint.length}`);
  assert(plan.collisions[0].etag, 'C: collision entry has no etag — executeMerge would skip its If-Match guard.');
  log(`  C plan ✓ blocked=false, collisions=1 (etag present), repoint=0`);

  // Execute the REAL service path.
  const summary = await executeMerge({ keeperId: K, loserId: L, fieldChoices: { email: 'loser' } });
  log(`  C executeMerge summary: ${JSON.stringify(summary)}`);

  const Kafter = await potentialReviewer.getByIdForMerge(K);
  const Lafter = await potentialReviewer.getByIdForMerge(L);
  assert(norm(Kafter.wmkf_emailaddress) === norm(eL), `C: keeper email is ${Kafter.wmkf_emailaddress}, expected the loser's ${eL}.`);
  assert(norm(Kafter.wmkf_emailsource) === 'manual', `C: keeper emailSource is ${Kafter.wmkf_emailsource}, expected manual.`);
  assert((Kafter.statecode ?? 0) === 0, 'C: keeper should remain active.');
  assert(Lafter.statecode === 1, `C: loser statecode is ${Lafter.statecode}, expected 1 (Inactive).`);
  assert(!Lafter.wmkf_emailaddress, 'C: loser email not cleared.');
  const { records: lSugs } = await DynamicsService.queryRecords(SUG_ENTITY, {
    select: 'wmkf_appreviewersuggestionid', filter: `_wmkf_potentialreviewer_value eq ${L}`, top: 5,
  });
  assert(lSugs.length === 0, `C: loser still has ${lSugs.length} suggestion(s); the colliding row was not deleted.`);
  log('  C ✓ collision deleted, email moved + stamped manual, loser deactivated');
}

// ───────── teardown (marker-gated; suggestions deleted only inside here) ─────────
async function teardownPerson(personId) {
  let person;
  try {
    person = await DynamicsService.getRecord(PR_ENTITY, personId, { select: 'wmkf_potentialreviewersid,wmkf_name,statecode' });
  } catch {
    log(`  person ${personId} not found (already deleted?) — skipping`);
    return { id: personId, deleted: true };
  }
  if (!(person.wmkf_name || '').trim().includes(MARKER_NAME)) {
    throw new Error(`REFUSING to delete person ${personId}: wmkf_name "${person.wmkf_name}" lacks the marker "${MARKER_NAME}". Not a probe record — nothing deleted.`);
  }
  // Suggestions for this MARKER-VERIFIED person (catches repointed rows).
  const { records: sugs } = await DynamicsService.queryRecords(SUG_ENTITY, {
    select: 'wmkf_appreviewersuggestionid', filter: `_wmkf_potentialreviewer_value eq ${personId}`, top: 50,
  });
  for (const s of sugs) {
    await DynamicsService.deleteRecord(SUG_ENTITY, s.wmkf_appreviewersuggestionid);
    log(`  deleted suggestion ${s.wmkf_appreviewersuggestionid}`);
  }
  // Delete the person. R-Q3: try delete first; on failure report partial (no
  // unverified reactivate-then-delete). An inactive (merged-away) loser is the
  // case to watch — the run reports whether it deletes cleanly.
  try {
    await DynamicsService.deleteRecord(PR_ENTITY, personId);
    log(`  deleted person ${personId}${person.statecode === 1 ? ' (was Inactive)' : ''}`);
    return { id: personId, deleted: true };
  } catch (e) {
    log(`  ⚠ could NOT delete person ${personId} (statecode=${person.statecode}): ${e.message}`);
    return { id: personId, deleted: false, error: e.message };
  }
}

// Returns { clean, leftover, remaining }. Suggestions are deleted ONLY inside the
// marker-gated teardownPerson (which deletes them BEFORE the person, so they're
// gone even when a person delete later fails) — there is NO delete-suggestion-by-id
// path, which would lack the marker gate (Codex S290 post-impl Q2/R-S2). Recorded
// suggestion ids are kept for debugging only, never used to delete.
async function cleanup(personOverride) {
  STATE = readState();
  const targets = personOverride ? [personOverride] : STATE.persons.map((p) => p.id);
  if (!targets.length) { log('No recorded probe rows — nothing to clean.'); return { clean: true, leftover: [], remaining: [] }; }
  const leftover = [];
  for (const id of targets) {
    const r = await teardownPerson(id);
    if (!r.deleted) leftover.push(r);
  }
  // Post-cleanup read-back (Codex S290 post-impl Q5c): prove no suggestions remain
  // for any recorded synthetic person. A non-empty result means cleanup did NOT
  // fully succeed (teardown deletes them, so this should be zero).
  const remaining = [];
  for (const id of targets) {
    try {
      const { records } = await DynamicsService.queryRecords(SUG_ENTITY, {
        select: 'wmkf_appreviewersuggestionid', filter: `_wmkf_potentialreviewer_value eq ${id}`, top: 5,
      });
      if (records.length) remaining.push({ id, count: records.length });
    } catch { /* read error — don't claim clean; surfaced below if leftover too */ }
  }
  const clean = leftover.length === 0 && remaining.length === 0;
  if (clean) {
    if (personOverride) { STATE.persons = STATE.persons.filter((p) => p.id !== personOverride); writeState(STATE); }
    else writeState({ persons: [], suggestions: [] });
    log('\nCleanup complete (verified: no probe persons or suggestions remain). State cleared.');
    return { clean: true, leftover: [], remaining: [] };
  }
  // PARTIAL — retain the unresolved persons in state for a retry.
  const keepIds = new Set([...leftover.map((l) => l.id), ...remaining.map((r) => r.id)]);
  STATE.persons = STATE.persons.filter((p) => keepIds.has(p.id));
  writeState(STATE);
  log('\n⚠ Cleanup PARTIAL — left in state for retry:');
  for (const l of leftover) log(`    person ${l.id} could not be deleted — ${l.error}`);
  for (const r of remaining) log(`    person ${r.id} still has ${r.count} suggestion(s)`);
  log(`  Retry: node scripts/probe-merge-altkey-ordering.mjs cleanup  (state: ${STATE_PATH})`);
  return { clean: false, leftover, remaining };
}

// ───────── run ─────────
function planOnly() {
  log('PLAN-ONLY (no writes). Pass --run to execute against PRODUCTION Dataverse.\n');
  log(`Would, on test request ${TEST_REQUEST_NUM}, create throwaway rows (marker "${MARKER_NAME}", emails @example.invalid) and:`);
  log('  A — assert setting A.email=B.email without clearing 412s + round-trips translateDuplicateKeyError; then clear-then-set succeeds.');
  log('  B — assert a colliding (person,request) repoint is rejected; a non-colliding repoint succeeds.');
  log('  C — run executeMerge on a collision pair; assert collision-delete + email-move(+manual) + loser deactivate.');
  log('Then auto-clean up all created rows (marker-gated). --keep leaves them; `cleanup` tears down from the state file.');
}

async function run(keep) {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const requestId = await resolveTestRequest();
  log(`Test request ${TEST_REQUEST_NUM} → ${requestId}\nRun suffix: ${suffix}`);
  const results = [];
  let cleanupResult = null;
  const probes = [['A', () => subprobeA(suffix)], ['B', () => subprobeB(suffix, requestId)], ['C', () => subprobeC(suffix, requestId)]];
  try {
    for (const [name, fn] of probes) {
      try { await fn(); results.push({ name, pass: true }); }
      catch (e) { results.push({ name, pass: false, error: e.message }); log(`  ✗ ${name} FAILED: ${e.message}`); }
    }
  } finally {
    if (keep) {
      log(`\n⚠ --keep: leaving ${STATE.persons.length} created person row(s) in PRODUCTION. State: ${STATE_PATH}`);
      log('  Tear down with: node scripts/probe-merge-altkey-ordering.mjs cleanup');
    } else {
      log('\n── cleanup ──');
      try { cleanupResult = await cleanup(null); }
      catch (e) { cleanupResult = { clean: false, error: e.message }; log(`⚠ cleanup error: ${e.message} — run \`cleanup\` manually (state: ${STATE_PATH}).`); }
    }
  }
  log('\n══ SUMMARY ══');
  for (const r of results) log(`  ${r.pass ? '✓ PASS' : '✗ FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  const failed = results.filter((r) => !r.pass);
  // A partial cleanup leaving prod rows is itself a failure, even if every sub-probe
  // passed (Codex S290 post-impl Q6) — do not exit 0 with rows still in prod.
  const cleanupFailed = !keep && cleanupResult && !cleanupResult.clean;
  if (failed.length || cleanupFailed) {
    if (failed.length) log(`\n${failed.length} sub-probe(s) FAILED.`);
    if (cleanupFailed) log('\n⚠ Cleanup did NOT fully complete — prod rows may remain. Run `cleanup`.');
    process.exit(1);
  }
  log('\nAll sub-probes passed and cleanup verified — real Dataverse alt-key ordering confirmed (O8).');
}

const args = process.argv.slice(2);
try {
  if (args[0] === 'cleanup') {
    const pIdx = args.indexOf('--person');
    const res = await bypassDynamicsRestrictions('probe-merge-altkey', () => cleanup(pIdx >= 0 ? args[pIdx + 1] : null));
    if (res && !res.clean) process.exit(1);
  } else if (args.includes('--run')) {
    await bypassDynamicsRestrictions('probe-merge-altkey', () => run(args.includes('--keep')));
  } else {
    planOnly();
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
