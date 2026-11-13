#!/usr/bin/env node
/**
 * Times the J27 cycle-page batch reads over a large set of real Research
 * requests from past cycles, before any 2027 cycle is that large. Owner-run;
 * Dataverse GETs only (no writes).
 *
 * For each round and each concurrency level it runs, in turn:
 * - baseline: the reviewer rollup read as on main (findForRollup, 25 ids per
 *   call, sequential), which every cycle page already does;
 * - the reviewer rollup and each J27 read alone at that level: reviewer
 *   suggestions (any), pre-site-visit and Final documents (list facts only),
 *   site-visit summaries;
 * - all of them together, as the dashboard runs them (Promise.all).
 * Each round also times the request-list query for each cycle with the
 * page's own columns, cycle and program filter, but without the visibility
 * filter, so it returns every Research request in the cycle (a stand-in for
 * a large 2027 list; past cycles show staff few rows).
 * With --email, each round also runs the whole cycle-page server read
 * (`loadDashboard`, the code behind /api/workbench/dashboard) for each cycle,
 * all of Research, and prints its phases: PD lookup, program scope, and the
 * request list with the reads beside it. For pre-2027 cycles that path runs
 * no J27 reads; their cost is the J27 lines above, which run alongside.
 * Each line reports wall time, Dataverse calls, their summed and slowest
 * time, records returned, and capped / incomplete / failed reads.
 *
 * Not measured: the J27 integrity read (Postgres; Production lacks migration
 * 096), the browser, and Vercel function limits. Reads run with restrictions
 * bypassed (a script has no signed-in user), so they may return more rows
 * than a staff session; the superuser role lookup is skipped (it changes row
 * actions, not reads). Output has counts and timings only: no names or
 * request numbers; the email is used to look up the program director and is
 * not printed.
 *
 * Usage (from the J27 worktree):
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/time-j27-large-reads.cjs
 *   ... --cycles=J26,D26 --limit=300 --rounds=3 --concurrency=1,4,8 --email=<your work email>
 */
