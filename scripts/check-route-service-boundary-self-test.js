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
 * not re-export it); the exempt dir (pages/api/dataverse-export/) which is
 * never counted; (l) a route
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
 *
 * Postgres access layer migration Stage 1 item 2 (docs/plans/
 * POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md) widened the SAME gate
 * to Postgres sources (@vercel/postgres, pg, lib/postgres/*) with a narrowly
 * scoped, SHRINK-ONLY carry-over instead of Dataverse's plain law. There is
 * no Dataverse baseline file; the Postgres carry-over is an in-script array
 * (POSTGRES_CARRYOVER) pinned exact-set by tests/unit/
 * route-service-boundary-postgres-carryover.test.js. `runPostgresAssertions`
 * and `runPostgresStaleAssertions` cover it, using the SELF-TEST-ONLY
 * `--postgres-carryover <file>` override flag so fixtures never touch the
 * real 17-entry list:
 *   - a route importing `@vercel/postgres` directly (red, unlisted)
 *   - a route importing `pg` directly (red, unlisted)
 *   - a route importing a `lib/postgres/*` source directly (red, unlisted)
 *   - a route reaching a Postgres driver through a thin re-export wrapper,
 *     via the SAME propagation mechanism the Dataverse fixtures exercise
 *     (red, unlisted)
 *   - a listed carry-over route importing the driver (green)
 *   - a route importing a lib/services module that itself imports the driver
 *     without re-exporting it (green — the desired end state)
 *   - a route with a Dataverse violation AND a Postgres carry-over entry
 *     still fails, on the Dataverse reason (the carry-over never excuses
 *     Dataverse)
 *   - a carry-over list naming a route that no longer reaches Postgres
 *     (stale entry — fails the gate, forcing the list to shrink)
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
  // S338 Stage 0 (Q4/C5): lib/services/dynamics/ submodule matcher extension.
  'pages/api/review-manager/red-dynamics-submodule.js',
  // S9: pages/api/dynamics-explorer/ is no longer an exempt dir -- a raw
  // boundary import there must now be flagged like any other route.
  'pages/api/dynamics-explorer/red-adapter-import.js',
];

const GREEN_ROUTES = [
  'pages/api/workbench/green-shell.js',
  'pages/api/review-manager/green-service.js',
  'pages/api/dataverse-export/adapter-import.js',
  'pages/api/dataverse-export/thing.js',
  'pages/api/review-manager/green-own-wrapper.js',
  // S338 Stage 0: exempt route dir still passes with a dynamics/ submodule import.
  'pages/api/dataverse-export/submodule-import.js',
];

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('.route_service_boundary_selftest_tmp');

// Every fixture tree lives entirely under tempRoot, which the gate only scans
// under pages/lib/shared/modules -- a JSON carry-over file at the tempRoot
// root is never picked up as a source file. runGate() always passes
// `--postgres-carryover <CARRYOVER_PATH>` so a fixture run is judged against
// an explicit, scenario-scoped carry-over rather than the real 17-entry
// POSTGRES_CARRYOVER (whose paths do not exist under any fixture tree, which
// would otherwise make every entry a spurious stale failure).
const CARRYOVER_PATH = path.join(tempRoot, '__postgres_carryover.json');

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function writeCarryover(list) {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(CARRYOVER_PATH, JSON.stringify(list));
}

function runGate(args = []) {
  try {
    const output = execSync(
      `node ${JSON.stringify(gate)} --root ${JSON.stringify(tempRoot)} `
      + `--postgres-carryover ${JSON.stringify(CARRYOVER_PATH)} ${args.join(' ')}`,
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      },
    );
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
  // Dataverse-only fixture tree never reaches Postgres -- an empty carry-over
  // keeps the Postgres stale-entry check silent for these assertions.
  writeCarryover([]);

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

  // GREEN: the exempt dir is never counted, even with a direct boundary import
  write(tempRoot, 'pages/api/dataverse-export/adapter-import.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler() { return getById('x'); }
  `);
  write(tempRoot, 'pages/api/dataverse-export/thing.js', `
    import { DynamicsService } from '../../../lib/services/dynamics-service.js';
    export default function handler() { return DynamicsService.queryRecords(); }
  `);

  // (v) S338 Stage 0 (Q4/C5): direct named import from the new
  // lib/services/dynamics/ submodule directory -- the boundary-source matcher
  // extension must catch this the same as a dynamics-service.js import.
  write(tempRoot, 'pages/api/review-manager/red-dynamics-submodule.js', `
    import { createRecord } from '../../../lib/services/dynamics/write-core.js';
    export default function handler(req, res) { return createRecord('contacts', {}); }
  `);

  // GREEN: exempt route dir still passes with a dynamics/ submodule import,
  // confirming EXEMPT_ROUTE_DIRS is unaffected by the matcher extension.
  write(tempRoot, 'pages/api/dataverse-export/submodule-import.js', `
    import { createRecord } from '../../../lib/services/dynamics/write-core.js';
    export default function handler() { return createRecord('contacts', {}); }
  `);

  // RED: pages/api/dynamics-explorer/ is no longer an exempt dir (S9) -- a
  // raw boundary import there must be flagged like any other route.
  write(tempRoot, 'pages/api/dynamics-explorer/red-adapter-import.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler() { return getById('x'); }
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
  // One JSON row per (file, family) -- a route hitting both families would
  // produce two rows for one file, so compare DISTINCT files, not row count.
  expect(files.size === RED_ROUTES.length,
    `expected exactly ${RED_ROUTES.length} distinct boundary routes, got ${files.size} (${entries.length} rows)`);
  for (const entry of entries) {
    expect(entry.boundaryFamily === 'dataverse', `expected dataverse family for Dataverse-only fixture ${entry.file}, got ${entry.boundaryFamily}`);
  }

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
  expect(run.output.includes('Dataverse law since Stage 7'), 'report missing Dataverse law-mode banner');
  expect(run.output.includes('Postgres carry-over:'), 'report missing Postgres carry-over line');
  expect(run.output.includes('## Boundary-reaching routes'), 'report missing route listing');
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
  // No Dataverse baseline exists; the Postgres carry-over is an in-script
  // array (POSTGRES_CARRYOVER) pinned by tests/unit/
  // route-service-boundary-postgres-carryover.test.js, not a baseline file.
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
  writeCarryover([]);
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

// Postgres access layer migration Stage 1 item 2: the SAME gate, widened to
// Postgres sources with a shrink-only carry-over instead of Dataverse's plain
// law. Uses the SELF-TEST-ONLY --postgres-carryover override so no fixture
// touches the real 17-entry POSTGRES_CARRYOVER.
function runPostgresAssertions() {
  cleanup();

  // Thin re-export wrapper of the driver -- SAME propagation mechanism the
  // Dataverse fixtures exercise (export * from a boundary source).
  write(tempRoot, 'lib/wrappers/postgres-driver-wrapper.js', `
    export * from '@vercel/postgres';
  `);
  // The Postgres access-layer dir (does not exist in the real repo yet, but
  // the recognizer must catch it once it does).
  write(tempRoot, 'lib/postgres/client.js', `
    export function getClient() { return {}; }
  `);
  // Legitimate per-domain service: USES the driver, does NOT re-export it.
  write(tempRoot, 'lib/services/postgres-consumer-service.js', `
    import { sql } from '@vercel/postgres';
    export async function fetchThing(id) { return sql\`select 1\`; }
  `);

  // RED, unlisted: direct '@vercel/postgres' import.
  write(tempRoot, 'pages/api/workbench/red-postgres-vercel.js', `
    import { sql } from '@vercel/postgres';
    export default function handler(req, res) { return sql\`select 1\`; }
  `);
  // RED, unlisted: direct 'pg' import.
  write(tempRoot, 'pages/api/cron/red-postgres-pg.js', `
    import { Pool } from 'pg';
    export default function handler(req, res) { return new Pool(); }
  `);
  // RED, unlisted: direct '@neondatabase/serverless' import (Codex round 2:
  // the ratchet gate names three driver packages -- @vercel/postgres, pg,
  // @neondatabase/serverless -- this gate must recognize all three).
  write(tempRoot, 'pages/api/cron/red-postgres-neon.js', `
    import { neon } from '@neondatabase/serverless';
    export default function handler(req, res) { return neon('x'); }
  `);
  // RED, unlisted: direct lib/postgres/* import.
  write(tempRoot, 'pages/api/admin/red-postgres-layer.js', `
    import { getClient } from '../../../lib/postgres/client.js';
    export default function handler(req, res) { return getClient(); }
  `);
  // RED, unlisted: reaches the driver through the thin re-export wrapper.
  write(tempRoot, 'pages/api/workbench/red-postgres-wrapper.js', `
    import { sql } from '../../../lib/wrappers/postgres-driver-wrapper.js';
    export default function handler(req, res) { return sql\`select 1\`; }
  `);
  // GREEN: a carry-over-listed route importing the driver directly.
  write(tempRoot, 'pages/api/webhooks/green-postgres-listed.js', `
    import { sql } from '@vercel/postgres';
    export default function handler(req, res) { return sql\`select 1\`; }
  `);
  // GREEN: imports a lib/services module that itself imports the driver
  // WITHOUT re-exporting it -- the desired end state.
  write(tempRoot, 'pages/api/review-manager/green-postgres-service.js', `
    import { fetchThing } from '../../../lib/services/postgres-consumer-service.js';
    export default async function handler(req, res) { return fetchThing(req.query.id); }
  `);
  // RED (Dataverse), carry-over-listed for Postgres: a route with BOTH a
  // Dataverse adapter import and a direct Postgres driver import. The
  // carry-over lists it for Postgres, but that never excuses Dataverse --
  // the route must still fail, on the Dataverse reason.
  write(tempRoot, 'lib/dataverse/adapters/reviewer-suggestion.js', `
    export function getById(id) { return { id }; }
  `);
  write(tempRoot, 'pages/api/admin/red-postgres-and-dataverse.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    import { sql } from '@vercel/postgres';
    export default function handler(req, res) { return { a: getById(req.query.id), b: sql\`select 1\` }; }
  `);

  // GREEN: 'pg-copy-streams' is a real, unrelated npm package (used by
  // lib/services/irs-bmf-service.js). isPostgresDriverSource must NOT match
  // it as a substring/prefix of 'pg' -- a `startsWith('pg')` mutation (as
  // opposed to the correct `=== 'pg' || startsWith('pg/')`) would wrongly
  // flag this fixture.
  write(tempRoot, 'pages/api/workbench/green-pg-copy-streams.js', `
    import { from as copyFrom } from 'pg-copy-streams';
    export default function handler(req, res) { return copyFrom('x'); }
  `);

  // RED: a MIXED wrapper reaching BOTH families at once, in two different
  // forms -- must be tracked as reaching BOTH, not just the first one a scan
  // happens to hit (Codex round 1 P1). This route is carry-over-listed for
  // Postgres, so it must still fail on the Dataverse reason and must NOT be
  // reported as a stale carry-over entry.
  write(tempRoot, 'lib/wrappers/mixed-reexport-wrapper.js', `
    export * from '@vercel/postgres';
    export * from '../dataverse/adapters/reviewer-suggestion.js';
  `);
  write(tempRoot, 'pages/api/workbench/red-mixed-reexport.js', `
    import { sql, getById } from '../../../lib/wrappers/mixed-reexport-wrapper.js';
    export default function handler(req, res) { return { a: getById('x'), b: sql\`select 1\` }; }
  `);
  // Form 2: import-then-export-named, consumed via a NAMESPACE import so a
  // single binding-lookup ('*') must surface every family the module reaches.
  write(tempRoot, 'lib/wrappers/mixed-import-then-export-wrapper.js', `
    import { sql } from '@vercel/postgres';
    import { getById } from '../dataverse/adapters/reviewer-suggestion.js';
    export { sql, getById };
  `);
  write(tempRoot, 'pages/api/workbench/red-mixed-namespace.js', `
    import * as m from '../../../lib/wrappers/mixed-import-then-export-wrapper.js';
    export default function handler(req, res) { return { a: m.getById('x'), b: m.sql\`select 1\` }; }
  `);

  writeCarryover([
    'pages/api/webhooks/green-postgres-listed.js',
    'pages/api/admin/red-postgres-and-dataverse.js',
    'pages/api/workbench/red-mixed-reexport.js',
    'pages/api/workbench/red-mixed-namespace.js',
  ]);

  const RED = [
    'pages/api/workbench/red-postgres-vercel.js',
    'pages/api/cron/red-postgres-pg.js',
    'pages/api/cron/red-postgres-neon.js',
    'pages/api/admin/red-postgres-layer.js',
    'pages/api/workbench/red-postgres-wrapper.js',
    'pages/api/admin/red-postgres-and-dataverse.js',
    'pages/api/workbench/red-mixed-reexport.js',
    'pages/api/workbench/red-mixed-namespace.js',
  ];
  // Carry-over-listed for Postgres, but still expected to fail (on Dataverse).
  const MIXED_DATAVERSE_ROUTES = [
    'pages/api/admin/red-postgres-and-dataverse.js',
    'pages/api/workbench/red-mixed-reexport.js',
    'pages/api/workbench/red-mixed-namespace.js',
  ];
  // A route the report/json layer never detects reaching Postgres at all
  // (does not import the driver, only a service that does; or imports an
  // unrelated package that merely starts with 'pg').
  const GREEN_UNDETECTED = [
    'pages/api/review-manager/green-postgres-service.js',
    'pages/api/workbench/green-pg-copy-streams.js',
  ];
  // A route that DOES reach Postgres (so it legitimately appears in --json /
  // --report) but must never appear as a LAW failure, because it is listed.
  const GREEN_LAW_ONLY = ['pages/api/webhooks/green-postgres-listed.js'];
  const GREEN = [...GREEN_UNDETECTED, ...GREEN_LAW_ONLY];

  const json = runGate(['--json']);
  expect(json.status === 0, `--json exited ${json.status}\n${json.output}`);
  const entries = JSON.parse(json.output);
  const byFile = new Map();
  for (const e of entries) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  for (const red of RED) {
    expect(byFile.has(red), `Postgres RED fixture not flagged: ${red}\nflagged: ${[...byFile.keys()].join(', ')}`);
  }
  for (const green of GREEN_UNDETECTED) {
    expect(!byFile.has(green), `Postgres GREEN fixture wrongly flagged: ${green}`);
  }
  for (const green of GREEN_LAW_ONLY) {
    const rows = byFile.get(green);
    expect(rows && rows.some((r) => r.boundaryFamily === 'postgres'),
      `carry-over-listed route should still appear in --json (informational): ${green}`);
  }
  for (const red of RED.slice(0, 4)) {
    const rows = byFile.get(red);
    expect(rows.some((r) => r.boundaryFamily === 'postgres'), `expected postgres family for ${red}, got ${JSON.stringify(rows)}`);
  }
  // --json is informational: it reports BOTH reasons for the dual route
  // regardless of the carry-over (which only ever affects the LAW exit code).
  const dualRoute = byFile.get('pages/api/admin/red-postgres-and-dataverse.js');
  expect(dualRoute.some((r) => r.boundaryFamily === 'dataverse'), `carry-over-listed dual route did not report dataverse: ${JSON.stringify(dualRoute)}`);
  expect(dualRoute.some((r) => r.boundaryFamily === 'postgres'), `carry-over-listed dual route did not also report postgres: ${JSON.stringify(dualRoute)}`);

  const wrapperRow = byFile.get('pages/api/workbench/red-postgres-wrapper.js').find((r) => r.boundaryFamily === 'postgres');
  expect(wrapperRow && /re-export via .*postgres-driver-wrapper/.test(wrapperRow.reason),
    `wrapper propagation did not name the wrapper: ${JSON.stringify(wrapperRow)}`);

  // Both mixed-family fixtures must report BOTH families in --json (P1 fix):
  // a wrapper/binding reaching both an adapter and a Postgres driver must not
  // collapse to only the first family a scan happens to hit.
  for (const mixed of ['pages/api/workbench/red-mixed-reexport.js', 'pages/api/workbench/red-mixed-namespace.js']) {
    const rows = byFile.get(mixed);
    expect(rows && rows.some((r) => r.boundaryFamily === 'dataverse'),
      `mixed-family fixture missing dataverse family: ${mixed}\n${JSON.stringify(rows)}`);
    expect(rows && rows.some((r) => r.boundaryFamily === 'postgres'),
      `mixed-family fixture missing postgres family: ${mixed}\n${JSON.stringify(rows)}`);
  }

  const law = runGate([]);
  expect(law.status !== 0, `law mode should fail with Postgres violations present, exited 0:\n${law.output}`);
  for (const red of RED) {
    expect(law.output.includes(red), `law failure did not name Postgres RED fixture ${red}:\n${law.output}`);
  }
  for (const green of GREEN) {
    expect(!law.output.includes(green), `law failure wrongly named Postgres GREEN fixture ${green}:\n${law.output}`);
  }
  // Every route carry-over-listed for Postgres but ALSO reaching Dataverse
  // must still fail, explicitly on its [dataverse] reason, and must NEVER be
  // reported as a stale carry-over entry (it legitimately still reaches
  // Postgres too -- the carry-over only ever excuses Postgres, never
  // Dataverse, in the same file). This is the regression the mixed-family
  // fixtures above exist to catch: before the P1 fix, a mixed wrapper's
  // family map stopped at the first match and could silently drop the
  // Dataverse reason for a carry-over-listed route.
  for (const dual of MIXED_DATAVERSE_ROUTES) {
    expect(law.output.includes(`${dual} | [dataverse]`),
      `expected an explicit [dataverse] law failure line for ${dual}, got:\n${law.output}`);
    expect(!law.output.includes(`stale Postgres carry-over entry -- remove ${dual}`),
      `${dual} wrongly reported as a stale carry-over entry:\n${law.output}`);
  }

  console.log(`PASS Postgres assertions (${RED.length} reds named incl. ${MIXED_DATAVERSE_ROUTES.length} dual-family carry-over routes, ${GREEN.length} greens clean, wrapper propagation confirmed)`);
}

// Stale carry-over entry: a carry-over list naming a route that no longer
// reaches Postgres must fail the gate itself, forcing the list to shrink.
function runPostgresStaleAssertions() {
  cleanup();
  write(tempRoot, 'pages/api/workbench/green-clean.js', `
    export default function handler(req, res) { res.status(200).end(); }
  `);
  // A carry-over entry naming a route file that does not exist at all must
  // also fail as stale -- the check is "does this entry currently reach
  // Postgres", not "does this file exist".
  writeCarryover([
    'pages/api/workbench/green-clean.js',
    'pages/api/workbench/does-not-exist.js',
  ]);

  const law = runGate([]);
  expect(law.status !== 0, `stale carry-over entry should fail the gate, exited 0:\n${law.output}`);
  expect(law.output.includes('stale Postgres carry-over entry -- remove pages/api/workbench/green-clean.js'),
    `expected stale-entry message naming the clean route, got:\n${law.output}`);
  expect(law.output.includes('stale Postgres carry-over entry -- remove pages/api/workbench/does-not-exist.js'),
    `expected stale-entry message naming the nonexistent route, got:\n${law.output}`);

  console.log('PASS Postgres stale carry-over assertion (unlisted-clean-route + nonexistent-route entries fail the gate)');
}

// P2: --postgres-carryover is a SELF-TEST-ONLY override -- it must be
// rejected (exit 2) against the real repo root, so a package.json/CI edit
// passing this flag could never bypass the pinned POSTGRES_CARRYOVER list.
// Exercised directly against repoRoot (not via runGate/tempRoot).
function runCarryoverRootGuardAssertion() {
  const carryoverFile = path.join(tempRoot, '__root_guard_carryover.json');
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(carryoverFile, JSON.stringify([]));
  try {
    execSync(`node ${JSON.stringify(gate)} --postgres-carryover ${JSON.stringify(carryoverFile)}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    throw new Error('--postgres-carryover against the real repo root should have exited non-zero');
  } catch (err) {
    if (!('status' in err)) throw err;
    expect(err.status === 2, `expected exit 2 for --postgres-carryover without a non-default --root, got ${err.status}:\n${err.stderr}`);
    expect(String(err.stderr).includes('self-test-only override'),
      `expected a self-test-only override message, got:\n${err.stderr}`);
  } finally {
    cleanup();
  }
  console.log('PASS --postgres-carryover root-guard assertion (rejected with exit 2 against the real repo root)');
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
    throw new Error('--mode requires one of: all, detection, report, law, unresolved, postgres, postgres-stale, postgres-root-guard, live');
  }
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runDetectionAssertions();
    runReportAssertions();
    runLawModeAssertions();
    runUnresolvedFailClosedAssertions();
    runPostgresAssertions();
    runPostgresStaleAssertions();
    runCarryoverRootGuardAssertion();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'detection') return runDetectionAssertions();
  if (mode === 'report') return runReportAssertions();
  if (mode === 'law') return runLawModeAssertions();
  if (mode === 'unresolved') return runUnresolvedFailClosedAssertions();
  if (mode === 'postgres') return runPostgresAssertions();
  if (mode === 'postgres-stale') return runPostgresStaleAssertions();
  if (mode === 'postgres-root-guard') return runCarryoverRootGuardAssertion();
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
