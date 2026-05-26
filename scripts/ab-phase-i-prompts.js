#!/usr/bin/env node

/**
 * A/B multi-trial comparison of v1 (monolithic user-message) vs v2
 * (system/user split from Dynamics) Phase I prompts.
 *
 * Loads a proposal once, then fires N Claude calls per variant and collects
 * length + token + cache stats. Bypasses the Next.js endpoints entirely —
 * doesn't write to Dynamics, doesn't log to wmkf_ai_run, doesn't log to
 * api_usage_log. Pure A/B.
 *
 * Usage:
 *   node scripts/ab-phase-i-prompts.js --request <guid> --file <filename> [--trials 3]
 *
 * Example:
 *   node scripts/ab-phase-i-prompts.js \
 *     --request f053a33f-0992-ee11-be37-000d3a341fd9 \
 *     --file "Keck_RifeLevin_Phase1 2023.docx" \
 *     --trials 3
 */

import { readFileSync, writeFileSync } from 'fs';
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
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : def;
}
const REQUEST_GUID = getArg('request');
const FILENAME = getArg('file');
const TRIALS = parseInt(getArg('trials', '3'), 10);

if (!REQUEST_GUID || !FILENAME) {
  console.error('Usage: node scripts/ab-phase-i-prompts.js --request <guid> --file <filename> [--trials N]');
  process.exit(1);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { createPhaseISummarizationPrompt } = await import('../shared/config/prompts/phase-i-summaries.js');
const { KECK_GUIDELINES } = await import('../shared/config/keck-guidelines.js');
const { PromptResolver } = await import('../lib/services/prompt-resolver.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { loadFile } = await import('../lib/utils/file-loader.js');
const { BASE_CONFIG, getModelForApp, loadModelOverrides } = await import('../shared/config/baseConfig.js');

enterDynamicsBypassForScript('ab-phase-i');
await loadModelOverrides();

const model = getModelForApp('batch-phase-i');
const apiKey = process.env.CLAUDE_API_KEY;
if (!apiKey) {
  console.error('CLAUDE_API_KEY not set');
  process.exit(1);
}

// ─── 1. Look up the request → find the file → load text ──────────────────────
console.log(`[setup] Looking up request ${REQUEST_GUID}`);
const req = await DynamicsService.getRecord('akoya_requests', REQUEST_GUID, {
  select: 'akoya_requestid,akoya_requestnum',
});
const requestNum = req.akoya_requestnum;
const buckets = await getRequestSharePointBuckets(REQUEST_GUID, requestNum);

let foundFile = null;
for (const bucket of buckets) {
  try {
    const files = await GraphService.listFiles(bucket.library, bucket.folder, { recursive: true });
    const match = files.find(f => f.name === FILENAME);
    if (match) {
      foundFile = { source: 'sharepoint', library: bucket.library, folder: match.folder, filename: match.name };
      break;
    }
  } catch {}
}
if (!foundFile) {
  console.error(`[setup] Could not find "${FILENAME}" in any SharePoint bucket for request ${requestNum}`);
  process.exit(1);
}
console.log(`[setup] Found ${foundFile.filename} in ${foundFile.library}/${foundFile.folder}`);

const fileLoad = await loadFile(foundFile);
const proposalText = fileLoad.text.substring(0, 100000);
console.log(`[setup] Loaded ${proposalText.length.toLocaleString()} chars of proposal text`);

// ─── 2. Build both prompt variants ───────────────────────────────────────────
const v1Prompt = createPhaseISummarizationPrompt(proposalText, 1, 'technical-non-expert', KECK_GUIDELINES);

PromptResolver.invalidate();
const p = await PromptResolver.getPrompt('phase-i-dynamics-v2');
const v2System = PromptResolver.interpolate(p.systemPrompt, {
  summary_length: 1,
  summary_length_suffix: '',
  audience_description: 'a technical non-expert audience, using some technical terms but explaining complex concepts clearly',
});
const v2User = PromptResolver.interpolate(p.userPromptTemplate, { proposal_text: proposalText });

console.log(`[setup] v1 user msg: ${v1Prompt.length.toLocaleString()} chars`);
console.log(`[setup] v2 system: ${v2System.length.toLocaleString()} chars, user: ${v2User.length.toLocaleString()} chars`);

// ─── 3. Trial runner ─────────────────────────────────────────────────────────
async function runTrial(variant) {
  const body = variant === 'v1'
    ? {
        model,
        max_tokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
        temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
        messages: [{ role: 'user', content: v1Prompt }],
      }
    : {
        model,
        max_tokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
        temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
        system: [{ type: 'text', text: v2System, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: v2User }],
      };

  const start = Date.now();
  const resp = await fetch(BASE_CONFIG.CLAUDE.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': BASE_CONFIG.CLAUDE.ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`${variant}: Claude API error ${resp.status}: ${t.substring(0, 500)}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  return {
    variant,
    latencyMs,
    outputLength: text.length,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    cacheCreationTokens: data.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: data.usage?.cache_read_input_tokens || 0,
    text,
  };
}

// ─── 4. Run trials (interleaved so cache state is fair) ──────────────────────
console.log(`\n[trials] Running ${TRIALS} trials per variant, interleaved (v1, v2, v1, v2, ...)\n`);
const results = { v1: [], v2: [] };
for (let i = 0; i < TRIALS; i++) {
  for (const variant of ['v1', 'v2']) {
    process.stdout.write(`  trial ${i + 1} ${variant}...`);
    const r = await runTrial(variant);
    results[variant].push(r);
    process.stdout.write(` ${r.outputLength} chars, in=${r.inputTokens} cache_w=${r.cacheCreationTokens} cache_r=${r.cacheReadTokens} ${r.latencyMs}ms\n`);
  }
}

// ─── 5. Aggregate + print ────────────────────────────────────────────────────
function stats(arr, key) {
  const vals = arr.map(r => r[key]);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { avg: Math.round(avg), min, max };
}
console.log('\n--- Summary ---');
for (const variant of ['v1', 'v2']) {
  const r = results[variant];
  const len = stats(r, 'outputLength');
  const inTok = stats(r, 'inputTokens');
  const outTok = stats(r, 'outputTokens');
  const cacheW = stats(r, 'cacheCreationTokens');
  const cacheR = stats(r, 'cacheReadTokens');
  const lat = stats(r, 'latencyMs');
  console.log(`\n${variant.toUpperCase()} (${r.length} trials)`);
  console.log(`  output chars:    avg ${len.avg.toLocaleString()}  min ${len.min.toLocaleString()}  max ${len.max.toLocaleString()}`);
  console.log(`  input tokens:    avg ${inTok.avg.toLocaleString()}  (regular, non-cache)`);
  console.log(`  cache write tok: avg ${cacheW.avg.toLocaleString()}`);
  console.log(`  cache read tok:  avg ${cacheR.avg.toLocaleString()}`);
  console.log(`  output tokens:   avg ${outTok.avg.toLocaleString()}`);
  console.log(`  latency:         avg ${lat.avg}ms  min ${lat.min}ms  max ${lat.max}ms`);
}

// Save full outputs for inspection
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = `/tmp/ab-phase-i-${ts}.json`;
writeFileSync(outPath, JSON.stringify({
  request: REQUEST_GUID,
  file: FILENAME,
  requestNum,
  model,
  trials: TRIALS,
  results,
}, null, 2));
console.log(`\nFull outputs saved to ${outPath}`);
