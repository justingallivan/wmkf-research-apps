#!/usr/bin/env node

/**
 * Smoke test for the `executor.echo-parity` prompt.
 *
 * Runs the prompt twice against the same request via the Vercel executor and
 * asserts:
 *   1. Both runs produce byte-identical wmkf_ai_rawoutput (the parity oracle
 *      contract: see docs/EXECUTOR_CONTRACT.md § Test oracle).
 *   2. The second run reports cacheHit=true (within-prompt cache alignment).
 *
 * Once the PA-side ExecutePrompt child flow lands, run that against the same
 * (requestId, echo_text) inputs and confirm its wmkf_ai_rawoutput on the
 * resulting wmkf_ai_run row matches this script's output verbatim.
 *
 * Usage:
 *   node scripts/test-echo-parity.js [--request <number>] [--echo-text <s>]
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
  } catch {}
}

const args = process.argv.slice(2);
const REQUEST_NUMBER = (() => {
  const i = args.indexOf('--request');
  return i >= 0 ? args[i + 1] : '993879';
})();
const ECHO_TEXT = (() => {
  const i = args.indexOf('--echo-text');
  return i >= 0 ? args[i + 1] : 'parity-test';
})();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { executePrompt } = await import('../lib/services/execute-prompt.js');
enterDynamicsBypassForScript('test-echo-parity');

const lookup = await DynamicsService.queryRecords('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum',
  filter: `akoya_requestnum eq '${REQUEST_NUMBER}'`,
  top: 1,
});
const target = (lookup.records || [])[0];
if (!target) {
  console.error(`✗ Request ${REQUEST_NUMBER} not found`);
  process.exit(1);
}
console.log(`Target: ${target.akoya_requestnum}  (${target.akoya_requestid})`);
console.log(`echo_text: "${ECHO_TEXT}"`);
console.log('');

async function runOnce(label) {
  const t0 = Date.now();
  const result = await executePrompt({
    promptName: 'executor.echo-parity',
    requestId: target.akoya_requestid,
    overrideVariables: { echo_text: ECHO_TEXT },
    runSource: 'Vercel Test',
    forceOverwrite: false, // target.kind=none → guard inert anyway
  });
  const elapsed = Date.now() - t0;
  // Re-fetch the run row to read the persisted wmkf_ai_rawoutput byte-for-byte.
  const run = await DynamicsService.getRecord('wmkf_ai_runs', result.runId, {
    select: 'wmkf_ai_rawoutput,wmkf_ai_status,wmkf_ai_runsource',
  });
  console.log(`${label}: ${elapsed}ms  runId=${result.runId}  cacheHit=${result.cacheHit}`);
  console.log(`  parsed.echo: ${JSON.stringify(result.parsed?.echo)}`);
  console.log(`  rawOutput:   ${JSON.stringify(run.wmkf_ai_rawoutput)}`);
  return { result, raw: run.wmkf_ai_rawoutput };
}

const a = await runOnce('Run 1');
const b = await runOnce('Run 2');

console.log('');
const rawMatch = a.raw === b.raw;
const parsedMatch = JSON.stringify(a.result.parsed) === JSON.stringify(b.result.parsed);
console.log(`  rawOutput identical:  ${rawMatch ? '✓' : '✗'}`);
console.log(`  parsed identical:     ${parsedMatch ? '✓' : '✗'}`);
console.log(`  Run 2 cacheHit=true:  ${b.result.cacheHit ? '✓' : '✗ (expected within-prompt cache hit)'}`);

const expectedEcho = `${target.akoya_requestnum}|${ECHO_TEXT}`;
const echoCorrect = a.result.parsed?.echo === expectedEcho;
console.log(`  echo content correct: ${echoCorrect ? '✓' : `✗ (expected "${expectedEcho}", got "${a.result.parsed?.echo}")`}`);

if (!rawMatch || !echoCorrect) {
  console.error('\n✗ Parity test FAILED');
  process.exit(2);
}
if (!b.result.cacheHit) {
  console.warn('\n⚠ Cache miss on run 2 — investigate before relying on cache invariant');
  process.exit(3);
}
console.log('\n✓ Parity test PASSED');
