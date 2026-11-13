#!/usr/bin/env node
/**
 * Times the J27 cycle-page batch reads over a large set of real Research
 * requests from past cycles, before any 2027 cycle is that large. Owner-run;
 * Dataverse GETs only (no writes).
 *
 * For each round and each concurrency level it runs, in turn:
 * - baseline: today's reviewer rollup read (findForRollup, 25 ids per call,
 *   sequential), which every cycle page already does on main;
 * - each J27 read alone: reviewer suggestions (any), pre-site-visit and Final
 *   documents (list facts only), site-visit summaries;
 * - all of them together, as the dashboard runs them (Promise.all).
 * Each line reports wall time, Dataverse calls, their summed and slowest
 * time, records returned, and capped / incomplete / failed reads.
 *
 * Not measured: the request-list read itself, the J27 integrity read
 * (Postgres; Production lacks migration 096), the browser, and Vercel
 * function limits. Reads run with restrictions bypassed (a script has no
 * signed-in user), so they may return more rows than a staff session.
 * Output has counts and timings only: no names or request numbers.
 *
 * Usage (from the J27 worktree):
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/time-j27-large-reads.cjs
 *   ... --cycles=J26,D26 --limit=300 --rounds=3 --concurrency=1,4,8
 */
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const CYCLES = arg('cycles', 'J26,D26').split(',').map((c) => c.trim()).filter((c) => /^[A-Z]\d{2}$/.test(c));
const LIMIT = Number(arg('limit', '300'));
const ROUNDS = Number(arg('rounds', '3'));
const LEVELS = arg('concurrency', '1,4,8').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);

// Capture the client's per-call `workbench.dependency` lines instead of printing them.
let bucket = null;
const print = console.log.bind(console);
console.log = (...args) => {
  const line = args[0];
  if (typeof line === 'string' && line.startsWith('{"event":"workbench.dependency"')) {
    try { const e = JSON.parse(line); if (bucket && e.dependency === 'dataverse') bucket.push(e); } catch { /* ignore */ }
    return;
  }
  print(...args);
};

async function researchRequestIds() {
  const { PRODUCTION_HOSTS } = await import('../lib/dataverse/core/target-registry.js');
  const { readinessOnlyProgramIds } = await import('../lib/services/workbench/program-scope-service.js');
  const resourceUrl = process.env.DYNAMICS_URL;
  if (!resourceUrl || !PRODUCTION_HOSTS.includes(new URL(resourceUrl).hostname.toLowerCase())
    || process.env.DATAVERSE_ALLOW_PROD_READS !== 'yes') {
    throw new Error('Set DATAVERSE_ALLOW_PROD_READS=yes; DYNAMICS_URL must be the registered Production host.');
  }
  const client = createClient({ resourceUrl, token: await getAccessToken(resourceUrl) });
  const catalog = await client.get('/wmkf_grantprograms?$select=wmkf_grantprogramid,wmkf_name,statecode&$filter=statecode eq 0');
  if (!catalog.ok) throw new Error(`Program catalog read failed HTTP ${catalog.status}`);
  const programs = readinessOnlyProgramIds(catalog.body.value);
  if (!programs.length) throw new Error('No single active program named Research.');
  const cycles = CYCLES.map((c) => `wmkf_GrantCycle/wmkf_cyclecode eq '${c}'`).join(' or ');
  const filter = `(${programs.map((id) => `_wmkf_grantprogram_value eq ${id}`).join(' or ')}) and (${cycles})`;
  const ids = [];
  const perCycle = {};
  let next = `/akoya_requests?${new URLSearchParams({ $select: 'akoya_requestid', $filter: filter, $expand: 'wmkf_GrantCycle($select=wmkf_cyclecode)' })}`;
  while (next) {
    const page = await client.get(next);
    if (!page.ok) throw new Error(`Request read failed HTTP ${page.status}`);
    for (const row of page.body.value) {
      ids.push(row.akoya_requestid);
      const code = row.wmkf_GrantCycle?.wmkf_cyclecode || '?';
      perCycle[code] = (perCycle[code] || 0) + 1;
    }
    const link = page.body['@odata.nextLink'];
    next = link ? link.slice(link.indexOf('/akoya_requests')) : null;
  }
  return { ids: ids.slice(0, LIMIT), available: ids.length, perCycle };
}

