#!/usr/bin/env node
/**
 * SMOKE-TEST HELPER (prod write, reversible) — create or tear down a throwaway
 * reviewer candidate for the Workbench invite end-to-end smoke.
 *
 * The candidate is a brand-new fake person ("ZZZ Smoke Test (DELETE)") with a
 * tester-supplied email, saved as a selected candidate on one request (default:
 * 1002826, which is out of consideration).
 *
 *   node scripts/smoke-test-candidate.mjs create  <email> [requestNum]
 *   node scripts/smoke-test-candidate.mjs cleanup
 *   node scripts/smoke-test-candidate.mjs cleanup --person <personGuid>   # lost-state fallback
 *
 * SAFETY MODEL — we only ever DELETE records whose GUIDs we recorded creating.
 *   - create refuses if the email already exists in the reviewer pool (so we
 *     never attach to / mutate a real reviewer), then creates a FRESH person and
 *     records its GUID (+ the suggestion GUID + request) in a local state file.
 *   - cleanup reads that state file and deletes EXACTLY those recorded GUIDs
 *     (person, its suggestion(s), its bibliometric sidecar(s), and the contact
 *     its wmkf_contact points to). It NEVER discovers records by name — a marker
 *     name is mutable/corruptible state and is not a trustworthy delete key.
 *   - The `--person <guid>` fallback lets you tear down a known GUID if the state
 *     file was lost. Both cleanup paths pass through a HARD GATE: teardown reads
 *     the person first and REFUSES to delete anything unless its (normalized)
 *     wmkf_name contains the smoke marker. Since no code path ever stamps that
 *     marker on a real record, the gate can only block a wrong delete (e.g. a
 *     mistyped real reviewer GUID), never cause one.
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

const MARKER_NAME = 'ZZZ Smoke Test (DELETE)';
const DEFAULT_REQUEST_NUM = '1002826';
const STATE_PATH = path.join(__dirname, '.smoke-test-candidate.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { records: [] }; }
}
function writeState(state) {
  if (!state.records.length) { try { fs.unlinkSync(STATE_PATH); } catch { /* none */ } return; }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewer = await import('../lib/dataverse/adapters/potential-reviewer.js');
const suggestion = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
const contact = await import('../lib/dataverse/adapters/contact.js');

async function resolveRequest(requestNum) {
  const safe = String(requestNum).replace(/'/g, "''");
  const { records } = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,akoya_title',
    filter: `akoya_requestnum eq '${safe}'`,
    top: 1,
  });
  if (!records[0]) throw new Error(`Request ${requestNum} not found`);
  return records[0];
}

async function create(email, requestNum) {
  if (!email || !/.+@.+\..+/.test(email)) throw new Error('A valid email is required: create <email>');

  // Refuse to stack a second smoke candidate — keep cleanup unambiguous.
  const state = readState();
  if (state.records.length) {
    throw new Error(`A smoke candidate already exists (person ${state.records.map(r => r.personId).join(', ')}). Run "cleanup" first.`);
  }

  const req = await resolveRequest(requestNum);
  console.log(`Request ${req.akoya_requestnum} (${req.akoya_requestid}) — ${req.akoya_title || '(untitled)'}`);

  // SAFETY: never attach to / mutate an existing reviewer. If this email is
  // already in the pool — real OR a leftover marker — abort. We do not reuse by
  // name: a name match is not proof the row is ours, and we must never risk a
  // later DELETE landing on a real reviewer.
  const existing = await potentialReviewer.getByEmail(email);
  if (existing) {
    throw new Error(
      `Email ${email} already exists in the reviewer pool as "${existing.wmkf_name}" (${existing.wmkf_potentialreviewersid}). ` +
      `Refusing to touch it. Run "cleanup" (or "cleanup --person <guid>") first, or use a different throwaway email.`
    );
  }
  // Also refuse if the email is already a CRM contact: the invitation send does
  // find-or-create-by-email, so a pre-existing contact would get LINKED to our
  // test person and teardown could then delete a real contact. Requiring a
  // brand-new email guarantees any promoted contact is genuinely ours.
  const existingContact = await contact.findByEmail(email);
  if (existingContact) {
    throw new Error(
      `Email ${email} already exists as a CRM contact "${existingContact.fullname}" (${existingContact.contactid}). ` +
      `Refusing — a smoke invitation would link this real contact. Use a different throwaway email.`
    );
  }

  const personRec = await DynamicsService.createRecord('wmkf_potentialreviewerses', {
    wmkf_name: MARKER_NAME,
    wmkf_firstname: 'Smoke',
    wmkf_lastname: 'Test (DELETE)',
    wmkf_emailaddress: email,
    wmkf_organizationname: 'Smoke Test Institution',
    wmkf_areaofexpertise: 'smoke test',
    wmkf_whyreviewerwaschosen: 'Throwaway candidate for the Workbench invite end-to-end smoke. Safe to delete.',
  });
  const personId = personRec.wmkf_potentialreviewersid;
  console.log(`Person CREATED (fresh): ${personId}`);

  const sug = await suggestion.upsert({
    potentialReviewerId: personId,
    requestId: req.akoya_requestid,
    suggestionLabel: 'Smoke test candidate',
    matchReason: 'Throwaway smoke-test candidate — safe to delete.',
    sources: 'smoke-test',
    selected: true,
  });
  console.log(`Suggestion CREATED: ${sug.id}`);

  state.records.push({ personId, suggestionId: sug.id, requestId: req.akoya_requestid, requestNum: req.akoya_requestnum, email });
  writeState(state);
  console.log(`Recorded created GUIDs to ${STATE_PATH}`);
  console.log(`\nDone. Open the Candidates tab for request ${req.akoya_requestnum} and invite "${MARKER_NAME}".`);
}

