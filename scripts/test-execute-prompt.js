#!/usr/bin/env node

/**
 * Smoke test for lib/services/execute-prompt.js (Phase 0 Executor).
 *
 * Exercises the full flow against a known prod request (wmkf.crm.dynamics.com):
 *   - prompt resolution from wmkf_ai_prompts (phase-i.summary)
 *   - SharePoint variable resolution (walks active + archive libraries)
 *   - Claude call + response parse (parseMode=raw)
 *   - Output guard preflight (skip-if-populated on wmkf_ai_summary)
 *   - Writeback to akoya_request.wmkf_ai_summary with If-Match
 *   - wmkf_ai_run row creation with Lookup populated
 *
 * Default test request: 993879 (Carter/UNC-CH) — Project Narrative is in
 * RequestArchive3, so this also confirms the multi-bucket walker.
 *
 * Modes:
 *   --request <number>            override the test request number
 *   --force-overwrite             pass forceOverwrite: true (default false)
 *   --restore <text-or-empty>     after the test, PATCH wmkf_ai_summary back
 *                                 to the supplied value (use "" to clear)
 *
 * Typical sequences:
 *   # Dry — block-on-populated path (run after a previous successful run)
 *   node scripts/test-execute-prompt.js
 *
 *   # First write (assumes wmkf_ai_summary is empty)
 *   node scripts/test-execute-prompt.js
 *
 *   # Force overwrite + cache-hit confirmation
 *   node scripts/test-execute-prompt.js --force-overwrite
 *   node scripts/test-execute-prompt.js --force-overwrite   # 2nd run, cacheHit=true
 *
 *   # Reset the field after testing
 *   node scripts/test-execute-prompt.js --restore ""
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
const FORCE_OVERWRITE = args.includes('--force-overwrite');
const RESTORE = (() => {
  const i = args.indexOf('--restore');
  return i >= 0 ? (args[i + 1] ?? '') : null;
})();

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { extractTextFromBuffer } = await import('../lib/utils/file-loader.js');
const { executePrompt } = await import('../lib/services/execute-prompt.js');
enterDynamicsBypassForScript('test-execute-prompt');

// Look up the request GUID by number
const lookup = await DynamicsService.queryRecords('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,wmkf_ai_summary',
  filter: `akoya_requestnum eq '${REQUEST_NUMBER}'`,
  top: 1,
});
const target = (lookup.records || [])[0];
if (!target) {
  console.error(`✗ Request ${REQUEST_NUMBER} not found`);
  process.exit(1);
}
console.log(`Target: ${target.akoya_requestnum}`);
console.log(`  GUID: ${target.akoya_requestid}`);
console.log(`  current wmkf_ai_summary length: ${(target.wmkf_ai_summary || '').length}`);
console.log(`  forceOverwrite: ${FORCE_OVERWRITE}`);
console.log('');

if (RESTORE !== null) {
  const v = RESTORE === '' ? null : RESTORE;
  await DynamicsService.updateRecord('akoya_requests', target.akoya_requestid, { wmkf_ai_summary: v });
  console.log(`✓ Restored wmkf_ai_summary to ${v === null ? 'null' : `"${v.slice(0, 40)}..."`}`);
  process.exit(0);
}

// Mimic what the future summarize-v2 route does: pick the largest narrative-
// looking PDF/DOCX from any of the request's SharePoint buckets and load it.
console.log('Loading proposal text from SharePoint…');
const buckets = await getRequestSharePointBuckets(target.akoya_requestid, target.akoya_requestnum);
let chosen = null;
for (const b of buckets) {
  let files;
  try { files = await GraphService.listFiles(b.library, b.folder, { recursive: true }); }
  catch { continue; }
  // Prefer files that look like proposal narratives; fall back to largest PDF/DOCX.
  const docs = (files || []).filter(f => /\.(pdf|docx)$/i.test(f.name));
  const narrative = docs.find(f => /(project[_\s-]?narrative|narrative|proposal|summary)/i.test(f.name));
  const pick = narrative || docs.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  if (pick) { chosen = { ...b, file: pick }; break; }
}
if (!chosen) { console.error('✗ No suitable proposal file found'); process.exit(1); }
console.log(`  picked: [${chosen.library}] ${chosen.file.name} (${chosen.file.size || '?'} bytes)`);

const downloaded = await GraphService.downloadFileByPath(chosen.library, chosen.file.folder || chosen.folder, chosen.file.name);
const proposalText = await extractTextFromBuffer(downloaded.buffer, chosen.file.name, downloaded.mimeType);
console.log(`  extracted: ${proposalText.length.toLocaleString()} chars\n`);

const startedAt = Date.now();
let result;
try {
  result = await executePrompt({
    promptName: 'phase-i.summary',
    requestId: target.akoya_requestid,
    overrideVariables: {
      proposal_text: proposalText.substring(0, 100000),
      summary_length: 1,
      summary_length_suffix: '',
      audience_description:
        'a technical non-expert audience, using some technical terms but explaining complex concepts clearly',
    },
    runSource: 'Vercel Test',
    forceOverwrite: FORCE_OVERWRITE,
  });
} catch (err) {
  console.error(`✗ executePrompt threw: ${err.message}`);
  if (err.runId) console.error(`  failure run row: ${err.runId}`);
  process.exit(1);
}

const elapsedMs = Date.now() - startedAt;
console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`runId:    ${result.runId}`);
console.log(`blocked:  ${result.blocked}`);
console.log(`cacheHit: ${result.cacheHit}`);

if (result.blocked) {
  console.log(`conflicts:`);
  for (const c of result.conflicts) {
    console.log(`  - ${c.field} (${c.existingLength} chars, modifiedOn=${c.modifiedOn})`);
  }
  console.log('\n(re-run with --force-overwrite to proceed)');
  process.exit(0);
}

console.log(`writes:`);
for (const w of result.writeResults.results) {
  console.log(`  ${w.ok ? '✓' : '✗'} ${w.output} → ${w.field}${w.jsonPath ? w.jsonPath : ''}${w.ok ? '' : ` (${w.reason}: ${w.error})`}`);
}
console.log(`\nparsed.summary preview (first 240):`);
console.log('  ' + (result.parsed?.summary || '').substring(0, 240).replace(/\n/g, '\n  ') + '…');

// Verify the run row landed with the lookup populated
const run = await DynamicsService.getRecord('wmkf_ai_runs', result.runId, {
  select: 'wmkf_ai_status,wmkf_ai_runsource,wmkf_ai_promptversion,_wmkf_ai_prompt_value,_wmkf_ai_request_value',
});
console.log(`\nrun row verification:`);
console.log(`  status=${run.wmkf_ai_status_formatted || run.wmkf_ai_status}`);
console.log(`  source=${run.wmkf_ai_runsource_formatted || run.wmkf_ai_runsource}`);
console.log(`  promptVersion=${run.wmkf_ai_promptversion}`);
console.log(`  prompt lookup → ${run._wmkf_ai_prompt_value || '(missing)'}`);
console.log(`  request lookup → ${run._wmkf_ai_request_value || '(missing)'}`);
