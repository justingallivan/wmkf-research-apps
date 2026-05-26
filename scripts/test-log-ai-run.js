#!/usr/bin/env node

/**
 * Test script: End-to-end exercise of DynamicsService.logAiRun().
 *
 * Writes a row to wmkf_ai_run attached to a test akoya_request and reads it
 * back to verify the Choice values and bound lookup. The smallest-viable
 * proof that our Dynamics writeback stack works against a custom child table.
 *
 * Note: wmkf_ai_run is intentionally append-only — prvDelete is NOT granted
 * (audit-log immutability by design). The test ends with the created row
 * still in Dynamics; re-running creates additional rows. Ask Connor to
 * bulk-delete test rows (model='claude-sonnet-4-TEST') periodically.
 *
 * Usage:
 *   node scripts/test-log-ai-run.js
 *   node scripts/test-log-ai-run.js --request 992629
 *
 * Requires: .env / .env.local with DYNAMICS_* credentials.
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

// Dynamics Explorer expects restrictions to be initialized before any query.
// We're writing (not querying) but queryRecords() is used to look up the test
// request, so seed empty restrictions.
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('test-log-ai-run');

const args = process.argv.slice(2);
const rIdx = args.indexOf('--request');
const REQUEST_NUM = rIdx >= 0 ? args[rIdx + 1] : '992629';

function pass(label, detail = '') { console.log(`  \u2713 ${label}${detail ? ` — ${detail}` : ''}`); }
function fail(label, err) { console.log(`  \u2717 ${label} — ${err}`); }

async function main() {
  console.log(`\n=== Test: DynamicsService.logAiRun() ===\n`);
  console.log(`Test request:  ${REQUEST_NUM}`);
  console.log(`(wmkf_ai_run is append-only — test rows accumulate. Ask Connor to purge periodically.)\n`);

  // 1. Resolve test request GUID.
  console.log('--- Lookup test request ---');
  const lookup = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum',
    filter: `akoya_requestnum eq '${REQUEST_NUM}'`,
    top: 1,
  });
  const rec = lookup.records[0];
  if (!rec) {
    fail('Lookup', `no akoya_request with requestnum ${REQUEST_NUM}`);
    process.exit(1);
  }
  const requestGuid = rec.akoya_requestid;
  pass('Found test request', `GUID ${requestGuid}`);

  // 2. Log a fake AI run.
  console.log('\n--- logAiRun (create) ---');
  let runInfo;
  try {
    runInfo = await DynamicsService.logAiRun({
      requestGuid,
      taskType: 'summary',
      model: 'claude-sonnet-4-TEST',
      promptVersion: 1,
      status: 'completed',
      rawOutput: {
        test: true,
        marker: `log-ai-run-test@${new Date().toISOString()}`,
        note: 'Written by scripts/test-log-ai-run.js; safe to delete.',
      },
      notes: 'Smoke test of DynamicsService.logAiRun (2026-04-14).',
    });
  } catch (e) {
    fail('logAiRun', e.message);
    process.exit(1);
  }
  pass('logAiRun succeeded', `runId=${runInfo.runId} runNum=${runInfo.runNum}`);

  // 3. Read back, verify Choice values map correctly and lookup bound.
  console.log('\n--- Readback + verify ---');
  const back = await DynamicsService.getRecord('wmkf_ai_runs', runInfo.runId, {
    select: 'wmkf_ai_runid,wmkf_ai_runnum,wmkf_ai_tasktype,wmkf_ai_status,wmkf_ai_model,wmkf_ai_promptversion,wmkf_ai_rawoutput,_wmkf_ai_request_value',
  });

  const checks = [
    ['wmkf_ai_tasktype === 682090000 (summary)', back.wmkf_ai_tasktype === 682090000],
    ['wmkf_ai_status === 682090000 (completed)', back.wmkf_ai_status === 682090000],
    ['wmkf_ai_model populated', back.wmkf_ai_model === 'claude-sonnet-4-TEST'],
    ['wmkf_ai_promptversion === 1', back.wmkf_ai_promptversion === 1],
    ['wmkf_ai_rawoutput is valid JSON', (() => {
      try { JSON.parse(back.wmkf_ai_rawoutput); return true; } catch { return false; }
    })()],
    ['lookup bound to correct request', back._wmkf_ai_request_value === requestGuid],
  ];
  let okAll = true;
  for (const [label, ok] of checks) {
    if (ok) pass(label);
    else { fail(label, `got ${JSON.stringify(back[label.split(' ')[0]])}`); okAll = false; }
  }

  // 4. Probe delete capability. Expected to 403 — wmkf_ai_run is append-only
  //    by design (prvDelete not granted). If it unexpectedly succeeds, that's
  //    fine too — we get cleanup for free.
  console.log('\n--- Delete probe (expected: 403 — append-only by design) ---');
  try {
    await DynamicsService.deleteRecord('wmkf_ai_runs', runInfo.runId);
    pass('Delete succeeded unexpectedly', '(cleanup done; prvDelete grant must have changed)');
  } catch (e) {
    if (/403|prvDelete/i.test(e.message)) {
      pass('Delete blocked (403)', 'append-only contract holds');
    } else {
      fail('Delete probe', `unexpected error: ${e.message.slice(0, 150)}`);
      okAll = false;
    }
  }

  console.log(`\nTest row retained: runId=${runInfo.runId}`);
  console.log(`\n=== ${okAll ? 'ALL CHECKS PASSED' : 'ONE OR MORE CHECKS FAILED'} ===\n`);
  process.exit(okAll ? 0 : 1);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
