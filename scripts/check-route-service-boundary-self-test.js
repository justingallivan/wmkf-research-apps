#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-route-service-boundary.js.
 *
 * Builds an isolated fixture tree under a temp dir and runs the census with
 * --root so real application files are never touched, and so fixture files
 * containing adapter/dynamics-service import strings cannot trip the repo's
 * own scanner gates (the fixtures live under a temp root, NEVER under pages/).
 *
 * RED fixtures prove the adapter-source family inherits the hardened scanner
 * behavior, not just the trivial direct case:
 *   (a) direct adapter import
 *   (b) adapter import via in-file alias
 *   (c) adapter re-export through a wrapper module consumed by a route
 *   (d) dynamic import() of an adapter source
 *   (e) inline require('<adapter>')... chain
 *   (f) dynamics-service import (the second source family)
 *   (g) a root-level pages/api/*.js route with a boundary import (proves
 *       root-level files are classified, not skipped)
 *   (h) ESM import-then-export-named wrapper (`import { x } from '<adapter>';
 *       export { x }`) consumed by a route -- the binding is re-published by
 *       identity, which plain `export ... from` detection misses.
 *   (i) CJS `const a = require('<adapter>'); module.exports = { a }` wrapper
 *       consumed by a route.
 *   (s) CJS LATE-ASSIGNED literal wrapper (`let a; a = require('<adapter>');
 *       module.exports = a`) consumed by a route -- provenance must survive
 *       late assignment, not only declarator initialization.
 *   (t) CJS ALIAS-CHAIN literal wrapper (`const a = require('<adapter>');
 *       const b = a; const c = b; module.exports = c`) consumed by a route --
 *       length-3 chain proves the alias-provenance fixpoint, not just one hop.
 *
 * HARD-FAIL fixtures prove non-literal require()/import() sources fail CLOSED
 * instead of silently evading the census:
 *   (j) route with a non-literal dynamic import(p) of an adapter path
 *   (k) route with a non-literal require(adapterPath)
 *   (m) route consuming a wrapper whose non-literal require() sits in a
 *       module.exports re-export position (unresolved-equivalent, reachable)
 *   (n)(o)(p) route consuming a wrapper that binds a non-literal require() to
 *       a LOCAL (`const a = require(p)`) and identity-exports it via
 *       `module.exports = a` / `module.exports = { a }` / `exports.a = a` --
 *       the local-binding hop that reexport-position detection alone misses
 *   (r) route consuming a wrapper that LATE-ASSIGNS a non-literal require()
 *       (`let a; a = require(p); module.exports = a`) -- assignment-carried
 *       provenance for the unresolved path
 *   (u) route consuming a wrapper that ALIASES a non-literal require()
 *       (`const a = require(p); let b; b = a; module.exports = b`) --
 *       alias-carried provenance for the unresolved path
 *
 * GREEN fixtures: a clean shell route; a route importing only a per-domain
 * lib/services/<domain>/ service (which USES an adapter internally but does
 * not re-export it); the exempt dirs (pages/api/dynamics-explorer/,
 * pages/api/dataverse-export/) which are never counted; (l) a route
 * importing a service that itself imports an adapter and exports its OWN
 * wrapper function (NOT the imported binding) -- the false-positive guard that
 * keeps binding-level taint from firing on legitimate services; and (q) a
 * lazy-backend service holding a non-literal require() result in a
 * module-scope local while exporting only its OWN functions (the live
 * app-access/database/settings-service shape) -- must NOT fail closed.
 *
 * LAW MODE (Stage 7): the default run must exit non-zero naming EVERY red
 * route (no baseline, no ratchet — zero boundary routes is the only passing
 * state), and a green-only fixture tree must exit 0.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-route-service-boundary.js');
const tempRoot = path.join(repoRoot, '.route_service_boundary_selftest_tmp');

const RED_ROUTES = [
  'pages/api/workbench/red-direct.js',
  'pages/api/workbench/red-alias.js',
  'pages/api/reviewer-finder/red-reexport.js',
  'pages/api/admin/red-dynamic.js',
  'pages/api/cron/red-require.js',
  'pages/api/review-manager/red-dynamics.js',
  'pages/api/red-root.js',
  'pages/api/reviewer-finder/red-import-then-export.js',
  'pages/api/cron/red-cjs-reexport.js',
  'pages/api/workbench/red-late-assign.js',
  'pages/api/admin/red-alias-chain.js',
];

const GREEN_ROUTES = [
  'pages/api/workbench/green-shell.js',
  'pages/api/review-manager/green-service.js',
  'pages/api/dynamics-explorer/chat.js',
  'pages/api/dataverse-export/thing.js',
  'pages/api/review-manager/green-own-wrapper.js',
];

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('.route_service_boundary_selftest_tmp');

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runGate(args = []) {
  try {
    const output = execSync(`node ${JSON.stringify(gate)} --root ${JSON.stringify(tempRoot)} ${args.join(' ')}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status || 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function setupFixtures() {
  cleanup();

  // Boundary sources + a thin re-export wrapper + a legitimate domain service.
  write(tempRoot, 'lib/dataverse/adapters/reviewer-suggestion.js', `
    export function getById(id) { return { id }; }
    export function updateById(id, patch) { return { id, patch }; }
  `);
  write(tempRoot, 'lib/services/dynamics-service.js', `
    export const DynamicsService = { queryRecords() {} };
  `);
  write(tempRoot, 'lib/wrappers/suggestion-wrapper.js', `
    export * from '../dataverse/adapters/reviewer-suggestion.js';
  `);
  // (h) import-then-export-named wrapper: pulls a boundary binding and
  // re-publishes it by identity (no `export ... from`).
  write(tempRoot, 'lib/wrappers/import-then-export-wrapper.js', `
    import { getById } from '../dataverse/adapters/reviewer-suggestion.js';
    export { getById };
  `);
  // (i) CJS wrapper: whole adapter module cached then re-exported by identity.
  write(tempRoot, 'lib/wrappers/cjs-reexport-wrapper.js', `
    const a = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = { a };
  `);
  // (s) CJS wrapper: LATE-ASSIGNED literal adapter require, identity-exported.
  write(tempRoot, 'lib/wrappers/late-assign-wrapper.js', `
    let a;
    a = require('../dataverse/adapters/reviewer-suggestion.js');
    module.exports = a;
  `);
  // (t) CJS wrapper: literal adapter require laundered through a length-3
  // same-file alias chain before the identity export.
  write(tempRoot, 'lib/wrappers/alias-chain-wrapper.js', `
    const a = require('../dataverse/adapters/reviewer-suggestion.js');
    const b = a;
    const c = b;
    module.exports = c;
  `);
  // Legitimate per-domain service: USES an adapter, does NOT re-export it.
  write(tempRoot, 'lib/services/review-manager/withdraw-sufficient-service.js', `
    import { getById } from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return getById(id); }
  `);
  // (l) Legitimate service: imports a boundary binding and exports its OWN
  // wrapper function (fetchThing), NOT the imported binding. Binding-level taint
  // must NOT fire on a consumer that imports only fetchThing.
  write(tempRoot, 'lib/services/review-manager/own-wrapper-service.js', `
    import { getById } from '../../dataverse/adapters/reviewer-suggestion.js';
    export function fetchThing(id) { return getById(id); }
  `);

  // (a) direct adapter import
  write(tempRoot, 'pages/api/workbench/red-direct.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  // (b) adapter import via in-file alias
  write(tempRoot, 'pages/api/workbench/red-alias.js', `
    import * as suggestionAdapter from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    const adapter = suggestionAdapter;
    export default function handler(req, res) { return adapter.getById(req.query.id); }
  `);

  // (c) adapter re-export through a wrapper module consumed by a route
  write(tempRoot, 'pages/api/reviewer-finder/red-reexport.js', `
    import { getById } from '../../../lib/wrappers/suggestion-wrapper.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  // (d) dynamic import() of an adapter source
  write(tempRoot, 'pages/api/admin/red-dynamic.js', `
    export default async function handler(req, res) {
      const m = await import('../../../lib/dataverse/adapters/reviewer-suggestion.js');
      return m.getById(req.query.id);
    }
  `);

  // (e) inline require('<adapter>')... chain
  write(tempRoot, 'pages/api/cron/red-require.js', `
    export default function handler(req, res) {
      return require('../../../lib/dataverse/adapters/reviewer-suggestion.js').getById(req.query.id);
    }
  `);

  // (f) dynamics-service import (second source family)
  write(tempRoot, 'pages/api/review-manager/red-dynamics.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default function handler(req, res) { return DynamicsService.queryRecords(); }
  `);

  // (g) root-level pages/api/*.js route with a boundary import
  write(tempRoot, 'pages/api/red-root.js', `
    import { getById } from '../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  // (h) route consuming the import-then-export wrapper by the tainted name
  write(tempRoot, 'pages/api/reviewer-finder/red-import-then-export.js', `
    import { getById } from '../../../lib/wrappers/import-then-export-wrapper.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  // (i) route consuming the CJS re-export wrapper by the tainted name
  write(tempRoot, 'pages/api/cron/red-cjs-reexport.js', `
    import { a } from '../../../lib/wrappers/cjs-reexport-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);

  // (s) route consuming the late-assigned literal wrapper
  write(tempRoot, 'pages/api/workbench/red-late-assign.js', `
    import a from '../../../lib/wrappers/late-assign-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);

  // (t) route consuming the alias-chain literal wrapper
  write(tempRoot, 'pages/api/admin/red-alias-chain.js', `
    import c from '../../../lib/wrappers/alias-chain-wrapper.js';
    export default function handler(req, res) { return c.getById(req.query.id); }
  `);

  // GREEN: clean shell route
  write(tempRoot, 'pages/api/workbench/green-shell.js', `
    export default function handler(req, res) { res.status(200).end(); }
  `);

  // GREEN: imports only a per-domain service (which uses an adapter internally)
  write(tempRoot, 'pages/api/review-manager/green-service.js', `
    import { run } from '../../../lib/services/review-manager/withdraw-sufficient-service.js';
    export default async function handler(req, res) { return run(req.query.id); }
  `);

  // (l) GREEN: imports a service's OWN wrapper function (not the re-exported
  // boundary binding). Binding-level taint must not fire here.
  write(tempRoot, 'pages/api/review-manager/green-own-wrapper.js', `
    import { fetchThing } from '../../../lib/services/review-manager/own-wrapper-service.js';
    export default async function handler(req, res) { return fetchThing(req.query.id); }
  `);

  // GREEN: exempt dirs are never counted, even with a direct boundary import
  write(tempRoot, 'pages/api/dynamics-explorer/chat.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler() { return getById('x'); }
  `);
  write(tempRoot, 'pages/api/dataverse-export/thing.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default function handler() { return DynamicsService.queryRecords(); }
  `);
}

function runDetectionAssertions() {
  setupFixtures();

  const run = runGate(['--json']);
  expect(run.status === 0, `--json exited ${run.status}\n${run.output}`);
  const entries = JSON.parse(run.output);
  const files = new Set(entries.map((e) => e.file));

  for (const red of RED_ROUTES) {
    expect(files.has(red), `RED fixture not flagged: ${red}\nflagged: ${[...files].join(', ')}`);
  }
  for (const green of GREEN_ROUTES) {
    expect(!files.has(green), `GREEN fixture wrongly flagged: ${green}`);
  }
  expect(entries.length === RED_ROUTES.length,
    `expected exactly ${RED_ROUTES.length} boundary routes, got ${entries.length}`);

  // (g) root-level routes carry the '(root)' domain (not skipped).
  const root = entries.find((e) => e.file === 'pages/api/red-root.js');
  expect(root && root.domain === '(root)',
    `root-level route not attributed to the (root) domain: ${JSON.stringify(root)}`);

  // (c) re-export taint attributed to the wrapper.
  const reexport = entries.find((e) => e.file === 'pages/api/reviewer-finder/red-reexport.js');
  expect(reexport && /re-export via .*wrapper/.test(reexport.reason),
    `re-export route reason did not name the wrapper: ${JSON.stringify(reexport)}`);

  // (h) import-then-export taint names the specific re-exported binding + wrapper.
  const importThenExport = entries.find((e) => e.file === 'pages/api/reviewer-finder/red-import-then-export.js');
  expect(importThenExport && /binding '.*' re-export via .*import-then-export-wrapper/.test(importThenExport.reason),
    `import-then-export route reason did not name the binding/wrapper: ${JSON.stringify(importThenExport)}`);

  // (i) CJS re-export taint attributed to the wrapper.
  const cjsReexport = entries.find((e) => e.file === 'pages/api/cron/red-cjs-reexport.js');
  expect(cjsReexport && /re-export via .*cjs-reexport-wrapper/.test(cjsReexport.reason),
    `CJS re-export route reason did not name the wrapper: ${JSON.stringify(cjsReexport)}`);

  // (s) late-assigned literal wrapper taint attributed to the wrapper.
  const lateAssign = entries.find((e) => e.file === 'pages/api/workbench/red-late-assign.js');
  expect(lateAssign && /re-export via .*late-assign-wrapper/.test(lateAssign.reason),
    `late-assign route reason did not name the wrapper: ${JSON.stringify(lateAssign)}`);

  // (t) alias-chain literal wrapper taint attributed to the wrapper.
  const aliasChain = entries.find((e) => e.file === 'pages/api/admin/red-alias-chain.js');
  expect(aliasChain && /re-export via .*alias-chain-wrapper/.test(aliasChain.reason),
    `alias-chain route reason did not name the wrapper: ${JSON.stringify(aliasChain)}`);

  console.log(`PASS detection assertions (${entries.length} boundary routes; ${GREEN_ROUTES.length} green untouched)`);
}

function runReportAssertions() {
  setupFixtures();
  const run = runGate(['--report']);
  expect(run.status === 0, `--report exited ${run.status}\n${run.output}`);
  expect(run.output.includes('Route-service boundary census'), 'report missing header');
  expect(run.output.includes('law mode since Stage 7'), 'report missing law-mode banner');
  expect(run.output.includes('## Boundary-importing routes'), 'report missing route listing');
  expect(run.output.includes('| workbench |'), 'report missing the domain rollup');
  console.log('PASS report assertions');
}

// Stage 7 LAW MODE: the default run fails closed on ANY in-scope boundary
// route -- exit non-zero, naming every red route -- with no baseline involved.
// Greens (incl. exempt dirs) never appear; a green-only tree exits 0.
function runLawModeAssertions() {
  setupFixtures();

  const red = runGate([]);
  expect(red.status !== 0, `law mode should fail with boundary routes present, exited 0:\n${red.output}`);
  expect(red.output.includes('LAW VIOLATION'), `expected LAW VIOLATION message, got:\n${red.output}`);
  for (const route of RED_ROUTES) {
    expect(red.output.includes(route), `law failure did not name ${route}:\n${red.output}`);
  }
  for (const green of GREEN_ROUTES) {
    expect(!red.output.includes(green), `law failure wrongly named GREEN fixture ${green}:\n${red.output}`);
  }
  expect(!fs.existsSync(path.join(repoRoot, 'scripts', 'route-service-boundary-baseline.json')),
    'law mode must have no baseline file (scripts/route-service-boundary-baseline.json should be deleted)');

  // Green-only tree: strip every red route and wrapper-consuming route; the
  // remaining shells/services/exempt dirs must pass law mode with exit 0.
  for (const route of RED_ROUTES) {
    fs.rmSync(path.join(tempRoot, route), { force: true });
  }
  const green = runGate([]);
  expect(green.status === 0, `law mode should pass on a green-only tree, got:\n${green.output}`);

  console.log(`PASS law-mode assertions (${RED_ROUTES.length} reds named, greens clean, green-only tree exits 0, no baseline file)`);
}

// (j)(k)(m) Non-literal require()/import() sources must fail CLOSED: a plain
// census cannot resolve them, so instead of silently evading detection the gate
// hard-errors with file:line. Pre-patch these passed silently (fail OPEN).
function runUnresolvedFailClosedAssertions() {
  cleanup();
  write(tempRoot, 'lib/dataverse/adapters/reviewer-suggestion.js', `
    export function getById(id) { return { id }; }
  `);
  // (m) wrapper whose non-literal require sits in a module.exports re-export
  // position -- its published identity is an unknowable boundary source.
  write(tempRoot, 'lib/wrappers/unresolved-reexport-wrapper.js', `
    module.exports = require(process.env.ADAPTER_PATH);
  `);

  // (j) route: non-literal dynamic import(p) of an adapter path
  write(tempRoot, 'pages/api/admin/red-unresolved-import.js', `
    export default async function handler(req, res) {
      const p = '../../../lib/dataverse/adapters/reviewer-suggestion.js';
      const m = await import(p);
      return m.getById(req.query.id);
    }
  `);
  // (k) route: non-literal require(adapterPath)
  write(tempRoot, 'pages/api/cron/red-unresolved-require.js', `
    export default function handler(req, res) {
      const p = '../../../lib/dataverse/adapters/reviewer-suggestion.js';
      return require(p).getById(req.query.id);
    }
  `);
  // (m) route consuming the unresolved-equivalent wrapper
  write(tempRoot, 'pages/api/workbench/red-unresolved-wrapper.js', `
    import { getById } from '../../../lib/wrappers/unresolved-reexport-wrapper.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  // (n)(o)(p) wrappers binding a non-literal require() to a LOCAL and
  // identity-exporting it -- the local-binding hop.
  write(tempRoot, 'lib/wrappers/n-local-namespace-wrapper.js', `
    const a = require(process.env.ADAPTER_PATH);
    module.exports = a;
  `);
  write(tempRoot, 'lib/wrappers/o-local-object-wrapper.js', `
    const a = require(process.env.ADAPTER_PATH);
    module.exports = { a };
  `);
  write(tempRoot, 'lib/wrappers/p-local-exports-wrapper.js', `
    const a = require(process.env.ADAPTER_PATH);
    exports.a = a;
  `);
  write(tempRoot, 'pages/api/admin/red-unresolved-local-namespace.js', `
    import a from '../../../lib/wrappers/n-local-namespace-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);
  write(tempRoot, 'pages/api/cron/red-unresolved-local-object.js', `
    import { a } from '../../../lib/wrappers/o-local-object-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);
  write(tempRoot, 'pages/api/workbench/red-unresolved-local-exports.js', `
    import { a } from '../../../lib/wrappers/p-local-exports-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);

  // (r) wrapper LATE-ASSIGNING a non-literal require() to a local, then
  // identity-exporting it -- assignment-carried unresolved provenance.
  write(tempRoot, 'lib/wrappers/r-late-unresolved-wrapper.js', `
    let a;
    a = require(process.env.ADAPTER_PATH);
    module.exports = a;
  `);
  write(tempRoot, 'pages/api/admin/red-unresolved-late-assign.js', `
    import a from '../../../lib/wrappers/r-late-unresolved-wrapper.js';
    export default function handler(req, res) { return a.getById(req.query.id); }
  `);

  // (u) wrapper ALIASING a non-literal require() (declarator + late-assign
  // alias hop) before the identity export.
  write(tempRoot, 'lib/wrappers/u-alias-unresolved-wrapper.js', `
    const a = require(process.env.ADAPTER_PATH);
    let b;
    b = a;
    module.exports = b;
  `);
  write(tempRoot, 'pages/api/cron/red-unresolved-alias.js', `
    import b from '../../../lib/wrappers/u-alias-unresolved-wrapper.js';
    export default function handler(req, res) { return b.getById(req.query.id); }
  `);

  // (q) GREEN: lazy-backend service shape -- non-literal require() held in a
  // module-scope local, but only OWN functions are exported. Must not trip.
  write(tempRoot, 'lib/services/lazy-backend-service.js', `
    const _impl = require(process.env.BACKEND_PATH);
    function getThing(id) { return _impl.getById(id); }
    module.exports = { getThing };
  `);
  write(tempRoot, 'pages/api/review-manager/green-lazy-backend.js', `
    import { getThing } from '../../../lib/services/lazy-backend-service.js';
    export default function handler(req, res) { return getThing(req.query.id); }
  `);

  const run = runGate(['--json']);
  expect(run.status !== 0, `unresolved sources should fail closed, exited 0:\n${run.output}`);
  expect(run.output.includes('unresolved-boundary-source'),
    `expected unresolved-boundary-source error, got:\n${run.output}`);
  // (j)(k): in-route non-literal sources reported with file:line.
  expect(/pages\/api\/admin\/red-unresolved-import\.js:\d+/.test(run.output),
    `expected file:line for dynamic import(p), got:\n${run.output}`);
  expect(/pages\/api\/cron\/red-unresolved-require\.js:\d+/.test(run.output),
    `expected file:line for require(p), got:\n${run.output}`);
  // (m): route reaching an unresolved-equivalent wrapper, naming the origin.
  expect(run.output.includes('pages/api/workbench/red-unresolved-wrapper.js')
    && run.output.includes('unresolved-reexport-wrapper.js'),
    `expected wrapper-reach failure naming the origin, got:\n${run.output}`);
  // (n)(o)(p): local-binding identity exports fail closed, naming the wrapper.
  expect(run.output.includes('pages/api/admin/red-unresolved-local-namespace.js')
    && run.output.includes('n-local-namespace-wrapper.js'),
    `expected local-namespace wrapper failure (n), got:\n${run.output}`);
  expect(run.output.includes('pages/api/cron/red-unresolved-local-object.js')
    && run.output.includes('o-local-object-wrapper.js'),
    `expected local-object wrapper failure (o), got:\n${run.output}`);
  expect(run.output.includes('pages/api/workbench/red-unresolved-local-exports.js')
    && run.output.includes('p-local-exports-wrapper.js'),
    `expected local-exports wrapper failure (p), got:\n${run.output}`);
  // (r): late-assigned unresolved binding fails closed, naming the wrapper.
  expect(run.output.includes('pages/api/admin/red-unresolved-late-assign.js')
    && run.output.includes('r-late-unresolved-wrapper.js'),
    `expected late-assign wrapper failure (r), got:\n${run.output}`);
  // (u): alias-carried unresolved binding fails closed, naming the wrapper.
  expect(run.output.includes('pages/api/cron/red-unresolved-alias.js')
    && run.output.includes('u-alias-unresolved-wrapper.js'),
    `expected alias-chain wrapper failure (u), got:\n${run.output}`);
  // (q): the lazy-backend service and its consumer must NOT appear.
  expect(!run.output.includes('lazy-backend-service.js')
    && !run.output.includes('green-lazy-backend.js'),
    `lazy-backend GREEN fixture wrongly tripped fail-closed:\n${run.output}`);
  console.log('PASS non-literal sources fail closed (j/k in-route, m via wrapper, n/o/p via local binding, r late-assign, u alias chain; q lazy-backend green)');
}

function runLiveParseAssertion() {
  const output = execSync(`node ${JSON.stringify(gate)} --report`, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  expect(output.includes('Route-service boundary census'), 'live --report did not print census header');
  console.log('PASS live repo census parses');
}

function parseMode(argv) {
  const modeIndex = argv.indexOf('--mode');
  if (modeIndex === -1) return 'all';
  const mode = argv[modeIndex + 1];
  if (!mode) {
    throw new Error('--mode requires one of: all, detection, report, law, unresolved, live');
  }
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runDetectionAssertions();
    runReportAssertions();
    runLawModeAssertions();
    runUnresolvedFailClosedAssertions();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'detection') return runDetectionAssertions();
  if (mode === 'report') return runReportAssertions();
  if (mode === 'law') return runLawModeAssertions();
  if (mode === 'unresolved') return runUnresolvedFailClosedAssertions();
  if (mode === 'live') return runLiveParseAssertion();
  throw new Error(`unknown --mode ${mode}`);
}

try {
  runMode(parseMode(process.argv.slice(2)));
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  cleanup();
}
