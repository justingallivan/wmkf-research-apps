#!/usr/bin/env node
/**
 * One-shot historical contact-ORCID backfill (PR2,
 * docs/REVIEWER_ORCID_BACKPROPAGATION_DESIGN.md §6/§9).
 *
 * PR1 makes resolver-gated reviewer ORCIDs flow onto matched contacts at the
 * moment of outreach/promotion. This catches up the ALREADY-eligible pool: for
 * every reviewer carrying a valid wmkf_orcid + a persist-eligible
 * wmkf_identitystatus, push that iD onto the matched contact's EMPTY wmkf_orcid.
 * Measured yield = 162 writes / 0 conflict (S216 cross-store probe).
 *
 * Same safety as the live path — writes go through the SAME
 * contactAdapter.setOrcidIfAbsent (fill-only, conflict-surfacing, conditional
 * If-Match) inside bypassDynamicsRestrictions('backfill-contact-orcid', …). The
 * script NEVER creates a contact (non-goal §1) and NEVER sets the reviewer→
 * contact pointer (§8.1).
 *
 * Three phases (mirrors backfill-orcid-identity.js — resumable + idempotent):
 *   node scripts/backfill-contact-orcid.js --resolve   # READ-ONLY: classify every eligible reviewer → .contact-orcid-backfill.jsonl
 *   node scripts/backfill-contact-orcid.js --summary    # tally the resolve checkpoint (no calls)
 *   node scripts/backfill-contact-orcid.js --apply       # WRITES only action==='write' rows via setOrcidIfAbsent
 *   node scripts/backfill-contact-orcid.js --verify      # re-read written contacts; confirm wmkf_orcid == intended (§9)
 *
 * action ∈ write | noop | conflict | malformed | ambiguous | nocontact | status_null | ineligible_status
 * Matching precedence (§3): already-linked _wmkf_contact_value → email (top:2,
 * ambiguity-detecting) → none. Group-by-contact (Codex #6): two eligible
 * reviewers resolving to one empty contact → only the FIRST is `write`; the rest
 * become noop/conflict against that pending write, so the +162 projection stays
 * stable. Checkpoints: scripts/.contact-orcid-backfill.jsonl (resolve) +
 * scripts/.contact-orcid-backfill-applied.jsonl (apply). Both gitignored.
 */
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue; let [, k, v] = m; v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--summary') ? 'summary'
  : process.argv.includes('--verify') ? 'verify'
  : process.argv.includes('--resolve') ? 'resolve' : null;
if (!MODE) { console.error('Pass one of: --resolve | --summary | --apply | --verify'); process.exit(1); }
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const RESOLVE_LOG = join(__dirname, '.contact-orcid-backfill.jsonl');
const APPLIED_LOG = join(__dirname, '.contact-orcid-backfill-applied.jsonl');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { normalizeOrcid } = await import('../lib/utils/orcid-normalize.js');
const { mayPersistIdentity } = await import('../lib/services/reviewer-identity-resolver.js');
const contactAdapter = await import('../lib/dataverse/adapters/contact.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

async function withRetry(fn, label, max = 4) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const transient = e?.isTransient || e?.status === 429 || /429|timeout|ETIMEDOUT|socket/i.test(e?.message || '');
      if (!transient || attempt >= max) throw e;
      console.log(`  retry ${attempt}/${max - 1} after transient error on ${label}: ${e.message?.slice(0, 80)} (backoff ${delay}ms)`);
      await sleep(delay); delay *= 2;
    }
  }
}

const PERSON_SET = 'wmkf_potentialreviewerses';
// wmkf_orcid ne null intentionally KEEPS only ORCID-bearing rows (the null-filter
// trap is about UNintentionally dropping nulls; here the exclusion is the point).
const SELECT = 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_orcid,wmkf_identitystatus,_wmkf_contact_value';

const CONTACT_SET = 'contacts';

