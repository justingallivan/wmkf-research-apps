#!/usr/bin/env node
/**
 * Phase 3 prerequisite probe — does Dataverse alternate-key UPSERT inside a
 * changeset work when the key includes a LOOKUP, in THIS environment?
 *
 * The S301 changeset spike (scripts/probe-dataverse-batch-changeset.mjs) proved
 * $batch atomic changesets + per-op If-Match, but every op it sent was addressed
 * by GUID (or used @odata.bind on create). The reviewer /submit (Phase 3) instead
 * UPSERTS the wmkf_appreviewanswer child rows by the alternate key
 * `wmkf_appreviewanswer_suggestion_question_key` on
 * (wmkf_appreviewersuggestion, wmkf_questionkey) — and one of those key
 * attributes is a LOOKUP. The URL syntax for an alt-key that includes a lookup is
 * NOT something the spike exercised, so this gates the submit write.
 *
 * What it answers (on --execute), all via DynamicsService.executeChangeset (so it
 * also re-validates the helper end-to-end in prod):
 *   1. Does a changeset PATCH to the alt-key URL
 *        wmkf_appreviewanswers(wmkf_appreviewersuggestion=<guid>,wmkf_questionkey='__probe_uk1')
 *      CREATE the row (upsert-create), auto-binding the lookup from the URL key?
 *   2. Does re-running the SAME changeset with a changed value UPDATE in place
 *      (still N rows, not 2N) — i.e. is it a true idempotent upsert?
 * Then it deletes every __probe_uk* row it created and prints a verdict.
 *
 * Usage:
 *   node scripts/probe-altkey-upsert-changeset.mjs --suggestion=<guid>            # DRY RUN (prints the planned ops, no writes)
 *   node scripts/probe-altkey-upsert-changeset.mjs --suggestion=<guid> --execute  # prod writes, then cleans up
 *
 * Find a test suggestion GUID: any wmkf_appreviewersuggestion you're OK scribbling
 * __probe_uk* answer rows under and deleting (e.g. a row on test request 1002788).
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvLocal } = require('../lib/dataverse/client');

loadEnvLocal();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const PROBE_PREFIX = '__probe_uk';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_ATTR = 'wmkf_appreviewersuggestion'; // alt-key lookup attribute logical name

function parseArgs(argv) {
  const out = { suggestion: null, execute: false };
  for (const a of argv.slice(2)) {
    if (a === '--execute') out.execute = true;
    else if (a.startsWith('--suggestion=')) out.suggestion = a.slice('--suggestion='.length);
    else if (a === '--help' || a === '-h') { console.log('See header for usage.'); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); process.exit(1); }
  }
  return out;
}

/** Build an alt-key upsert PATCH op for executeChangeset (no lookup in the body — relies on the URL key). */
function upsertOp(entitySet, suggestionId, questionKey, body) {
  return {
    method: 'PATCH',
    url: `${entitySet}(${LOOKUP_ATTR}=${suggestionId},wmkf_questionkey='${questionKey}')`,
    body,
  };
}