function summarize(value) {
  if (Array.isArray(value)) return { records: value.length };
  if (value instanceof Map || value instanceof Set) return { records: value.size };
  if (value && typeof value === 'object') {
    return {
      records: Array.isArray(value.records) ? value.records.length : undefined,
      incomplete: Boolean(value.capped || value.hasMore),
    };
  }
  return { records: undefined };
}

async function timed(label, fn) {
  bucket = [];
  const started = performance.now();
  let result;
  let failed = null;
  try { result = await fn(); } catch (error) { failed = error?.message || String(error); }
  const wall = performance.now() - started;
  const calls = bucket;
  bucket = null;
  const sum = calls.reduce((total, e) => total + (Number(e.ms) || 0), 0);
  const slowest = calls.reduce((max, e) => Math.max(max, Number(e.ms) || 0), 0);
  const notOk = calls.filter((e) => e.outcome !== 'success').length;
  const info = failed ? { failed } : summarize(result);
  print(`  ${label.padEnd(28)} ${String(Math.round(wall)).padStart(6)} ms wall | ${String(calls.length).padStart(3)} calls, ${String(Math.round(sum)).padStart(6)} ms summed, slowest ${String(Math.round(slowest)).padStart(5)} ms`
    + `${notOk ? `, ${notOk} not ok` : ''} | ${info.failed ? `FAILED: ${info.failed}` : `${info.records ?? '-'} records${info.incomplete ? ', INCOMPLETE' : ''}`}`);
  return { wall, calls: calls.length };
}

async function main() {
  loadEnvLocal();
  if (!LIMIT || !ROUNDS || !LEVELS.length || !CYCLES.length) throw new Error('Check --cycles, --limit, --rounds and --concurrency.');
  const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
  const documents = await import('../lib/dataverse/adapters/request-document.js');
  const visits = await import('../lib/dataverse/adapters/site-visit.js');
  const suggestions = await import('../lib/dataverse/adapters/reviewer-suggestion.js');
  const { REQUEST_DOCUMENT_ARTIFACT_TYPE } = await import('../shared/config/requestDocument.js');
  const { chunk } = await import('../lib/utils/chunk.js');

  const { ids, available, perCycle } = await researchRequestIds();
  print(`Research requests in ${CYCLES.join(', ')}: ${available} (${Object.entries(perCycle).map(([c, n]) => `${c} ${n}`).join(', ')}); timing ${ids.length}`);
  if (!ids.length) return;

  const run = (fn) => bypassDynamicsRestrictions('time-j27-large-reads', fn);
  const rollup = () => run(async () => {
    let records = 0;
    for (const part of chunk(ids, 25)) records += (await suggestions.findForRollup(part.map((id) => `_wmkf_request_value eq ${id}`).join(' or '))).length;
    return Array.from({ length: records });
  });
  const reads = (concurrency) => ({
    'reviewer suggestions (any)': () => run(() => suggestions.existsAnySuggestionForRequests(ids, { concurrency })),
    'pre-site-visit documents': () => run(() => documents.findByRequests(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT, listFactsOnly: true, concurrency })),
    'Final documents': () => run(() => documents.findByRequests(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP, listFactsOnly: true, concurrency })),
    'site-visit summaries': () => run(() => visits.findSummariesByRequests(ids, { concurrency })),
  });

  const totals = new Map();
  for (let round = 1; round <= ROUNDS; round += 1) {
    // Rotate the order so no level always runs cold.
    const order = LEVELS.map((_, i) => LEVELS[(i + round - 1) % LEVELS.length]);
    print(`\nround ${round}`);
    await timed('baseline: reviewer rollup', rollup);
    for (const level of order) {
      print(` concurrency ${level}`);
      const set = reads(level);
      for (const [label, fn] of Object.entries(set)) await timed(label, fn);
      const all = await timed('ALL TOGETHER (+ rollup)', () => Promise.all([rollup(), ...Object.values(set).map((fn) => fn())]));
      totals.set(level, [...(totals.get(level) || []), all.wall]);
    }
  }

  print('\nall reads together, wall ms per round (includes the baseline rollup):');
  for (const [level, walls] of totals) print(`  concurrency ${level}: ${walls.map((w) => Math.round(w)).join(', ')}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