// The app's ESM leaves extensions off relative imports, which Next resolves
// and plain Node does not; resolve them here. `getUserRole` (lib/utils/auth)
// pulls in NextAuth providers that do not load outside Next; it only decides
// superuser row actions, so it is stubbed.
require('node:module').registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/\/utils\/auth(\.js)?$/.test(specifier)) {
      return { url: 'data:text/javascript,export async function getUserRole() { return null; }', shortCircuit: true };
    }
    try { return nextResolve(specifier, context); } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\//.test(specifier) || /\.[cm]?js$/.test(specifier)) throw error;
      try { return nextResolve(`${specifier}.js`, context); } catch { return nextResolve(`${specifier}/index.js`, context); }
    }
  },
});
const { loadEnvLocal, getAccessToken, createClient } = require('../lib/dataverse/client.js');

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const CYCLES = arg('cycles', 'J26,D26').split(',').map((c) => c.trim()).filter((c) => /^[A-Z]\d{2}$/.test(c));
const LIMIT = Number(arg('limit', '300'));
const ROUNDS = Number(arg('rounds', '3'));
const LEVELS = arg('concurrency', '1,4,8').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
const EMAIL = arg('email', '');

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
  return { ids: ids.slice(0, LIMIT), available: ids.length, perCycle, programId: programs[0] };
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
  const { chunk, mapBounded } = await import('../lib/utils/chunk.js');
  const { proposalListQueryShape } = await import('../lib/services/workbench/dashboard-service.js');
  const { buildProgramScopeFilter } = await import('../lib/services/workbench/program-scope-service.js');
  const { linkedCycleFilter } = await import('../lib/dataverse/adapters/operations-grant-cycle.js');
  const requests = await import('../lib/dataverse/adapters/grant-request.js');

  const { ids, available, perCycle, programId } = await researchRequestIds();
  print(`Research requests in ${CYCLES.join(', ')}: ${available} (${Object.entries(perCycle).map(([c, n]) => `${c} ${n}`).join(', ')}); timing ${ids.length}`);
  if (!ids.length) return;

  const run = (fn) => bypassDynamicsRestrictions('time-j27-large-reads', fn);
  // The rollup's read loop (lib/services/reviewer-rollup.js), at a given level.
  const rollup = (concurrency) => () => run(async () => {
    const parts = await mapBounded(chunk(ids, 25), (part) => suggestions.findForRollup(part.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')), concurrency);
    return parts.flat();
  });
  const reads = (concurrency) => ({
    'reviewer rollup': rollup(concurrency),
    'reviewer suggestions (any)': () => run(() => suggestions.existsAnySuggestionForRequests(ids, { concurrency })),
    'pre-site-visit documents': () => run(() => documents.findByRequests(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT, listFactsOnly: true, concurrency })),
    'Final documents': () => run(() => documents.findByRequests(ids, { artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP, listFactsOnly: true, concurrency })),
    'site-visit summaries': () => run(() => visits.findSummariesByRequests(ids, { concurrency })),
  });

  let pd = null;
  let loadDashboard;
  let collectWorkbenchLoadTimings;
  if (EMAIL) {
    ({ loadDashboard } = await import('../lib/services/workbench/dashboard-service.js'));
    ({ collectWorkbenchLoadTimings } = await import('../lib/services/workbench/load-timing.js'));
    const { resolveByEmail } = await import('../lib/services/program-director-resolver.js');
    pd = await run(() => resolveByEmail(EMAIL));
    if (!pd?.systemuserid) throw new Error('No active Dynamics user for that email.');
  }

  const totals = new Map();
  for (let round = 1; round <= ROUNDS; round += 1) {
    // Rotate the order so no level always runs cold.
    const order = LEVELS.map((_, i) => LEVELS[(i + round - 1) % LEVELS.length]);
    print(`\nround ${round}`);
    await timed('rollup as on main (1)', rollup(1));
    for (const level of order) {
      print(` concurrency ${level}`);
      const set = reads(level);
      for (const [label, fn] of Object.entries(set)) await timed(label, fn);
      const all = await timed('ALL TOGETHER', async () => { await Promise.all(Object.values(set).map((fn) => fn())); return null; });
      totals.set(level, [...(totals.get(level) || []), all.wall]);
    }
    for (const cycleCode of CYCLES) {
      await timed(`request list query ${cycleCode}`, () => run(() => requests.queryAllRequests({
        ...proposalListQueryShape(),
        filter: [`(${linkedCycleFilter(cycleCode)})`, buildProgramScopeFilter(programId)].join(' and '),
        orderby: 'akoya_requestnum asc',
      })));
    }
    if (pd) {
      for (const cycleCode of CYCLES) {
        let timing = null;
        await timed(`cycle page ${cycleCode} (server)`, async () => {
          timing = await run(() => collectWorkbenchLoadTimings(() => loadDashboard({
            azureEmail: EMAIL, profileId: null, callerSystemId: pd.systemuserid,
            cycleCode, scope: 'all', includeSetAside: false, programId,
          })));
          return timing.value?.proposals;
        });
        if (timing) {
          // program_catalog and program_assignments run inside program_scope.
          const before = timing.steps.filter((step) => ['pd_resolution', 'role', 'program_scope'].includes(step.name))
            .reduce((total, step) => total + step.milliseconds, 0);
          print(`    ${timing.steps.map((step) => `${step.name} ${Math.round(step.milliseconds)}`).join(', ')}, request list with reads beside it ${Math.round(timing.milliseconds - before)} (ms)`);
        }
      }
    }
  }

  print('\nall reads together (rollup included), wall ms per round:');
  for (const [level, walls] of totals) print(`  concurrency ${level}: ${walls.map((w) => Math.round(w)).join(', ')}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
