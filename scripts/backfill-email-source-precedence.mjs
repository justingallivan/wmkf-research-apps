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
 *   - `manual` / `staff_verified` stored values ARE upgradeable by `ready` first-party
 *     evidence, which removes that recipient's send-time acknowledgement. Those rows are
 *     listed separately so the operator sees them before executing.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';
import { emailSourceTier, emailSourceOutranks } from '../lib/utils/reviewer-invite.js';

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

// Best roster-observed source per normalized address.
const { rows: rosterRows } = await sql`
  SELECT lower(COALESCE(NULLIF(candidate->>'email',''), NULLIF(candidate->'contactEnrichment'->>'email',''))) AS email,
         COALESCE(candidate->>'emailSource', candidate->'contactEnrichment'->>'emailSource') AS src
  FROM reviewer_find_roster
  WHERE COALESCE(NULLIF(candidate->>'email',''), NULLIF(candidate->'contactEnrichment'->>'email','')) IS NOT NULL
`;
const bestByEmail = new Map();
for (const row of rosterRows) {
  if (!row.email || !row.src) continue;
  const current = bestByEmail.get(row.email);
  if (!current || emailSourceOutranks(row.src, current)) bestByEmail.set(row.email, row.src);
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
    if (!emailSourceOutranks(best, person.wmkf_emailsource)) continue;
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
const humanSourced = plan.filter((p) => ['manual', 'staff_verified'].includes(String(p.stored).toLowerCase()));

console.log(`Address-provenance precedence backfill (${execute ? 'EXECUTE' : 'DRY RUN'})`);
console.log(`  roster addresses with a recorded source: ${bestByEmail.size}`);
console.log(`  person rows pinned below available evidence: ${plan.length}`);
console.log(`    currently research_only (NOT invitable today): ${blocked.length}`);
console.log(`    stored value is a HUMAN assertion (upgrade removes that recipient's send-time tick): ${humanSourced.length}\n`);
for (const p of plan) {
  const flag = humanSourced.includes(p) ? '  ⚠ human-sourced' : '';
  console.log(`  ${(p.name || '').padEnd(24)} ${p.email.padEnd(34)} ${p.stored} (${p.storedTier}) → ${p.best} (${p.bestTier})${flag}`);
}

if (!execute) {
  console.log('\nNo writes performed. Re-run with --execute to re-assert the stronger sources.');
  process.exit(0);
}
if (plan.length === 0) { console.log('\nNothing to do.'); process.exit(0); }

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
      if (String(now).toLowerCase() === String(p.best).toLowerCase()) {
        upgraded += 1;
        console.log(`  ${(p.name || '').padEnd(24)} ${p.stored} → ${now}`);
      } else {
        unchanged += 1;
        console.log(`  NO-OP ${(p.name || '').padEnd(20)} still ${now} (the adapter declined — re-run the dry run to see why)`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ERROR ${p.name} (${p.personId}): ${err?.message || err}`);
    }
  }
});

console.log(`\nUpgraded ${upgraded}; left unchanged ${unchanged}; errored ${failed}.`);
console.log(`Backup retained at ${backupPath}`);
if (upgraded > 0) console.log('Those reviewers are now invitable at their evidence-backed tier (quick check or ready).');
