#!/usr/bin/env node

/**
 * READ-ONLY probe: list recent wmkf_ai_run rows and parse prompt-cache
 * telemetry (in/out/cache_create/cache_read/cacheHit/latency) out of the
 * wmkf_ai_notes string that lib/services/execute-prompt.js's
 * buildSuccessNotes() writes (~line 1195), via writeRunRow() (~line 1096).
 *
 * This script makes ONLY `queryRecords` (GET) calls through DynamicsService —
 * it never creates, updates, or deletes any Dataverse row. It does NOT select
 * wmkf_ai_rawoutput.
 *
 * It reaches whatever Dataverse environment your local .env / .env.local
 * point at — this is PRODUCTION when .env.local is configured that way. Per
 * CLAUDE.md, the owner of the credentials runs this, not a delegated agent
 * without explicit authorization.
 *
 * Usage:
 *   node scripts/probe-ai-run-cache-reads.js
 *   node scripts/probe-ai-run-cache-reads.js --limit 25
 *   node scripts/probe-ai-run-cache-reads.js --request 992629
 *   node scripts/probe-ai-run-cache-reads.js --prompt phase-i.summary
 *   node scripts/probe-ai-run-cache-reads.js --since 2026-09-01T00:00:00Z --limit 50
 *
 * Note: DynamicsService.queryRecords rejects an unfiltered query with
 * --limit > 25 (lib/services/dynamics/read-ops.js) — pass --prompt,
 * --request, or --since (or keep --limit <= 25) to query with no filter.
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
const odata = await import('../lib/dataverse/core/odata.js');
enterDynamicsBypassForScript('probe-ai-run-cache-reads');

function getFlagValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function usageAndExit(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error(
    'Usage: node scripts/probe-ai-run-cache-reads.js [--prompt <name>] [--request <requestnum>] [--limit N] [--since <ISO date>]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);

const promptName = getFlagValue(args, '--prompt');
const requestArg = getFlagValue(args, '--request');
const limitArg = getFlagValue(args, '--limit');
const sinceArg = getFlagValue(args, '--since');

let LIMIT = 10;
if (limitArg !== undefined) {
  if (!/^\d+$/.test(limitArg)) usageAndExit(`--limit must be a positive integer, got "${limitArg}"`);
  LIMIT = parseInt(limitArg, 10);
  if (LIMIT < 1 || LIMIT > 100) usageAndExit('--limit must be between 1 and 100');
}

let REQUEST_NUM = null;
if (requestArg !== undefined) {
  if (!/^\d+$/.test(requestArg)) usageAndExit(`--request must be numeric, got "${requestArg}"`);
  REQUEST_NUM = requestArg;
}

let SINCE_ISO = null;
if (sinceArg !== undefined) {
  const parsed = new Date(sinceArg);
  if (Number.isNaN(parsed.getTime())) usageAndExit(`--since must be a valid date, got "${sinceArg}"`);
  // Normalize to a full UTC ISO instant so the OData literal is unambiguous
  // (a bare date or zone-less datetime against a DateTimeOffset column is not
  // something to guess at against a live environment).
  SINCE_ISO = parsed.toISOString();
}

/**
 * Defensively parse the `wmkf_ai_notes` string produced by
 * lib/services/execute-prompt.js buildSuccessNotes(), e.g.:
 *   "latency=1234ms; semanticAttempt=1; tokens in=100/out=50/cache_create=1500/cache_read=0; cacheHit=false; ..."
 * Missing/unparseable fields come back as null so the caller can print "?".
 */
function parseNotes(notes) {
  const out = {
    latencyMs: null,
    tokensIn: null,
    tokensOut: null,
    cacheCreate: null,
    cacheRead: null,
    cacheHit: null,
  };
  if (typeof notes !== 'string' || !notes) return out;

  const latencyMatch = notes.match(/latency=(\d+)ms/);
  if (latencyMatch) out.latencyMs = parseInt(latencyMatch[1], 10);

  const tokensMatch = notes.match(
    /tokens in=(\d+)\/out=(\d+)\/cache_create=(\d+)\/cache_read=(\d+)/
  );
  if (tokensMatch) {
    out.tokensIn = parseInt(tokensMatch[1], 10);
    out.tokensOut = parseInt(tokensMatch[2], 10);
    out.cacheCreate = parseInt(tokensMatch[3], 10);
    out.cacheRead = parseInt(tokensMatch[4], 10);
  }

  const cacheHitMatch = notes.match(/cacheHit=(true|false)/);
  if (cacheHitMatch) out.cacheHit = cacheHitMatch[1] === 'true';

  return out;
}

function fmt(v) {
  return v === null || v === undefined ? '?' : String(v);
}

async function resolvePromptGuids(name) {
  // A prompt name can have multiple rows (versions/status); match runs bound
  // to ANY of them, not just the current one, so historical runs still show.
  const filter = odata.eq('wmkf_ai_promptname', name);
  const res = await DynamicsService.queryRecords('wmkf_ai_prompts', {
    select: 'wmkf_ai_promptid,wmkf_ai_promptname',
    filter,
    top: 50,
  });
  return res.records.map((r) => r.wmkf_ai_promptid);
}

async function resolveRequestGuid(requestNum) {
  const filter = odata.eq('akoya_requestnum', requestNum);
  const res = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum',
    filter,
    top: 1,
  });
  return res.records[0]?.akoya_requestid || null;
}

