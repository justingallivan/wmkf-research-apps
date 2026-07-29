#!/usr/bin/env node
/**
 * Dry-run by default. Re-keys `reviewer_find_roster` rows that carry a Dataverse
 * suggestion anchor but a pre-anchor placeholder key, so every server path can resolve
 * them. Writes require --execute.
 *
 * THE DEAD-END THIS CLOSES (S387; Codex adversarial review of 5a6c863c). Migration 025
 * minted `legacy-row:<id>` placeholder keys, and `stampSuggestionAnchor` later wrote
 * `suggestionId` into those blobs WITHOUT re-keying the row. `findCandidateBySuggestion`
 * matches only the canonical `suggestion:<id>` key, so such a row is invisible to it:
 * `POST /api/workbench/promote-applicant-reviewer` 422s, and the roster's `exclude`,
 * `saved`, and `confirm_identity` actions all 409 through
 * `authoritativeApplicantCandidate`. Staff see an applicant card they can neither
 * action nor set aside. Re-keying makes the row canonical and every path resolves it.
 *
 * WHY THE needsIdentification STAMP IS PART OF THE SAME PASS. Re-keying ALONE would be
 * fail-open: these blobs predate the identity spine, so their gate inputs are null and
 * `requiresStaffIdentityConfirmation` would wave them straight through promotion without
 * any identity check. Stamping `needsIdentification:true` routes them to the read-only
 * needs-identity-review group, where promotion requires an explicit staff attestation
 * ("This is the right person"). Fail-closed, and the dead-end is gone.
 *
 * SCOPE OF THE STAMP — deliberately narrow:
 *   - status='active' only. `saved` rows are already in Dataverse and render no card;
 *     `excluded` rows live in the collapsed recoverable section. Neither needs a gate.
 *   - applicant provenance only. Stamping a literature-retrieved or proposal-named row
 *     would make it UNSAVABLE: save-candidates hard-rejects `needsIdentification:true`
 *     for non-exempt provenance (`isUnresolvedIdentity`), so this would break save paths
 *     that work today.
 *   - rows with no spine verdict only. A `confirmed`/`probable` row keeps its verdict,
 *     and a row already flagged needs no second stamp (also the idempotency guard).
 *
 * Safety:
 *   - a row is re-keyed ONLY after Dataverse confirms the suggestion exists AND its
 *     `_wmkf_request_value` matches the roster row's request; anything else is skipped
 *   - every candidate blob is backed up to a gitignored directory before any write
 *   - re-key is refused if a canonical row for that suggestion already exists in the
 *     request (re-checked in the UPDATE's WHERE, so a concurrent writer cannot be
 *     clobbered and the unique index cannot be violated)
 *   - each row is one independent statement keyed by primary key + expected old key;
 *     an interrupted run leaves the remainder untouched and re-running converges
 *   - no Dataverse writes; the only Dataverse calls are $select reads
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from '@vercel/postgres';
import { buildReviewerProvenance } from '../lib/utils/reviewer-provenance.js';

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
const requestArg = process.argv.find((arg) => arg.startsWith('--request='));
const onlyRequest = requestArg ? requestArg.split('=')[1].trim().toLowerCase() : null;

async function getToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.DYNAMICS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.DYNAMICS_CLIENT_ID,
      client_secret: process.env.DYNAMICS_CLIENT_SECRET,
      scope: `${process.env.DYNAMICS_URL}/.default`,
    }),
  });
  if (!r.ok) throw new Error(`Token request failed: ${r.status}`);
  return (await r.json()).access_token;
}

/** Batched $select read of suggestion -> owning request. Missing ids simply stay absent. */
async function loadSuggestionOwners(token, suggestionIds) {
  const owners = new Map();
  const ids = [...new Set(suggestionIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 20) {
    const filter = ids.slice(i, i + 20)
      .map((id) => `wmkf_appreviewersuggestionid eq ${id}`)
      .join(' or ');
    const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/wmkf_appreviewersuggestions`
      + `?$select=wmkf_appreviewersuggestionid,_wmkf_request_value`
      + `&$filter=${encodeURIComponent(filter)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Suggestion read failed: ${res.status} ${text.slice(0, 300)}`);
    for (const row of (JSON.parse(text).value || [])) {
      owners.set(String(row.wmkf_appreviewersuggestionid).toLowerCase(), String(row._wmkf_request_value || '').toLowerCase());
    }
  }
  return owners;
}

function needsIdentityStamp(row) {
  const c = row.candidate || {};
  if (row.status !== 'active') return false;
  if (buildReviewerProvenance(c).kind !== 'applicant_suggested') return false;
  if (c.identityStatus === 'confirmed' || c.identityStatus === 'probable') return false;
  if (c.needsIdentification === true || c.identityStatus === 'unresolved') return false;
  return true;
}

const { rows } = await sql`
  SELECT id, request_id, candidate_key, status, display_name, candidate,
         lower(candidate->>'suggestionId') AS sugg
  FROM reviewer_find_roster legacy
  WHERE candidate_key LIKE 'legacy-row:%'
    AND candidate->>'suggestionId' IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM reviewer_find_roster c
      WHERE c.request_id = legacy.request_id
        AND c.candidate_key = 'suggestion:' || lower(legacy.candidate->>'suggestionId')
    )
  ORDER BY request_id, display_name
`;

const scoped = onlyRequest
  ? rows.filter((row) => String(row.request_id).toLowerCase() === onlyRequest)
  : rows;

const token = await getToken();
const owners = await loadSuggestionOwners(token, scoped.map((row) => row.sugg));

const plan = [];
const skipped = [];
for (const row of scoped) {
  const owner = owners.get(row.sugg);
  if (owner === undefined) {
    skipped.push(`ABSENT   ${row.display_name} — suggestion ${row.sugg} not found in Dataverse`);
    continue;
  }
  if (owner !== String(row.request_id).toLowerCase()) {
    skipped.push(`MISMATCH ${row.display_name} — suggestion belongs to request ${owner}, roster row says ${row.request_id}`);
    continue;
  }
  plan.push({ row, stamp: needsIdentityStamp(row) });
}

console.log(`Reviewer roster anchor re-canonicalization (${execute ? 'EXECUTE' : 'DRY RUN'})`);
if (onlyRequest) console.log(`  scoped to request: ${onlyRequest}`);
console.log(`  placeholder-keyed rows with an anchor and no canonical twin: ${scoped.length}`);
console.log(`  Dataverse-validated, ${execute ? 're-keying' : 'would re-key'}: ${plan.length}`);
console.log(`  of those, ${execute ? 'stamping' : 'would stamp'} needsIdentification: ${plan.filter((p) => p.stamp).length}`);
console.log(`  skipped (fail closed): ${skipped.length}\n`);

const byStatus = {};
for (const p of plan) {
  const key = `${p.row.status}${p.stamp ? ' +needsIdentification' : ''}`;
  byStatus[key] = (byStatus[key] || 0) + 1;
}
for (const [k, v] of Object.entries(byStatus).sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);
for (const line of skipped) console.log(`  ${line}`);

if (!execute) {
  console.log('\nNo writes performed. Re-run with --execute to re-key.');
  process.exit(0);
}
if (plan.length === 0) { console.log('\nNothing to do.'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(__dirname, '.roster-dedupe-backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `roster-recanonicalize-backup-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(plan.map((p) => p.row), null, 2));
console.log(`\nBackup of ${plan.length} row(s) written to ${backupPath}`);

let rekeyed = 0;
let stamped = 0;
let failed = 0;
for (const { row, stamp: doStamp } of plan) {
  const canonicalKey = `suggestion:${row.sugg}`;
  const patch = { candidateKey: canonicalKey };
  if (doStamp) patch.needsIdentification = true;
  try {
    const res = await sql`
      UPDATE reviewer_find_roster
        SET candidate_key = ${canonicalKey},
            candidate = candidate || ${JSON.stringify(patch)}::jsonb,
            updated_at = now()
        WHERE id = ${row.id}
          AND candidate_key = ${row.candidate_key}
          AND NOT EXISTS (
            SELECT 1 FROM reviewer_find_roster c
            WHERE c.request_id = ${row.request_id} AND c.candidate_key = ${canonicalKey}
          )
      RETURNING id
    `;
    const n = res.rowCount || res.rows?.length || 0;
    if (n === 0) {
      console.log(`  NO-OP ${row.display_name} ${row.candidate_key} — row or canonical twin changed since the scan`);
      failed += 1;
      continue;
    }
    rekeyed += 1;
    if (doStamp) stamped += 1;
  } catch (err) {
    failed += 1;
    console.error(`  ERROR ${row.display_name} ${row.candidate_key}: ${err?.message || err}`);
  }
}

console.log(`\nRe-keyed ${rekeyed} row(s); stamped needsIdentification on ${stamped}; ${failed} left for review.`);
if (failed > 0) console.log('Re-run the dry run to see what remains — the pass is idempotent.');
console.log(`Backup retained at ${backupPath}`);