async function findProbeRows(entitySet, suggestionId) {
  const { records } = await DynamicsService.queryRecords(entitySet, {
    select: 'wmkf_appreviewanswerid,wmkf_questionkey,wmkf_answertext',
    filter: `_wmkf_appreviewersuggestion_value eq ${suggestionId} and startswith(wmkf_questionkey,'${PROBE_PREFIX}')`,
    top: 50,
  });
  return records;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Mode:       ${args.execute ? 'EXECUTE (will write + clean up)' : 'DRY-RUN'}`);
  if (!args.suggestion || !UUID_RE.test(args.suggestion)) {
    console.error('\nFATAL: --suggestion=<guid> is required (a wmkf_appreviewersuggestion GUID).');
    process.exit(1);
  }
  console.log(`Suggestion: ${args.suggestion}\n`);

  await bypassDynamicsRestrictions('probe-altkey-upsert', async () => {
    const entitySet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');
    console.log(`Resolved entity set: ${entitySet}`);

    const ops1 = [
      upsertOp(entitySet, args.suggestion, `${PROBE_PREFIX}1`, { wmkf_answertext: 'v1', wmkf_questionorder: 1, wmkf_questiontype: 'string' }),
      upsertOp(entitySet, args.suggestion, `${PROBE_PREFIX}2`, { wmkf_answertext: 'v1', wmkf_questionorder: 2, wmkf_questiontype: 'string' }),
    ];

    if (!args.execute) {
      console.log('\n━━━ DRY RUN — planned upsert ops ━━━');
      for (const op of ops1) console.log(`  ${op.method} ${op.url}  body=${JSON.stringify(op.body)}`);
      console.log('\n(dry run — nothing written. Re-run with --execute.)');
      return;
    }

    const verdict = {};

    // ── Round 1: alt-key upsert should CREATE both rows ──────────────────────
    console.log('\n━━━ Round 1: alt-key upsert (expect CREATE of 2 rows) ━━━');
    try {
      const r = await DynamicsService.executeChangeset(ops1);
      console.log(`  executeChangeset ok; op statuses: [${r.operations.map((o) => o.status).join(', ')}]`);
    } catch (e) {
      console.log(`  FAILED: status=${e.status} code=${e.dataverseCode || '-'} msg=${(e.dataverseMessage || e.message || '').slice(0, 300)}`);
      verdict.altKeyUpsertWorks = false;
    }
    let rows = await findProbeRows(entitySet, args.suggestion);
    console.log(`  probe rows now: ${rows.length} (expect 2); values: [${rows.map((x) => x.wmkf_answertext).join(', ')}]`);
    if (verdict.altKeyUpsertWorks !== false) verdict.altKeyUpsertWorks = rows.length === 2;

    // ── Round 2: SAME keys, changed value → UPDATE in place (still 2 rows) ────
    console.log('\n━━━ Round 2: re-upsert same keys, new value (expect UPDATE, still 2 rows) ━━━');
    if (verdict.altKeyUpsertWorks) {
      const ops2 = [
        upsertOp(entitySet, args.suggestion, `${PROBE_PREFIX}1`, { wmkf_answertext: 'v2' }),
        upsertOp(entitySet, args.suggestion, `${PROBE_PREFIX}2`, { wmkf_answertext: 'v2' }),
      ];
      try {
        await DynamicsService.executeChangeset(ops2);
      } catch (e) {
        console.log(`  re-upsert FAILED: ${(e.dataverseMessage || e.message || '').slice(0, 200)}`);
      }
      rows = await findProbeRows(entitySet, args.suggestion);
      const allV2 = rows.length === 2 && rows.every((x) => x.wmkf_answertext === 'v2');
      console.log(`  probe rows now: ${rows.length} (expect 2, no dupes); values: [${rows.map((x) => x.wmkf_answertext).join(', ')}]`);
      verdict.idempotentUpsert = allV2;
    } else {
      verdict.idempotentUpsert = null;
      console.log('  skipped (round 1 did not create the rows).');
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log('\n━━━ Cleanup ━━━');
    rows = await findProbeRows(entitySet, args.suggestion);
    for (const r of rows) {
      try {
        await DynamicsService.deleteRecord(entitySet, r.wmkf_appreviewanswerid);
        console.log(`  deleted ${r.wmkf_questionkey} (${r.wmkf_appreviewanswerid})`);
      } catch (e) {
        console.log(`  delete ${r.wmkf_appreviewanswerid} FAILED: ${e.message}`);
      }
    }
    const leftover = await findProbeRows(entitySet, args.suggestion);
    verdict.cleanupClean = leftover.length === 0;
    console.log(`  probe rows remaining: ${leftover.length}`);

    console.log('\n═══ VERDICT ═══');
    console.log(`  alt-key upsert CREATEs (lookup auto-bound from URL): ${verdict.altKeyUpsertWorks ? 'YES' : 'NO'}`);
    console.log(`  re-upsert UPDATEs in place (idempotent, no dupes):   ${verdict.idempotentUpsert === null ? 'N/A' : verdict.idempotentUpsert ? 'YES' : 'NO'}`);
    console.log(`  cleanup left the table clean:                        ${verdict.cleanupClean ? 'YES' : 'NO — MANUAL CLEANUP NEEDED'}`);
    const go = verdict.altKeyUpsertWorks && verdict.idempotentUpsert;
    console.log(`\n  → ${go ? 'GO: /submit can upsert answer rows by alternate key.' : 'NO-GO: alt-key upsert URL syntax needs revision (try _wmkf_appreviewersuggestion_value=, or @odata.bind in the body).'}`);
  });
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
