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
 *
 * GREEN fixtures: a clean shell route; a route importing only a per-domain
 * lib/services/<domain>/ service (which USES an adapter internally but does
 * not re-export it); and the exempt dirs (pages/api/dynamics-explorer/,
 * pages/api/dataverse-export/) which are never counted.
 *
 * Plus: the wave taxonomy fails closed on an unclassifiable route, and the
 * ratchet fires when the count diverges from the committed baseline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
];

const GREEN_ROUTES = [
  'pages/api/workbench/green-shell.js',
  'pages/api/review-manager/green-service.js',
  'pages/api/dynamics-explorer/chat.js',
  'pages/api/dataverse-export/thing.js',
];

function cleanup() {
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
}

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
  // Legitimate per-domain service: USES an adapter, does NOT re-export it.
  write(tempRoot, 'lib/services/review-manager/withdraw-sufficient-service.js', `
    import { getById } from '../../dataverse/adapters/reviewer-suggestion.js';
    export async function run(id) { return getById(id); }
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

  // GREEN: clean shell route
  write(tempRoot, 'pages/api/workbench/green-shell.js', `
    export default function handler(req, res) { res.status(200).end(); }
  `);

  // GREEN: imports only a per-domain service (which uses an adapter internally)
  write(tempRoot, 'pages/api/review-manager/green-service.js', `
    import { run } from '../../../lib/services/review-manager/withdraw-sufficient-service.js';
    export default async function handler(req, res) { return run(req.query.id); }
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

  // (g) root-level classification: domain '(root)', Stage 5.
  const root = entries.find((e) => e.file === 'pages/api/red-root.js');
  expect(root && root.domain === '(root)' && root.stage === 5,
    `root-level route not classified as (root)/Stage 5: ${JSON.stringify(root)}`);

  // (c) re-export taint attributed to the wrapper.
  const reexport = entries.find((e) => e.file === 'pages/api/reviewer-finder/red-reexport.js');
  expect(reexport && /re-export via .*wrapper/.test(reexport.reason),
    `re-export route reason did not name the wrapper: ${JSON.stringify(reexport)}`);

  console.log(`PASS detection assertions (${entries.length} boundary routes; ${GREEN_ROUTES.length} green untouched)`);
}

function runReportAssertions() {
  setupFixtures();
  const run = runGate(['--report']);
  expect(run.status === 0, `--report exited ${run.status}\n${run.output}`);
  expect(run.output.includes('Route-service boundary census'), 'report missing header');
  expect(run.output.includes('## Wave classification'), 'report missing wave classification');
  expect(run.output.includes('Stage 5 - tail'), 'report missing tail stage heading');
  console.log('PASS report assertions');
}

function runUnclassifiableAssertion() {
  cleanup();
  write(tempRoot, 'lib/dataverse/adapters/reviewer-suggestion.js', `
    export function getById(id) { return { id }; }
  `);
  // Route under a domain outside the Stage 1-5 taxonomy must fail closed.
  write(tempRoot, 'pages/api/unknown-widget/foo.js', `
    import { getById } from '../../../lib/dataverse/adapters/reviewer-suggestion.js';
    export default function handler(req, res) { return getById(req.query.id); }
  `);

  const run = runGate(['--json']);
  expect(run.status !== 0, 'unclassifiable route should fail, exited 0');
  expect(run.output.includes('unclassifiable'), `expected unclassifiable error, got:\n${run.output}`);
  expect(run.output.includes('pages/api/unknown-widget/foo.js'), `error did not name the route:\n${run.output}`);
  console.log('PASS unclassifiable route fails closed');
}

function runRatchetFallAssertion() {
  setupFixtures();
  // Fixture has 7 boundary routes; committed baseline is 49, so default mode
  // must report a FALLING count and demand a same-commit baseline update.
  const run = runGate();
  expect(run.status !== 0, 'ratchet should fail when count diverges from baseline');
  expect(run.output.includes('RATCHET UPDATE REQUIRED'), `expected ratchet-update message, got:\n${run.output}`);
  expect(/fell from \d+ to 7/.test(run.output), `expected 'fell from N to 7', got:\n${run.output}`);
  console.log('PASS ratchet fires on divergent count');
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
    throw new Error('--mode requires one of: all, detection, report, unclassifiable, ratchet, live');
  }
  return mode;
}

function runMode(mode) {
  if (mode === 'all') {
    runDetectionAssertions();
    runReportAssertions();
    runUnclassifiableAssertion();
    runRatchetFallAssertion();
    runLiveParseAssertion();
    return;
  }
  if (mode === 'detection') return runDetectionAssertions();
  if (mode === 'report') return runReportAssertions();
  if (mode === 'unclassifiable') return runUnclassifiableAssertion();
  if (mode === 'ratchet') return runRatchetFallAssertion();
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
