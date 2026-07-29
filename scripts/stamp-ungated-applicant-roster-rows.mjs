#!/usr/bin/env node
/**
 * Dry-run by default. Enforces one invariant across `reviewer_find_roster`:
 *
 *   an ACTIVE row the Find tab routes to applicant PROMOTION must either hold a real
 *   identity-spine verdict (`confirmed`/`probable`) or be flagged for staff identity
 *   review — never neither.
 *
 * Writes require --execute.
 *
 * WHY (S387, found while verifying the anchor re-canonicalization). A row that is
 * neither verdict-bearing nor flagged passes `requiresStaffIdentityConfirmation` — every
 * clause reads null — so `POST /api/workbench/promote-applicant-reviewer` promotes it
 * with NO identity check at all. Today's `enrich-recommended-service` cannot produce
 * such a row (its two output branches set a verdict or `needsIdentification`), so these
 * are residue from a pre-identity-spine enrichment whose candidate key was already
 * canonical — which is why `recanonicalize-reviewer-roster-anchors.mjs` missed them: its
 * selector is `legacy-row:%` keys, and these were never placeholder-keyed.
 *
 * Stamping `needsIdentification:true` routes them to the read-only needs-identity-review
 * group, where promotion requires an explicit staff attestation ("This is the right
 * person"). That is the same fail-closed treatment the re-canonicalization applies.
 *
 * SCOPE — the predicate is the CLIENT's own promote-routing test
 * (`provenanceKindOf === 'applicant_suggested'`, i.e. `buildReviewerProvenance().kind`),
 * so this touches exactly the rows that can reach the promote route and no others:
 *   - `active` only. `saved`/`excluded`/`ineligible`/`coi_dropped` render no selectable
 *     card and are not promote-routed.
 *   - applicant provenance only. Stamping a literature-retrieved or proposal-named row
 *     would make it UNSAVABLE — `save-candidates` hard-rejects `needsIdentification:true`
 *     for non-exempt provenance (`isUnresolvedIdentity`).
 *   - skips a row holding `confirmed`/`probable` (its verdict is the gate) and a row with
 *     a staff attestation already recorded (`pdIdentityConfirmed`).
 *
 * IDEMPOTENT: stamping flips `requiresStaffIdentityConfirmation` to true, so a stamped
 * row leaves the target set and a re-run is a no-op. Safe to run repeatedly.
 *
 * Safety: gitignored backup before any write; one statement per row keyed by primary key
 * and re-asserting the row is still unflagged, so a concurrent writer is never clobbered;
 * Postgres only, no Dataverse calls.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';
import { provenanceKindOf, requiresStaffIdentityConfirmation } from '../lib/utils/reviewer-provenance.js';

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

const execute = process.argv.includes('--execute');
const requestArg = process.argv.find((arg) => arg.startsWith('--request='));
const onlyRequest = requestArg ? requestArg.split('=')[1].trim().toLowerCase() : null;

/** The invariant's violation test. */
function isUngatedPromotable(candidate) {
  if (provenanceKindOf(candidate) !== 'applicant_suggested') return false;
  if (candidate?.identityStatus === 'confirmed' || candidate?.identityStatus === 'probable') return false;
  if (candidate?.pdIdentityConfirmed === true) return false;
  return !requiresStaffIdentityConfirmation(candidate);
}

const { rows } = await sql`
  SELECT id, request_id, status, display_name, candidate_key, candidate
  FROM reviewer_find_roster
  WHERE status = 'active'
  ORDER BY request_id, display_name
`;

const scoped = onlyRequest
  ? rows.filter((row) => String(row.request_id).toLowerCase() === onlyRequest)
  : rows;
const targets = scoped.filter((row) => isUngatedPromotable(row.candidate));

console.log(`Ungated applicant roster rows (${execute ? 'EXECUTE' : 'DRY RUN'})`);
if (onlyRequest) console.log(`  scoped to request: ${onlyRequest}`);
console.log(`  active rows scanned: ${scoped.length}`);
console.log(`  promotable with NO identity gate, ${execute ? 'stamping' : 'would stamp'}: ${targets.length}\n`);

const byRequest = new Map();
for (const row of targets) {
  const list = byRequest.get(row.request_id) || [];
  list.push(row);
  byRequest.set(row.request_id, list);
}
for (const [requestId, list] of byRequest) {
  console.log(`  request ${requestId}`);
  for (const row of list) {
    const c = row.candidate;
    console.log(`    ${(row.display_name || '').padEnd(26)} identityStatus=${c.identityStatus ?? 'null'} verificationStatus=${c.verificationStatus ?? 'null'} key=${row.candidate_key.slice(0, 48)}`);
  }
}

if (!execute) {
  console.log('\nNo writes performed. Re-run with --execute to stamp needsIdentification.');
  process.exit(0);
}
if (targets.length === 0) { console.log('\nNothing to do — invariant already holds.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(__dirname, '.roster-dedupe-backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `roster-ungated-stamp-backup-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(targets, null, 2));
console.log(`\nBackup of ${targets.length} row(s) written to ${backupPath}`);

let stamped = 0;
let failed = 0;
for (const row of targets) {
  try {
    const res = await sql`
      UPDATE reviewer_find_roster
        SET candidate = candidate || '{"needsIdentification":true}'::jsonb,
            updated_at = now()
        WHERE id = ${row.id}
          AND status = 'active'
          AND COALESCE(candidate->>'needsIdentification', 'false') <> 'true'
      RETURNING id
    `;
    const n = res.rowCount || res.rows?.length || 0;
    if (n === 0) {
      console.log(`  NO-OP ${row.display_name} — row changed since the scan`);
      failed += 1;
      continue;
    }
    stamped += 1;
  } catch (err) {
    failed += 1;
    console.error(`  ERROR ${row.display_name} (${row.id}): ${err?.message || err}`);
  }
}

console.log(`\nStamped ${stamped} row(s); ${failed} left for review.`);
if (failed > 0) console.log('Re-run the dry run to see what remains — the pass is idempotent.');
console.log(`Backup retained at ${backupPath}`);
console.log('Those reviewers now need "This is the right person" on the Find tab before promotion.');