// Delete the full graph hanging off ONE person GUID that we created: its
// bibliometric sidecar(s), suggestion(s), the person, then the promoted contact
// it points to (last, so the person no longer references it). Everything here is
// keyed by the person GUID we recorded — never by name.
async function teardownPerson(personId) {
  console.log(`Tearing down person ${personId}`);

  // Read the person to learn its promoted-contact link (and confirm it exists).
  let person;
  try {
    person = await DynamicsService.getRecord('wmkf_potentialreviewerses', personId, {
      select: 'wmkf_potentialreviewersid,wmkf_name,_wmkf_contact_value',
    });
  } catch {
    console.log('  person not found (already deleted?) — skipping');
    return;
  }

  // HARD SAFETY GATE: never delete a person that isn't unmistakably a smoke
  // record. wmkf_name is a computed composite (Dynamics splits/recomposes it,
  // adding surrounding whitespace), so we normalize and test CONTAINS rather
  // than exact-equality. Nothing (create, enrichment, invite) ever stamps this
  // marker onto a real record, so a non-match means the GUID points at something
  // we didn't make (e.g. a mistyped real reviewer GUID passed to --person).
  // Abort before deleting anything — this gate can only refuse a wrong delete,
  // never cause one.
  if (!(person.wmkf_name || '').trim().includes(MARKER_NAME)) {
    throw new Error(
      `REFUSING to delete person ${personId}: wmkf_name is "${person.wmkf_name}", which does not contain the smoke marker "${MARKER_NAME}". ` +
      `This is not a smoke-test record — nothing was deleted.`
    );
  }
  const contactId = person._wmkf_contact_value || null;

  const { records: sidecars } = await DynamicsService.queryRecords('wmkf_appresearchers', {
    select: 'wmkf_appresearcherid', filter: `_wmkf_potentialreviewer_value eq ${personId}`, top: 50,
  });
  for (const s of sidecars) {
    await DynamicsService.deleteRecord('wmkf_appresearchers', s.wmkf_appresearcherid);
    console.log(`  deleted sidecar ${s.wmkf_appresearcherid}`);
  }

  const { records: sugs } = await DynamicsService.queryRecords('wmkf_appreviewersuggestions', {
    select: 'wmkf_appreviewersuggestionid,_wmkf_request_value', filter: `_wmkf_potentialreviewer_value eq ${personId}`, top: 50,
  });
  for (const s of sugs) {
    await DynamicsService.deleteRecord('wmkf_appreviewersuggestions', s.wmkf_appreviewersuggestionid);
    console.log(`  deleted suggestion ${s.wmkf_appreviewersuggestionid} (request ${s._wmkf_request_value})`);
  }

  await DynamicsService.deleteRecord('wmkf_potentialreviewerses', personId);
  console.log(`  deleted person ${personId}`);

  // The promoted contact was created FROM this person (create refuses a
  // pre-existing contact email, so it's ours). Defense-in-depth: only delete it
  // if its name is the marker — never delete a contact that isn't clearly ours.
  if (contactId) {
    try {
      const c = await DynamicsService.getRecord('contacts', contactId, { select: 'contactid,fullname' });
      if (c && (c.fullname || '').trim().includes(MARKER_NAME)) {
        await DynamicsService.deleteRecord('contacts', contactId);
        console.log(`  deleted promoted contact ${contactId} (${c.fullname})`);
      } else {
        console.log(`  SKIPPED contact ${contactId} — fullname "${c?.fullname}" is not the marker; left in place (delete manually only if it's test data)`);
      }
    } catch (e) {
      console.log(`  could not resolve/delete contact ${contactId}: ${e.message}`);
    }
  }
}

async function cleanup(personOverride) {
  if (personOverride) {
    await teardownPerson(personOverride);
    // Drop it from state too if present.
    const state = readState();
    state.records = state.records.filter((r) => r.personId !== personOverride);
    writeState(state);
    console.log('\nCleanup complete (explicit --person).');
    return;
  }

  const state = readState();
  if (!state.records.length) {
    console.log('No recorded smoke candidate in state — nothing to clean.');
    console.log('(If you know a leftover person GUID, run: cleanup --person <guid>.)');
    return;
  }
  for (const r of state.records) {
    await teardownPerson(r.personId);
  }
  writeState({ records: [] });
  console.log('\nCleanup complete. State file cleared.');
}

const args = process.argv.slice(2);
const mode = args[0];
try {
  if (mode === 'create') {
    await bypassDynamicsRestrictions('smoke-test-candidate', () => create(args[1], args[2] || DEFAULT_REQUEST_NUM));
  } else if (mode === 'cleanup') {
    const pIdx = args.indexOf('--person');
    const personOverride = pIdx >= 0 ? args[pIdx + 1] : null;
    await bypassDynamicsRestrictions('smoke-test-candidate', () => cleanup(personOverride));
  } else {
    console.error('Usage: smoke-test-candidate.mjs create <email> [requestNum] | cleanup [--person <guid>]');
    process.exit(1);
  }
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
