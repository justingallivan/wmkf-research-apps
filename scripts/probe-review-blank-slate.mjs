#!/usr/bin/env node
/**
 * READ-ONLY probe — measure the actual "blank slate" before re-authoring the
 * review question set.
 *
 * A Codex adversarial review (S375) refuted the plan's blank-slate premise: the
 * claim "no answer snapshots exist" rested on a doc note that only said no
 * reviewer had submitted through the PORTAL as of 2026-07-03. Staff write paths
 * and a one-time backfill are separate sources, and Postgres drafts are a third.
 * This probe replaces that inference with counts.
 *
 * Reports:
 *   1. Dataverse `wmkf_appreviewanswer` rows — the answer snapshot, by question key.
 *   2. Dataverse suggestions carrying `wmkf_reviewreceivedat` — reviews on record
 *      by ANY path (portal, staff rescue, legacy upload, mark-received).
 *   3. Postgres `review_drafts` — in-progress authoring that a key/type change
 *      would silently discard (buildInitialValues drops unknown/mismatched keys).
 *   4. Postgres `review_question_audit` — prior staff edits to the question set.
 *
 * Performs NO writes.
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-review-blank-slate.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

function head(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function probeAnswerRows() {
  head('1. Dataverse wmkf_appreviewanswer — the answer snapshot');
  const { records } = await bypassDynamicsRestrictions(
    { reason: 'read-only blank-slate probe (scripts/probe-review-blank-slate.mjs)' },
    () => DynamicsService.queryAllRecords('wmkf_appreviewanswers', {
      select: 'wmkf_questionkey,wmkf_questiontype,wmkf_questiontext,wmkf_answervalue,wmkf_answertext,_wmkf_appreviewersuggestion_value',
      filter: 'statecode eq 0 or statecode eq 1',
    }),
  );
  console.log(`TOTAL answer rows: ${records.length}`);
  if (records.length === 0) {
    console.log('  (blank slate confirmed for this surface)');
    return;
  }
  const bySuggestion = new Map();
  const byKey = new Map();
  for (const r of records) {
    const sid = r._wmkf_appreviewersuggestion_value;
    bySuggestion.set(sid, (bySuggestion.get(sid) || 0) + 1);
    byKey.set(r.wmkf_questionkey, (byKey.get(r.wmkf_questionkey) || 0) + 1);
  }
  console.log(`Distinct reviewer suggestions with answers: ${bySuggestion.size}`);
  console.log('\nRows per question key (a key retired while rows exist becomes orphaned):');
  for (const [k, n] of [...byKey.entries()].sort()) console.log(`  ${k}: ${n}`);
  console.log('\nSample rows:');
  for (const r of records.slice(0, 15)) {
    console.log(`  [${r.wmkf_questionkey}/${r.wmkf_questiontype}] value=${r.wmkf_answervalue ?? 'null'} text=${JSON.stringify((r.wmkf_answertext || '').slice(0, 60))}`);
  }
}

async function probeReceivedReviews() {
  head('2. Dataverse suggestions with wmkf_reviewreceivedat — reviews by ANY path');
  const { records } = await bypassDynamicsRestrictions(
    { reason: 'read-only blank-slate probe (scripts/probe-review-blank-slate.mjs)' },
    () => DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
      select: 'wmkf_appreviewersuggestionid,wmkf_reviewreceivedat,wmkf_reviewuploadedbystaff,wmkf_reviewfilename,wmkf_reviewstatus',
      filter: 'wmkf_reviewreceivedat ne null',
    }),
  );
  console.log(`Suggestions with a review on record: ${records.length}`);
  for (const r of records) {
    console.log(`  ${r.wmkf_appreviewersuggestionid} received=${r.wmkf_reviewreceivedat} staffUpload=${r.wmkf_reviewuploadedbystaff === true} file=${r.wmkf_reviewfilename || 'none'}`);
  }
}

async function probePostgres() {
  const { sql } = await import('@vercel/postgres');

  head('3. Postgres review_drafts — in-progress authoring at risk from a key/type change');
  try {
    const { rows } = await sql`
      SELECT suggestion_id, updated_at,
             jsonb_object_keys_count.keys AS draft_keys
      FROM review_drafts
      CROSS JOIN LATERAL (
        SELECT array_agg(k ORDER BY k) AS keys FROM jsonb_object_keys(draft_json) AS k
      ) AS jsonb_object_keys_count
      ORDER BY updated_at DESC
    `;
    console.log(`Draft rows: ${rows.length}`);
    for (const r of rows) {
      console.log(`  suggestion=${r.suggestion_id} updated=${r.updated_at?.toISOString?.() || r.updated_at}`);
      console.log(`    keys: ${(r.draft_keys || []).join(', ') || '(empty)'}`);
    }
    if (rows.length === 0) console.log('  (no drafts — nothing to preserve)');
  } catch (e) {
    console.log(`  review_drafts read failed: ${e.message}`);
  }

  head('4. Postgres review_question_audit — prior staff edits to the question set');
  try {
    const { rows } = await sql`
      SELECT id, created_at, profile_id, phase, status, base_version, result_version, summary_json
      FROM review_question_audit
      ORDER BY created_at DESC
      LIMIT 25
    `;
    console.log(`Audit rows (most recent 25): ${rows.length}`);
    for (const r of rows) {
      const ts = r.created_at?.toISOString?.() || r.created_at;
      console.log(`  ${ts} ${r.phase}/${r.status} profile=${r.profile_id ?? 'null'} ${r.base_version || '-'} -> ${r.result_version || '-'}`);
      if (r.summary_json) console.log(`    ops: ${JSON.stringify(r.summary_json)}`);
    }
    if (rows.length === 0) console.log('  (question set has never been edited through the admin panel)');
  } catch (e) {
    console.log(`  review_question_audit read failed: ${e.message}`);
  }
}

async function main() {
  await probeAnswerRows();
  await probeReceivedReviews();
  await probePostgres();
  console.log('');
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
