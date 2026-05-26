#!/usr/bin/env node
/**
 * Backfill parity report (DRY-RUN, never writes).
 *
 * For every Postgres `reviewer_suggestions` row, classify it as:
 *
 *   Group A — already in Dataverse (matching wmkf_appreviewersuggestion exists)
 *   Group B — active cycle, only in Postgres → would backfill
 *   Group C1 — closed cycle, no engagement signal → would discard
 *   Group C2 — closed cycle, has engagement signal → would backfill for history
 *   Anomaly — missing identifiers, mapping failures
 *
 * Engagement signal: any of (email_sent_at, materials_sent_at,
 * response_type, response_received_at, review_received_at) populated
 * OR review_blob_url present.
 *
 * Active vs. closed: join Postgres request_number → akoya_request →
 * wmkf_meetingdate. Active = meeting date in the future or within last
 * 14 days. Closed = beyond that. No request_number AND no fallback =
 * Anomaly.
 *
 * Outputs counts plus a sample of each group. Writes nothing to either
 * Postgres or Dataverse.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) {}
}

const { sql } = await import('@vercel/postgres');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const potentialReviewerAdapter = await import('../lib/dataverse/adapters/potential-reviewer.js');
const reviewerSuggestionAdapter = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
enterDynamicsBypassForScript('parity-report');

const GRACE_DAYS = 14;
const NOW = new Date();
const GRACE_CUTOFF = new Date(NOW.getTime() - GRACE_DAYS * 86400 * 1000);

console.log(`\n=== Backfill parity report (DRY-RUN, no writes) ===`);
console.log(`Run at: ${NOW.toISOString()}`);
console.log(`Active cycle = wmkf_meetingdate > ${GRACE_CUTOFF.toISOString().slice(0, 10)} (${GRACE_DAYS}-day grace)\n`);

// Pull all Postgres rows + researcher email join.
const pgRows = await sql`
  SELECT
    rs.id,
    rs.request_number,
    rs.proposal_title,
    rs.grant_cycle_id,
    rs.researcher_id,
    rs.email_sent_at,
    rs.materials_sent_at,
    rs.response_type,
    rs.response_received_at,
    rs.review_received_at,
    rs.review_blob_url,
    rs.suggested_at,
    r.email AS researcher_email,
    r.name AS researcher_name,
    gc.short_code AS cycle_short_code
  FROM reviewer_suggestions rs
  LEFT JOIN researchers r ON r.id = rs.researcher_id
  LEFT JOIN grant_cycles gc ON gc.id = rs.grant_cycle_id
  ORDER BY rs.id
`;

console.log(`Postgres rows: ${pgRows.rows.length}\n`);

// Bulk-fetch akoya_request meeting dates for all distinct request_numbers
const distinctReqNums = [...new Set(pgRows.rows.map(r => r.request_number).filter(Boolean))];
const reqNumToMeetingDate = {};
const reqNumToGuid = {};

for (const chunk of chunked(distinctReqNums, 25)) {
  const filter = chunk.map(n => `akoya_requestnum eq '${n.replace(/'/g, "''")}'`).join(' or ');
  const res = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
    filter,
    top: chunk.length,
  });
  for (const r of res.records) {
    reqNumToMeetingDate[r.akoya_requestnum] = r.wmkf_meetingdate ? new Date(r.wmkf_meetingdate) : null;
    reqNumToGuid[r.akoya_requestnum] = r.akoya_requestid;
  }
}

console.log(`Resolved ${Object.keys(reqNumToGuid).length}/${distinctReqNums.length} request_numbers to akoya_request GUIDs.\n`);

// Classify each row
const buckets = { A: [], B: [], C1: [], C2: [], Anomaly: [] };
const reasons = { Anomaly: {} };

function hasEngagement(row) {
  return !!(
    row.email_sent_at ||
    row.materials_sent_at ||
    row.response_type ||
    row.response_received_at ||
    row.review_received_at ||
    row.review_blob_url
  );
}

for (const row of pgRows.rows) {
  // Anomaly: missing email
  if (!row.researcher_email) {
    buckets.Anomaly.push(row);
    reasons.Anomaly['missing_email'] = (reasons.Anomaly['missing_email'] || 0) + 1;
    continue;
  }
  // Anomaly: missing request_number AND no recoverable cycle short code
  if (!row.request_number) {
    if (!row.cycle_short_code) {
      buckets.Anomaly.push(row);
      reasons.Anomaly['missing_request_no_cycle'] = (reasons.Anomaly['missing_request_no_cycle'] || 0) + 1;
      continue;
    }
    // Has cycle short code but no request_number; still flag — backfill needs request linkage
    buckets.Anomaly.push(row);
    reasons.Anomaly['missing_request_with_cycle'] = (reasons.Anomaly['missing_request_with_cycle'] || 0) + 1;
    continue;
  }

  const requestGuid = reqNumToGuid[row.request_number];
  if (!requestGuid) {
    buckets.Anomaly.push(row);
    reasons.Anomaly['request_number_not_in_dataverse'] = (reasons.Anomaly['request_number_not_in_dataverse'] || 0) + 1;
    continue;
  }

  // Look up Dataverse potentialreviewer by email
  let pr = null;
  try {
    pr = await potentialReviewerAdapter.getByEmail(row.researcher_email);
  } catch (e) {
    buckets.Anomaly.push(row);
    reasons.Anomaly[`potentialreviewer_lookup_error: ${e.message.slice(0, 50)}`] = (reasons.Anomaly[`potentialreviewer_lookup_error: ${e.message.slice(0, 50)}`] || 0) + 1;
    continue;
  }

  // If a potentialreviewer exists, check for an existing suggestion for this request
  if (pr) {
    let existing = null;
    try {
      existing = await reviewerSuggestionAdapter.findByPotentialReviewerAndRequest(pr.wmkf_potentialreviewersid, requestGuid);
    } catch (e) {
      buckets.Anomaly.push(row);
      reasons.Anomaly[`suggestion_lookup_error: ${e.message.slice(0, 50)}`] = (reasons.Anomaly[`suggestion_lookup_error: ${e.message.slice(0, 50)}`] || 0) + 1;
      continue;
    }
    if (existing) {
      buckets.A.push({ ...row, dvSuggestionId: existing.wmkf_appreviewersuggestionid });
      continue;
    }
  }

  // Not in Dataverse. Active or closed?
  const meetingDate = reqNumToMeetingDate[row.request_number];
  const isActive = meetingDate ? meetingDate > GRACE_CUTOFF : true; // No meeting date → assume active (pre-meeting)
  const engaged = hasEngagement(row);

  if (isActive) {
    buckets.B.push(row);
  } else if (engaged) {
    buckets.C2.push(row);
  } else {
    buckets.C1.push(row);
  }
}

// Print summary
console.log('=== Classification ===');
console.log(`  A   already in Dataverse:                   ${String(buckets.A.length).padStart(4)} rows`);
console.log(`  B   active cycle, would backfill:           ${String(buckets.B.length).padStart(4)} rows`);
console.log(`  C2  closed cycle + engagement, backfill:    ${String(buckets.C2.length).padStart(4)} rows`);
console.log(`  C1  closed cycle, no engagement, discard:   ${String(buckets.C1.length).padStart(4)} rows`);
console.log(`  Anomaly:                                    ${String(buckets.Anomaly.length).padStart(4)} rows`);
console.log(`  Total:                                      ${String(pgRows.rows.length).padStart(4)} rows\n`);

if (buckets.Anomaly.length > 0) {
  console.log('=== Anomaly breakdown ===');
  for (const [reason, n] of Object.entries(reasons.Anomaly)) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
  console.log();
  console.log('Sample anomalies (first 5):');
  for (const r of buckets.Anomaly.slice(0, 5)) {
    console.log(`  pg id=${r.id} req=${r.request_number || '(null)'} cycle=${r.cycle_short_code || '(null)'} email=${r.researcher_email || '(null)'} name=${r.researcher_name || '(null)'}`);
  }
  console.log();
}

console.log('=== Sample Group A (already in Dataverse) ===');
for (const r of buckets.A.slice(0, 3)) {
  console.log(`  pg=${r.id} req=${r.request_number} email=${r.researcher_email} dvSugId=${r.dvSuggestionId}`);
}

console.log('\n=== Sample Group B (active, would backfill) ===');
for (const r of buckets.B.slice(0, 3)) {
  console.log(`  pg=${r.id} req=${r.request_number} cycle=${r.cycle_short_code} email=${r.researcher_email} engaged=${hasEngagement(r)}`);
}

console.log('\n=== Sample Group C2 (closed + engaged, backfill for history) ===');
for (const r of buckets.C2.slice(0, 3)) {
  console.log(`  pg=${r.id} req=${r.request_number} cycle=${r.cycle_short_code} email=${r.researcher_email}`);
}

console.log('\n=== Sample Group C1 (closed + no engagement, would discard) ===');
for (const r of buckets.C1.slice(0, 3)) {
  console.log(`  pg=${r.id} req=${r.request_number} cycle=${r.cycle_short_code} email=${r.researcher_email}`);
}

console.log(`\n=== End of parity report. NO writes performed. ===\n`);

function* chunked(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}
