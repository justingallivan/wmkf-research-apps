#!/usr/bin/env node

/**
 * Query-back tool: dump wmkf_ai_run rows attached to a given akoya_request.
 *
 * Used after a real Grant Reporting extraction (or any other logged AI task)
 * to verify that rows landed in Dynamics with the right Choice values, model,
 * promptVersion, and rawOutput payload.
 *
 * Usage:
 *   node scripts/query-ai-runs.js --request 992629
 *   node scripts/query-ai-runs.js --request 992629 --limit 20
 *   node scripts/query-ai-runs.js --request 992629 --show-raw   (print full rawOutput)
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

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('query-ai-runs');

const args = process.argv.slice(2);
const rIdx = args.indexOf('--request');
const lIdx = args.indexOf('--limit');
const showRaw = args.includes('--show-raw');

if (rIdx < 0) {
  console.error('Usage: node scripts/query-ai-runs.js --request <requestnum> [--limit N] [--show-raw]');
  process.exit(1);
}
const REQUEST_NUM = args[rIdx + 1];
const LIMIT = lIdx >= 0 ? parseInt(args[lIdx + 1], 10) : 10;

const TASK_TYPE_LABELS = {
  682090000: 'summary',
  682090001: 'report',
  682090002: 'check-in',
  682090003: 'pd-assignment',
};
const STATUS_LABELS = {
  682090000: 'completed',
  682090001: 'failed',
  682090002: 'needs-review',
};

function truncate(s, n = 200) {
  if (!s) return '';
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length <= n ? str : str.slice(0, n) + `… (${str.length} chars total)`;
}

async function main() {
  console.log(`\n=== Query wmkf_ai_run rows for request ${REQUEST_NUM} ===\n`);

  // 1. Resolve request GUID.
  const lookup = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum',
    filter: `akoya_requestnum eq '${REQUEST_NUM}'`,
    top: 1,
  });
  const rec = lookup.records[0];
  if (!rec) {
    console.error(`No akoya_request found with requestnum ${REQUEST_NUM}`);
    process.exit(1);
  }
  console.log(`Request:  ${rec.akoya_requestnum}`);
  console.log(`GUID:     ${rec.akoya_requestid}\n`);

  // 2. Query wmkf_ai_run rows. Newest first.
  const runs = await DynamicsService.queryRecords('wmkf_ai_runs', {
    select: 'wmkf_ai_runid,wmkf_ai_runnum,wmkf_ai_tasktype,wmkf_ai_status,wmkf_ai_model,wmkf_ai_promptversion,wmkf_ai_notes,wmkf_ai_rawoutput,createdon,_wmkf_ai_request_value',
    filter: `_wmkf_ai_request_value eq ${rec.akoya_requestid}`,
    orderby: 'createdon desc',
    top: LIMIT,
  });

  if (!runs.records.length) {
    console.log('No wmkf_ai_run rows attached to this request.\n');
    process.exit(0);
  }

  console.log(`Found ${runs.records.length} run(s) (showing newest first, limit=${LIMIT}):\n`);

  for (const r of runs.records) {
    const task = TASK_TYPE_LABELS[r.wmkf_ai_tasktype] || `unknown(${r.wmkf_ai_tasktype})`;
    const status = STATUS_LABELS[r.wmkf_ai_status] || `unknown(${r.wmkf_ai_status})`;
    const when = new Date(r.createdon).toISOString();
    console.log('─'.repeat(80));
    console.log(`runNum:         ${r.wmkf_ai_runnum}`);
    console.log(`createdon:      ${when}`);
    console.log(`taskType:       ${task} (${r.wmkf_ai_tasktype})`);
    console.log(`status:         ${status} (${r.wmkf_ai_status})`);
    console.log(`model:          ${r.wmkf_ai_model}`);
    console.log(`promptVersion:  ${r.wmkf_ai_promptversion}`);
    console.log(`notes:          ${r.wmkf_ai_notes || '(none)'}`);
    if (showRaw) {
      console.log(`rawOutput:\n${r.wmkf_ai_rawoutput || '(empty)'}`);
    } else {
      console.log(`rawOutput:      ${truncate(r.wmkf_ai_rawoutput, 200)}`);
    }
  }
  console.log('─'.repeat(80));
  console.log(`\n${showRaw ? '' : 'Tip: pass --show-raw to print full rawOutput payloads.\n'}`);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
