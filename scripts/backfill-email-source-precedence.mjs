#!/usr/bin/env node
/**
 * Dry-run by default. Applies the S387 address-provenance precedence rule to EXISTING
 * person records: where the roster already holds stronger evidence for the SAME address
 * than `wmkf_emailsource` records, re-assert that stronger source. Writes require
 * --execute.
 *
 * WHY THESE ROWS EXIST. `wmkf_emailsource` was fill-if-empty, so the first source ever
 * recorded for a person pinned their address tier permanently. A reviewer captured as
 * `serp_search` on one request stayed `research_only` — unsendable, no override available
 * — even after another request's enrichment found the SAME address in their own PubMed
 * affiliation string. `researcher.upsertByPotentialReviewer` now lets a strictly stronger
 * tier supersede a weaker one, but only at write time, so already-pinned rows need this
 * one-off pass. Live example: Prashant Mali on request 1002874.
 *
 * HOW. Every write goes through `researcherAdapter.upsertByPotentialReviewer` inside
 * `withDalContext`, NOT raw HTTP — so the DAL enforcement and the target/write interlock
 * both apply, and the upgrade itself is performed by the adapter's own precedence rule
 * (same address, strictly stronger known tier, ETag-conditional). This script decides
 * WHICH rows to re-assert; it cannot decide what counts as stronger.
 *
 * Safety:
 *   - the candidate set is recomputed live from Dataverse + the roster, never hardcoded
 *   - a row is submitted only when `emailSourceOutranks(best, stored)` holds for the SAME
 *     normalized address
 *   - the adapter refuses anything that does not still qualify at write time, so a
 *     concurrent change makes this a no-op rather than a downgrade
 *   - before/after sources are re-read and reported per row; a gitignored backup of the
 *     before-state is written prior to any write
 *   - `manual` / `staff_verified` stored values are terminal against machine evidence,
 *     even `ready` first-party evidence. The script uses the same
 *     `emailSourceUpgradeAllowed` predicate as the adapter, so it cannot remove a
 *     send-time human acknowledgement from a shared person row.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';
import {
  emailSourceTier,
  emailSourceOutranks,
  emailSourceUpgradeAllowed,
} from '../lib/utils/reviewer-invite.js';
import { pickVettedEmail, pickAssertedEmailPair } from '../lib/utils/reviewer-vetted-email.js';

// Blast-radius cap (Codex adversarial review, finding 4). The measured population is 6-7
// rows; anything materially larger means the roster or the connection is not what this
// pass was reasoned about, so refuse rather than write.
const MAX_ROWS = 25;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}
for (const key of ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_URL']) {
  if (!process.env[key]) { console.error(`Missing required env var: ${key}`); process.exit(1); }
}

const execute = process.argv.includes('--execute');

const { withDalContext } = await import('../lib/dataverse/core/context.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const researcherAdapter = await import('../lib/dataverse/adapters/researcher.js');

// Best roster-observed source per normalized address, restricted to rows that cleared the
// same persistence envelope save/promote require (`pickVettedEmail`: persistable, resolved
// identity, no anti-scrape munge) and to statuses that represent real candidates.
const { rows: rosterRows } = await sql`
  SELECT candidate_key, status, display_name, candidate
  FROM reviewer_find_roster
  WHERE status IN ('active', 'saved')
`;
const bestByEmail = new Map();
let rosterRowsConsidered = 0;
let rosterRowsRejected = 0;
for (const row of rosterRows) {
  // `pickAssertedEmailPair` rejects a blob whose two addresses disagree, because a pruned
  // row's top-level source is always enrichment-derived and would then describe the OTHER
  // address (S387, second adversarial review — the first version of this check was
  // illusory for exactly that shape).
  const pair = pickAssertedEmailPair(row.candidate);
  if (!pair) { rosterRowsRejected += 1; continue; }
  const vetted = pickVettedEmail(row.candidate);
  // The envelope must pass AND must be talking about the same address this row asserts.
  if (!vetted || String(vetted.email).trim().toLowerCase() !== pair.email.toLowerCase()) {
    rosterRowsRejected += 1;
    continue;
  }
  rosterRowsConsidered += 1;
  const email = pair.email.toLowerCase();
  const current = bestByEmail.get(email);
  if (!current || emailSourceOutranks(pair.source, current)) bestByEmail.set(email, pair.source);
}

const plan = await withDalContext('backfill-email-source-precedence-scan', async () => {
  const { records } = await potentialReviewerAdapter.queryReviewers({
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress,wmkf_emailsource',
    filter: 'wmkf_emailaddress ne null and wmkf_emailsource ne null',
  });
  const out = [];
  for (const person of records || []) {
    const email = String(person.wmkf_emailaddress || '').trim();
    const best = bestByEmail.get(email.toLowerCase());
    if (!best) continue;
    // `emailSourceUpgradeAllowed`, not `emailSourceOutranks`: a stored human assertion
    // (`manual`/`staff_verified`) is terminal against machine evidence, so it is never
    // upgraded here either — the script must not do what the adapter refuses to do.
    if (!emailSourceUpgradeAllowed(best, person.wmkf_emailsource)) continue;
    out.push({
      personId: person.wmkf_potentialreviewersid,
      name: person.wmkf_name,
      email,
      stored: person.wmkf_emailsource,
      storedTier: emailSourceTier(person.wmkf_emailsource),
      best,
      bestTier: emailSourceTier(best),
    });
  }
  return out;
});

const blocked = plan.filter((p) => p.storedTier === 'research_only');

console.log(`Address-provenance precedence backfill (${execute ? 'EXECUTE' : 'DRY RUN'})`);
console.log(`  roster rows contributing evidence: ${rosterRowsConsidered} (rejected by the envelope / pairing check: ${rosterRowsRejected})`);
console.log(`  roster addresses with an asserted source: ${bestByEmail.size}`);
console.log(`  person rows pinned below available evidence: ${plan.length}`);
console.log(`    currently research_only (NOT invitable today): ${blocked.length}\n`);
for (const p of plan) {
  console.log(`  ${(p.name || '').padEnd(24)} ${p.email.padEnd(34)} ${p.stored} (${p.storedTier}) → ${p.best} (${p.bestTier})`);
}

// A manifest is what makes --execute reviewable: the operator sees the exact plan in a dry
// run, and the execute pass refuses unless the plan still matches the manifest they read
// (Codex adversarial review, finding 4). Keyed on personId+email+stored+best, so any drift
// in the population between the two runs halts instead of silently writing a new set.
const manifestOf = (rows) => rows
  .map((p) => `${p.personId}|${p.email.toLowerCase()}|${p.stored}|${p.best}`)
  .sort()
  .join('\n');
const manifestDir = path.join(__dirname, '.roster-dedupe-backup');
const manifestPath = path.join(manifestDir, 'email-source-precedence-manifest.txt');

if (!execute) {
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(manifestPath, manifestOf(plan));
  console.log(`\nManifest written to ${manifestPath}`);
  console.log('No writes performed. Review the plan above, then re-run with --execute — it');
  console.log('will refuse if the population has changed since this manifest.');
  process.exit(0);
}
if (plan.length === 0) { console.log('\nNothing to do.'); process.exit(0); }
if (plan.length > MAX_ROWS) {
  console.error(`\nREFUSED: ${plan.length} rows exceeds the ${MAX_ROWS}-row cap. The measured population`);
  console.error('was 6-7 rows; a set this large means the inputs are not what this pass assumes.');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('\nREFUSED: no manifest. Run the dry run first and review its plan.');
  process.exit(1);
}
const reviewed = fs.readFileSync(manifestPath, 'utf8').trim();
if (reviewed !== manifestOf(plan)) {
  console.error('\nREFUSED: the plan no longer matches the reviewed manifest — the population changed.');
  console.error('Re-run the dry run, review the new plan, then execute.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(__dirname, '.roster-dedupe-backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `email-source-precedence-backup-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(plan, null, 2));
console.log(`\nBackup of ${plan.length} before-state row(s) written to ${backupPath}`);

let upgraded = 0;
let unchanged = 0;
let failed = 0;
await withDalContext('backfill-email-source-precedence', async () => {
  for (const p of plan) {
    try {
      // The adapter applies the precedence rule itself; passing the SAME stored address is
      // what makes the upgrade eligible, and it never rewrites the address.
      await researcherAdapter.upsertByPotentialReviewer(p.personId, {
        email: p.email,
        emailSource: p.best,
      });
      const after = await potentialReviewerAdapter.getByIdWithSelect(p.personId, {
        select: 'wmkf_potentialreviewersid,wmkf_emailaddress,wmkf_emailsource',
      });
      const now = after?.wmkf_emailsource || null;
      const addressNow = String(after?.wmkf_emailaddress || '').trim();
      // Verify BOTH halves: the source moved to the expected value AND it still describes
      // the address the evidence was for. Checking only the source would pass even if the
      // address had changed underneath (Codex adversarial review, finding 4).
      const addressHeld = addressNow.toLowerCase() === p.email.toLowerCase();
      if (String(now).toLowerCase() === String(p.best).toLowerCase() && addressHeld) {
        upgraded += 1;
        console.log(`  ${(p.name || '').padEnd(24)} ${p.stored} → ${now}  (address held: ${addressNow})`);
      } else if (!addressHeld) {
        // The address moved mid-pass; stop rather than continue against shifting state.
        console.error(`  ABORT ${p.name}: address is now ${addressNow || '(empty)'}, expected ${p.email}. Source reads ${now}.`);
        failed += 1;
        break;
      } else {
        unchanged += 1;
        console.log(`  NO-OP ${(p.name || '').padEnd(20)} still ${now} (the adapter declined — re-run the dry run to see why)`);
      }
    } catch (err) {
      // Abort-on-first-error: a mixed population is worse than a partial one, and the
      // manifest check makes resuming safe after the cause is understood.
      failed += 1;
      console.error(`  ABORT ${p.name} (${p.personId}): ${err?.message || err}`);
      break;
    }
  }
});

console.log(`\nUpgraded ${upgraded}; left unchanged ${unchanged}; errored ${failed}.`);
console.log(`Backup retained at ${backupPath}`);
if (upgraded > 0) console.log('Those reviewers are now invitable at their evidence-backed tier (quick check or ready).');