async function main() {
  console.log('\n=== READ-ONLY probe: wmkf_ai_run cache telemetry ===\n');

  const filterParts = [];

  if (promptName) {
    const promptIds = await resolvePromptGuids(promptName);
    if (promptIds.length === 0) {
      console.error(`No wmkf_ai_prompts row found with wmkf_ai_promptname "${promptName}"`);
      process.exit(1);
    }
    const promptClauses = promptIds.map((id) => odata.eqGuid('_wmkf_ai_prompt_value', id));
    filterParts.push(`(${odata.or(promptClauses)})`);
    console.log(`Prompt filter: "${promptName}" -> ${promptIds.length} prompt row id(s)\n`);
  }

  if (REQUEST_NUM) {
    const requestId = await resolveRequestGuid(REQUEST_NUM);
    if (!requestId) {
      console.error(`No akoya_request found with requestnum ${REQUEST_NUM}`);
      process.exit(1);
    }
    filterParts.push(odata.eqGuid('_wmkf_ai_request_value', requestId));
    console.log(`Request filter: ${REQUEST_NUM} -> ${requestId}\n`);
  }

  if (SINCE_ISO) {
    filterParts.push(`createdon ge ${SINCE_ISO}`);
  }

  const filter = filterParts.length > 0 ? odata.and(filterParts) : undefined;

  const runs = await DynamicsService.queryRecords('wmkf_ai_runs', {
    select: [
      'wmkf_ai_runid',
      'wmkf_ai_runnum',
      'createdon',
      'wmkf_ai_status',
      'wmkf_ai_model',
      'wmkf_ai_promptversion',
      '_wmkf_ai_request_value',
      '_wmkf_ai_prompt_value',
      'wmkf_ai_notes',
    ].join(','),
    filter,
    orderby: 'createdon desc',
    top: LIMIT,
  });

  if (!runs.records.length) {
    console.log('No wmkf_ai_run rows matched.\n');
    process.exit(0);
  }

  const STATUS_LABELS = {
    682090000: 'completed',
    682090001: 'failed',
    682090002: 'needs-review',
  };

  // Resolve prompt row ids -> names with one extra read so each row shows
  // which Executor prompt produced it (the lookup's formatted value is the
  // prompt row's primary name, which may not be wmkf_ai_promptname).
  const promptNameById = new Map();
  const promptIds = [...new Set(runs.records.map((r) => r._wmkf_ai_prompt_value).filter(Boolean))];
  if (promptIds.length > 0) {
    const res = await DynamicsService.queryRecords('wmkf_ai_prompts', {
      select: 'wmkf_ai_promptid,wmkf_ai_promptname',
      filter: odata.or(promptIds.map((id) => odata.eqGuid('wmkf_ai_promptid', id))),
      top: promptIds.length,
    });
    for (const p of res.records) promptNameById.set(p.wmkf_ai_promptid, p.wmkf_ai_promptname);
  }

  const header = [
    'createdon'.padEnd(24),
    'prompt'.padEnd(30),
    'request'.padEnd(14),
    'model'.padEnd(24),
    'ver'.padEnd(4),
    'status'.padEnd(12),
    'in'.padEnd(6),
    'out'.padEnd(6),
    'cache_c'.padEnd(8),
    'cache_r'.padEnd(8),
    'hit'.padEnd(6),
    'latency',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  let cacheReadCount = 0;
  let cacheCreateCount = 0;

  for (const r of runs.records) {
    const when = r.createdon ? new Date(r.createdon).toISOString() : '?';
    const status = STATUS_LABELS[r.wmkf_ai_status] || fmt(r.wmkf_ai_status);
    // The Prefer: odata.include-annotations header (lib/services/dynamics/http.js)
    // + processAnnotations (lib/services/dynamics/annotations.js) turn
    // `_wmkf_ai_request_value@OData.Community.Display.V1.FormattedValue` into
    // `_wmkf_ai_request_value_formatted` — the linked akoya_request's display
    // name/number, cheap because it rides along on this same query. Fall back
    // to the raw guid if that annotation isn't present.
    const requestLabel = r._wmkf_ai_request_value_formatted || fmt(r._wmkf_ai_request_value);
    const parsed = parseNotes(r.wmkf_ai_notes);

    if (parsed.cacheRead) cacheReadCount++;
    if (parsed.cacheCreate) cacheCreateCount++;

    const promptLabel = promptNameById.get(r._wmkf_ai_prompt_value)
      || r._wmkf_ai_prompt_value_formatted
      || fmt(r._wmkf_ai_prompt_value);

    console.log(
      [
        when.padEnd(24),
        String(promptLabel).slice(0, 29).padEnd(30),
        requestLabel.padEnd(14),
        String(r.wmkf_ai_model || '?').padEnd(24),
        fmt(r.wmkf_ai_promptversion).padEnd(4),
        status.padEnd(12),
        fmt(parsed.tokensIn).padEnd(6),
        fmt(parsed.tokensOut).padEnd(6),
        fmt(parsed.cacheCreate).padEnd(8),
        fmt(parsed.cacheRead).padEnd(8),
        fmt(parsed.cacheHit).padEnd(6),
        parsed.latencyMs !== null ? `${parsed.latencyMs}ms` : '?',
      ].join(' ')
    );
  }

  console.log('-'.repeat(header.length));
  console.log(
    `\n${runs.records.length} row(s): ${cacheReadCount} with cache_read>0, ${cacheCreateCount} with cache_create>0.\n`
  );
}

main().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
