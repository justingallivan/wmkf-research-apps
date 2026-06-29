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
 *   1. Does a changeset PATCH to the verified alt-key URL
 *        wmkf_appreviewanswers(_wmkf_appreviewersuggestion_value=<guid>,wmkf_questionkey='__probe_uk1')
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
// Candidate URL forms for the lookup component of the alternate key. The value
// attribute is the production-verified form; the navigation property remains as a
// fallback probe because it is a documented-looking alternate and cheap to test.
const LOOKUP_ATTR_CANDIDATES = [
  '_wmkf_appreviewersuggestion_value', // the lookup's value attribute
  'wmkf_AppReviewerSuggestion',        // the navigation property (schema casing)
];

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
function upsertOp(entitySet, lookupAttr, suggestionId, questionKey, body) {
  return {
    method: 'PATCH',
    url: `${entitySet}(${lookupAttr}=${suggestionId},wmkf_questionkey='${questionKey}')`,
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

    if (!args.execute) {
      console.log('\n━━━ DRY RUN — candidate lookup-attr URL forms ━━━');
      for (const attr of LOOKUP_ATTR_CANDIDATES) {
        console.log(`  ${upsertOp(entitySet, attr, args.suggestion, `${PROBE_PREFIX}1`, { wmkf_answertext: 'v1' }).url}`);
      }
      console.log('\n(dry run — nothing written. Re-run with --execute.)');
      return;
    }

    // ── Find the working lookup-attr URL form (one create op per candidate) ──
    console.log('\n━━━ Candidate search: which alt-key URL form CREATEs a row? ━━━');
    let workingAttr = null;
    for (let i = 0; i < LOOKUP_ATTR_CANDIDATES.length; i++) {
      const attr = LOOKUP_ATTR_CANDIDATES[i];
      const qk = `${PROBE_PREFIX}c${i}`;
      try {
        await DynamicsService.executeChangeset([
          upsertOp(entitySet, attr, args.suggestion, qk, { wmkf_answertext: 'v1', wmkf_questionorder: 1, wmkf_questiontype: 'string' }),
        ]);
        const made = (await findProbeRows(entitySet, args.suggestion)).some((x) => x.wmkf_questionkey === qk);
        console.log(`  ${attr.padEnd(38)} → ${made ? 'CREATED ✓' : 'no row'}`);
        if (made && !workingAttr) workingAttr = attr;
      } catch (e) {
        console.log(`  ${attr.padEnd(38)} → ${e.status || '?'} ${e.dataverseCode || ''} ${(e.dataverseMessage || e.message || '').slice(0, 90)}`);
      }
    }

    const verdict = { workingAttr };

    // ── Idempotency: re-upsert the working form's key, expect UPDATE not dupe ─
    if (workingAttr) {
      console.log(`\n━━━ Idempotency: re-upsert via "${workingAttr}" (expect UPDATE, no dupe) ━━━`);
      const qk = `${PROBE_PREFIX}c${LOOKUP_ATTR_CANDIDATES.indexOf(workingAttr)}`;
      await DynamicsService.executeChangeset([upsertOp(entitySet, workingAttr, args.suggestion, qk, { wmkf_answertext: 'v2' })]);
      const matching = (await findProbeRows(entitySet, args.suggestion)).filter((x) => x.wmkf_questionkey === qk);
      verdict.idempotentUpsert = matching.length === 1 && matching[0].wmkf_answertext === 'v2';
      console.log(`  rows for ${qk}: ${matching.length} (expect 1); value: ${matching.map((x) => x.wmkf_answertext).join(',')}`);
    } else {
      verdict.idempotentUpsert = null;
    }

    // ── Cleanup every probe row ──────────────────────────────────────────────
    console.log('\n━━━ Cleanup ━━━');
    for (const r of await findProbeRows(entitySet, args.suggestion)) {
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
    console.log(`  working alt-key URL form:        ${verdict.workingAttr || 'NONE — all candidates rejected'}`);
    console.log(`  idempotent (re-upsert UPDATEs):  ${verdict.idempotentUpsert === null ? 'N/A' : verdict.idempotentUpsert ? 'YES' : 'NO'}`);
    console.log(`  cleanup left the table clean:    ${verdict.cleanupClean ? 'YES' : 'NO — MANUAL CLEANUP NEEDED'}`);
    const go = !!verdict.workingAttr && verdict.idempotentUpsert;
    console.log(`\n  → ${go ? `GO: /submit uses "${verdict.workingAttr}" as the alt-key lookup component.` : 'NO-GO: no candidate alt-key URL form worked — fall back to @odata.bind in the body or a read-then-create.'}`);
  });
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
