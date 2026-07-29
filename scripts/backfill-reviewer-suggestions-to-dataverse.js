#!/usr/bin/env node
/**
 * W4 — reviewer_suggestions PG → DV backfill for PG-side excess rows.
 *
 * Identifies matchable PG rows (has email + request_number + active cycle)
 * that don't have a DV counterpart, and offers to upsert each via the
 * standard adapter chain:
 *
 *     potentialReviewerAdapter.upsertByEmail(email, name) → DV person GUID
 *     reviewerSuggestionAdapter.upsert({ potentialReviewerId, requestId, ... })
 *
 * Idempotent: alt-key on `(wmkf_request, wmkf_potentialreviewer)` ensures
 * a second run after partial success produces "already-exists" skips.
 *
 * Dry-run by default; --commit to write.
 *
 * Contract: docs/W4_RECONCILE_CONTRACT.md
 * Triage:   docs/W4_ANOMALY_TRIAGE.md
 *
 * As of 2026-05-12 the dataset has:
 *   - 8 unmatchable rows (accept-loss per triage doc; NOT backfill candidates)
 *   - 1 PG-side-excess matchable row at req=1002285 (real backfill candidate
 *     — staff decision required)
 *
 * The script is safe to run dry-run any time. Commit-mode writes go through
 * the production adapter chain, with the same authorization context as
 * save-candidates.js.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const COMMIT = process.argv.includes('--commit');

const { sql } = await import('@vercel/postgres');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const reviewerSuggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');

console.log(`# Reviewer suggestions PG → DV backfill`);
console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
console.log(`Generated: ${new Date().toISOString()}\n`);

// All DV calls run inside a restrictions-bypassed context (script is admin-
// scoped; no per-user data-scoping applies to a backfill operation).
await bypassDynamicsRestrictions('w4-backfill-reviewer-suggestions', async () => {

// 1. Load PG matchable selected rows on active cycles.
const pgRows = (await sql`
  SELECT
    rs.id AS pg_id,
    rs.request_number,
    rs.proposal_id,
    rs.match_reason,
    rs.relevance_score,
    rs.sources,
    rs.program_area,
    rs.invited,
    rs.accepted,
    rs.declined,
    rs.email_sent_at,
    rs.response_type,
    r.email,
    r.name,
    gc.short_code AS cycle_code
  FROM reviewer_suggestions rs
  JOIN grant_cycles gc ON gc.id = rs.grant_cycle_id
  LEFT JOIN researchers r ON r.id = rs.researcher_id
  WHERE rs.selected = true
    AND gc.is_active = true
    AND r.email IS NOT NULL
    AND rs.request_number IS NOT NULL
`).rows;
console.log(`Loaded ${pgRows.length} matchable PG rows on active cycles.`);

// 2. For each PG row, resolve request_number → akoya_request GUID.
const distinctReqNums = [...new Set(pgRows.map(r => r.request_number))];
console.log(`Resolving ${distinctReqNums.length} distinct request_numbers...`);

const requestGuidByNum = new Map();
for (const num of distinctReqNums) {
  const r = await DynamicsService.queryRecords('akoya_requests', {
    select: ['akoya_requestid', 'akoya_requestnum'],
    filter: `akoya_requestnum eq '${String(num).replace(/'/g, "''")}'`,
    top: 1,
  });
  if (r.records.length === 0) {
    console.warn(`  ⚠ request_number ${num} not found in DV`);
    continue;
  }
  requestGuidByNum.set(num, r.records[0].akoya_requestid);
}
console.log(`  resolved ${requestGuidByNum.size}/${distinctReqNums.length}`);

// 3. For each PG row with a resolved request GUID, check if a DV suggestion
//    already exists for (request, potentialreviewer-by-email). Email is the
//    canonical key; resolution to a DV potentialReviewer happens via
//    upsertByEmail (idempotent — creates only if missing).
//
//    To avoid creating extra potentialReviewer rows in dry-run, we look up
//    by email directly first.
let nAlready = 0;
let nWouldCreatePerson = 0;
let nWouldCreateSuggestion = 0;
let nMissing = 0;
let nErrors = 0;
const toBackfill = [];

for (const pg of pgRows) {
  const requestId = requestGuidByNum.get(pg.request_number);
  if (!requestId) { nMissing++; continue; }

  // Lookup existing potential reviewer by email.
  let person;
  try {
    person = await potentialReviewerAdapter.getByEmail(pg.email);
  } catch (err) {
    console.error(`  ERROR lookup pg=${pg.pg_id} email=${pg.email}: ${err.message}`);
    nErrors++;
    continue;
  }

  if (person) {
    // Check if a suggestion already exists for (person, request).
    let existingSug;
    try {
      existingSug = await reviewerSuggestionAdapter.findByPotentialReviewerAndRequest(
        person.wmkf_potentialreviewersid,
        requestId,
      );
    } catch (err) {
      console.error(`  ERROR sug-lookup pg=${pg.pg_id}: ${err.message}`);
      nErrors++;
      continue;
    }
    if (existingSug) {
      nAlready++;
      continue;
    }
    toBackfill.push({ pg, person, requestId, needsPerson: false });
    nWouldCreateSuggestion++;
  } else {
    toBackfill.push({ pg, person: null, requestId, needsPerson: true });
    nWouldCreatePerson++;
    nWouldCreateSuggestion++;
  }
}

console.log(`\n## Classification`);
console.log(`  already-in-DV:           ${nAlready}`);
console.log(`  would-create-person:     ${nWouldCreatePerson}`);
console.log(`  would-create-suggestion: ${nWouldCreateSuggestion}`);
console.log(`  missing-request:         ${nMissing} (request_number not found in DV)`);
console.log(`  errors:                  ${nErrors}\n`);

if (toBackfill.length === 0) {
  console.log('No rows to backfill. Dataverse is in sync.');
  process.exit(0);
}

console.log(`## Candidates (${toBackfill.length})\n`);
for (const c of toBackfill) {
  const action = c.needsPerson ? 'CREATE-PERSON+SUGGESTION' : 'CREATE-SUGGESTION';
  console.log(`  ${action}  pg=${c.pg.pg_id} req=${c.pg.request_number} cycle=${c.pg.cycle_code} email=${c.pg.email} name=${c.pg.name}`);
}

if (!COMMIT) {
  console.log('\nDRY-RUN — re-run with --commit to apply.');
  process.exit(0);
}

console.log('\n## Writing...\n');
let nCreatedPerson = 0;
let nCreatedSug = 0;
for (const c of toBackfill) {
  try {
    let personId;
    if (c.needsPerson) {
      const personRow = await potentialReviewerAdapter.upsertByEmail({
        email: c.pg.email,
        // S387: address + provenance together (this script is a historical backfill; see header).
        emailSource: c.pg.email_source || undefined,
        name: c.pg.name,
      });
      personId = personRow.id;
      // upsertByEmail returns { id, created } — only increment when truly
      // created (Codex W4-Day-2 Q8 sub-finding: nCreatedPerson was
      // overcounting on found-existing).
      if (personRow.created) nCreatedPerson++;
    } else {
      personId = c.person.wmkf_potentialreviewersid;
    }

    await reviewerSuggestionAdapter.upsert({
      potentialReviewerId: personId,
      requestId: c.requestId,
      grantCycleCode: c.pg.cycle_code,
      programArea: c.pg.program_area,
      relevanceScore: c.pg.relevance_score,
      matchReason: c.pg.match_reason,
      sources: c.pg.sources,
      selected: true,
    });
    nCreatedSug++;
    console.log(`  ✓ pg=${c.pg.pg_id} email=${c.pg.email}`);
  } catch (err) {
    console.error(`  ✗ pg=${c.pg.pg_id}: ${err.message}`);
    nErrors++;
  }
}

console.log(`\n## Summary`);
console.log(`  persons created:    ${nCreatedPerson}`);
console.log(`  suggestions created:${nCreatedSug}`);
console.log(`  errors:             ${nErrors}`);
if (nErrors > 0) process.exit(1);
});  // bypassDynamicsRestrictions