// ── RESOLVE: read-only classification over the eligible pool ───────────────────
async function runResolve() {
  await bypassDynamicsRestrictions('backfill-contact-orcid-resolve', async () => {
    const { records, totalCount, capped } = await DynamicsService.queryAllRecords(PERSON_SET, { select: SELECT, filter: 'wmkf_orcid ne null' });
    console.log(`ORCID-bearing reviewers: ${records.length}${totalCount ? ` (reported total ${totalCount})` : ''}`);
    if (capped) {
      console.error(`✗ queryAllRecords hit the ${records.length}-row export cap — the ORCID-bearing pool now exceeds it. Page the source before resolving (else a tail of eligible reviewers is silently dropped).`);
      process.exit(1);
    }

    const prior = readJsonl(RESOLVE_LOG);
    const done = new Set(prior.map((e) => e.reviewerId));
    // Re-seed the group-by-contact ledger from prior 'write' decisions so a
    // resumed run still treats a contact already claimed for a write as taken
    // (subsequent reviewers → noop/conflict, never a second write).
    const pendingByContact = new Map(); // contactId -> canonical orcid we intend to write
    for (const e of prior) if (e.action === 'write' && e.contactId) pendingByContact.set(e.contactId, e.orcid);

    const todo = records.filter((r) => !done.has(r.wmkf_potentialreviewersid));
    console.log(`already-resolved=${done.size}  to-resolve=${todo.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

    let i = 0;
    const tally = {};
    for (const r of todo) {
      if (i >= LIMIT) break;
      i++;
      const reviewerId = r.wmkf_potentialreviewersid;
      const name = (r.wmkf_name || '').trim() || null;
      const email = (r.wmkf_emailaddress || '').trim() || null;
      const status = r.wmkf_identitystatus ?? null;
      const src = normalizeOrcid(r.wmkf_orcid);

      const entry = { reviewerId, name, email, orcid: src.state === 'valid' ? src.id : null, status, contactId: null, action: null };

      // Eligibility (§2). Null status is its own surfaced exception (Codex #5),
      // not silently folded into nocontact. A non-valid source iD shouldn't exist
      // on a gated row — surface it loudly rather than guess.
      if (src.state !== 'valid') {
        entry.action = 'source_malformed';
        entry.sourceRaw = src.state === 'malformed' ? src.raw : null;
      } else if (status === null) {
        entry.action = 'status_null';
      } else if (!mayPersistIdentity(status)) {
        entry.action = 'ineligible_status';
      } else {
        // Resolve the target contact (§3): already-linked → email → none.
        let contactId = r._wmkf_contact_value || null;
        if (!contactId) {
          const res = await contactAdapter.resolveForBackprop(email);
          await sleep(120);
          if (res.ambiguous) entry.action = 'ambiguous';
          else if (res.none) entry.action = 'nocontact';
          else contactId = res.contactId;
        }

        if (contactId && !entry.action) {
          entry.contactId = contactId;
          // Group-by-contact: a contact already claimed by a pending write this
          // pass classifies subsequent reviewers against THAT pending iD.
          const pending = pendingByContact.get(contactId);
          if (pending) {
            entry.action = pending === src.id ? 'noop' : 'conflict';
            if (entry.action === 'conflict') { entry.existing = pending; entry.conflictWithPending = true; }
          } else {
            const c = await DynamicsService.getRecord(CONTACT_SET, contactId, { select: 'contactid,wmkf_orcid' });
            await sleep(120);
            const existing = normalizeOrcid(c?.wmkf_orcid);
            if (existing.state === 'valid') {
              entry.action = existing.id === src.id ? 'noop' : 'conflict';
              if (entry.action === 'conflict') entry.existing = existing.id;
            } else if (existing.state === 'malformed') {
              entry.action = 'malformed';
              entry.existing = c?.wmkf_orcid ?? null;
            } else {
              entry.action = 'write';
              pendingByContact.set(contactId, src.id);
            }
          }
        }
      }

      tally[entry.action] = (tally[entry.action] || 0) + 1;
      appendFileSync(RESOLVE_LOG, JSON.stringify(entry) + '\n');
      if (i % 100 === 0) console.log(`  …${i}/${todo.length}  (writes so far this run: ${tally.write || 0})`);
    }
    console.log(`\nResolve pass done. Processed ${i} this run.`);
    console.log('by action (this run):', tally);
    if (tally.source_malformed) console.log(`  ⚠ ${tally.source_malformed} row(s) carry a non-valid wmkf_orcid on a gated person — investigate.`);
    if (tally.ineligible_status) console.log(`  ⚠ ${tally.ineligible_status} row(s) have an ORCID but a non-persistable status — investigate (expected 0 per S216).`);
    console.log('Re-run to resume; then --summary / --apply.');
  });
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────
function runSummary() {
  const entries = readJsonl(RESOLVE_LOG);
  if (!entries.length) { console.log('No resolve checkpoint yet — run --resolve first.'); return; }
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.contactId));
  const tally = {};
  for (const e of entries) tally[e.action] = (tally[e.action] || 0) + 1;
  const writes = entries.filter((e) => e.action === 'write');
  const pending = writes.filter((e) => !applied.has(e.contactId));
  console.log(`resolve checkpoint: ${entries.length} rows`);
  console.log('by action:', tally);
  console.log(`\nWRITES projected: ${writes.length}  (already applied: ${applied.size}, pending: ${pending.length})`);
  if (tally.conflict) console.log(`conflicts (surfaced, NEVER overwritten): ${tally.conflict}`);
  if (tally.malformed) console.log(`malformed target ORCIDs (manual cleanup): ${tally.malformed}`);
  if (tally.ambiguous) console.log(`ambiguous email → skipped: ${tally.ambiguous}`);
  console.log('\nsample of pending writes:');
  for (const e of pending.slice(0, 10)) console.log(`  ${e.name}  ${e.orcid}  → contact ${e.contactId}`);
}

// ── APPLY: write only action==='write' rows ───────────────────────────────────
async function runApply() {
  const entries = readJsonl(RESOLVE_LOG).filter((e) => e.action === 'write' && e.contactId && e.orcid);
  const applied = new Set(readJsonl(APPLIED_LOG).map((e) => e.contactId));
  const pending = entries.filter((e) => !applied.has(e.contactId));
  console.log(`writes=${entries.length}  already-applied=${applied.size}  pending=${pending.length}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

  await bypassDynamicsRestrictions('backfill-contact-orcid-apply', async () => {
    let i = 0, wrote = 0, noop = 0, conflict = 0, malformed = 0, failed = 0;
    for (const e of pending) {
      if (i >= LIMIT) break;
      i++;
      // Intra-run dedup (Codex adversarial 2b): if --resolve produced two write
      // rows for one contact, skip the second — the first already handled it.
      // The startup `applied` set only covers PRIOR runs; grow it as we go.
      if (applied.has(e.contactId)) continue;
      try {
        // setOrcidIfAbsent re-reads → still safe if the contact changed since
        // --resolve (returns noop/conflict instead of clobbering).
        const r = await withRetry(() => contactAdapter.setOrcidIfAbsent(e.contactId, e.orcid), `setOrcid ${e.name}`);
        await sleep(150);
        if (r.action === 'write') wrote++;
        else if (r.action === 'noop') noop++;
        else if (r.action === 'conflict') { conflict++; console.log(`  CONFLICT (skipped) ${e.name} ${e.contactId}: contact has ${r.existing}, reviewer ${r.incoming}`); }
        else if (r.action === 'malformed') { malformed++; console.log(`  MALFORMED target ${e.name} ${e.contactId}: ${r.existing}`); }
        // Checkpoint by contact regardless of outcome — the decision is final for
        // this contact (idempotent re-runs won't re-touch it).
        appendFileSync(APPLIED_LOG, JSON.stringify({ contactId: e.contactId, reviewerId: e.reviewerId, orcid: e.orcid, action: r.action }) + '\n');
        applied.add(e.contactId);
      } catch (err) {
        failed++;
        console.log(`  FAILED ${e.name} (${e.contactId}): ${err.message?.slice(0, 120)}`);
      }
      if (i % 50 === 0) console.log(`  …${i}/${pending.length}  wrote=${wrote} noop=${noop} conflict=${conflict} failed=${failed}`);
    }
    console.log(`\nApply done this run: wrote=${wrote} noop=${noop} conflict=${conflict} malformed=${malformed} failed=${failed}. Re-run --apply to resume failures.`);
  });
}

// ── VERIFY: confirm each written contact holds the intended iD (§9) ────────────
async function runVerify() {
  const applied = readJsonl(APPLIED_LOG).filter((e) => e.action === 'write');
  if (!applied.length) { console.log('Nothing applied yet — run --apply first.'); return; }
  console.log(`verifying ${applied.length} written contact(s) by (contactId, reviewerId)…\n`);
  await bypassDynamicsRestrictions('backfill-contact-orcid-verify', async () => {
    let ok = 0, mismatch = 0, fail = 0;
    for (const e of applied) {
      try {
        const c = await DynamicsService.getRecord(CONTACT_SET, e.contactId, { select: 'contactid,wmkf_orcid' });
        await sleep(100);
        const now = normalizeOrcid(c?.wmkf_orcid);
        if (now.state === 'valid' && now.id === e.orcid) ok++;
        else { mismatch++; console.log(`  MISMATCH contact ${e.contactId} (reviewer ${e.reviewerId}): intended ${e.orcid}, now ${JSON.stringify(c?.wmkf_orcid)}`); }
      } catch (err) {
        fail++;
        console.log(`  read FAILED contact ${e.contactId}: ${err.message?.slice(0, 100)}`);
      }
    }
    console.log(`\nVerify: ${ok} confirmed, ${mismatch} mismatch, ${fail} read-failed (of ${applied.length}).`);
    console.log('(A mismatch is expected only if a third party edited the contact after our write — check native audit, §7.)');
  });
}

if (MODE === 'resolve') await runResolve();
else if (MODE === 'summary') runSummary();
else if (MODE === 'apply') await runApply();
else if (MODE === 'verify') await runVerify();
