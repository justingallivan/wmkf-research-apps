#!/usr/bin/env node
/**
 * Fixture-based self-test for scripts/check-dynamics-context-boundary.js
 * (docs/BYPASS_STRIP_PLAN.md Stage 3).
 *
 * Builds an isolated fake-root fixture tree under lib/.dynamics_context_boundary_selftest_tmp/
 * via scripts/lib/selftest-fixture.js's registerRepoFixture (the canonical
 * scaffold/disposer helper), invokes the gate with --root <fixture-dir> so it
 * scans ONLY the fixture tree, and asserts each of the plan's ten required RED
 * shapes trips the gate (naming file:line) while the GREEN fixtures — the
 * sanctioned importer, the sanctioned withDynamicsContext definition site, the
 * Explorer's loaded-restrictions path, and ordinary withDalContext usage —
 * never do. Adds two more RED fixtures (aliased-import and namespace/member-form
 * `withDynamicsContext` calls) closing the evasion hole a fresh-context Codex
 * adversarial review found in rule 2's original bare-Identifier-only callee
 * check (docs/BYPASS_STRIP_PLAN.md Stage Log).
 *
 * Fixtures are pure text (never actually required/imported), so no real
 * `dynamics-context` module needs to exist in the fixture tree — detection is
 * AST-based on the source string alone.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-dynamics-context-boundary.js');
const FIXTURE_REL = 'lib/.dynamics_context_boundary_selftest_tmp';
const tempRoot = path.join(repoRoot, FIXTURE_REL);

const { cleanup } = registerRepoFixture(FIXTURE_REL);

function write(rel, body) {
  const full = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function runGate() {
  try {
    const output = execFileSync('node', [gate, '--root', tempRoot], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { status: 0, output };
  } catch (err) {
    return { status: err.status ?? 1, output: (err.stdout || '') + (err.stderr || '') };
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function setupGreenFixtures() {
  cleanup();

  // GREEN — the one sanctioned bypassDynamicsRestrictions importer.
  write('lib/dataverse/core/context.js', `
    import { bypassDynamicsRestrictions, getDynamicsContext } from '../../services/dynamics-context.js';
    export function withDalContext(scopeLabel, fn) {
      if (typeof scopeLabel !== 'string' || !scopeLabel) throw new Error('scopeLabel required');
      return bypassDynamicsRestrictions(scopeLabel, fn);
    }
  `);

  // GREEN — the canonical definition file: necessarily contains the
  // empty-restrictions shape it implements (mirrors odata.js's own-primitive
  // exemption in check-odata-escape.js).
  write('lib/services/dynamics-context.js', `
    export function bypassDynamicsRestrictions(requestIdOrFn, maybeFn) {
      let requestId = null;
      let fn = maybeFn;
      if (typeof requestIdOrFn === 'function') fn = requestIdOrFn;
      else requestId = requestIdOrFn || null;
      return withDynamicsContext({ restrictions: [], requestId }, fn);
    }
    export function enterDynamicsBypassForScript(label) {
      return withDynamicsContext({ restrictions: [], requestId: label });
    }
  `);

  // GREEN — ordinary withDalContext usage, the sanctioned pattern everywhere else.
  write('lib/services/notification-service.js', `
    import { withDalContext } from '../dataverse/core/context.js';
    export async function sendAdminEmail() {
      return withDalContext('notification-email', () => DynamicsService.createAndSendEmail({}));
    }
  `);

  // GREEN — Explorer's loaded-restrictions path: non-literal restrictions,
  // carved out of rule 2 only.
  write('pages/api/dynamics-explorer/chat.js', `
    import { withDynamicsContext } from '../../../lib/services/dynamics-context';
    export default async function handler(req, res) {
      const restrictions = await getActiveRestrictions(req);
      return withDynamicsContext({ restrictions, requestId: 'explorer-chat' }, () => runQuery());
    }
  `);

  // GREEN — a non-empty LITERAL restrictions array is legitimately restricted,
  // not a bypass, and must never be flagged (even outside the Explorer dir).
  write('lib/services/legit-restricted-caller.js', `
    import { withDynamicsContext } from '../services/dynamics-context';
    export function readWithRestrictions() {
      return withDynamicsContext({ restrictions: ['no-pii'], requestId: 'x' }, () => doRead());
    }
  `);
}

function writeRedFixtures() {
  // (i) new violating static import
  write('lib/services/red-static-import.js', `
    import { bypassDynamicsRestrictions } from './dynamics-context';
    export function f() { return bypassDynamicsRestrictions('x', () => 1); }
  `);

  // (ii) aliased named import
  write('lib/services/red-aliased-import.js', `
    import { bypassDynamicsRestrictions as bypass } from './dynamics-context';
    export function f() { return bypass('x', () => 1); }
  `);

  // (iii) namespace / member access
  write('lib/services/red-namespace-member.js', `
    import * as ctx from './dynamics-context';
    export function f() { return ctx.bypassDynamicsRestrictions('x', () => 1); }
  `);

  // (iv) dynamic import()
  write('lib/services/red-dynamic-import.js', `
    export async function f() {
      const { bypassDynamicsRestrictions } = await import('./dynamics-context');
      return bypassDynamicsRestrictions('x', () => 1);
    }
  `);

  // (v) inline require()
  write('lib/services/red-inline-require.js', `
    const { bypassDynamicsRestrictions } = require('./dynamics-context');
    module.exports = { f: () => bypassDynamicsRestrictions('x', () => 1) };
  `);

  // (vi) a re-export
  write('lib/services/red-reexport.js', `
    export { bypassDynamicsRestrictions } from './dynamics-context';
  `);

  // (vii) a non-literal require/import source -> fail closed
  write('lib/services/red-nonliteral-source.js', `
    const modulePath = computeModulePath();
    const { bypassDynamicsRestrictions } = require(modulePath);
    module.exports = { f: () => bypassDynamicsRestrictions('x', () => 1) };
  `);

  // (viii) literal empty-restrictions withDynamicsContext -> RED
  write('lib/services/red-empty-restrictions.js', `
    import { withDynamicsContext } from './dynamics-context';
    export function f() { return withDynamicsContext({ restrictions: [], requestId: 'x' }, () => 1); }
  `);

  // (ix) non-literal-restrictions withDynamicsContext outside Explorer carve-out -> RED
  write('lib/services/red-unresolved-restrictions.js', `
    import { withDynamicsContext } from './dynamics-context';
    export function f(restrictions) { return withDynamicsContext({ restrictions, requestId: 'x' }, () => 1); }
  `);

  // (x) enterDynamicsBypassForScript outside scripts/ -> RED
  write('lib/services/red-script-only-outside-scripts.js', `
    import { enterDynamicsBypassForScript } from './dynamics-context';
    export function f() { return enterDynamicsBypassForScript('x'); }
  `);

  // (xi) adversarial-review finding (P1): aliased named import of
  // withDynamicsContext with empty restrictions -> RED. A bare-Identifier-only
  // callee check would miss this.
  write('lib/services/red-aliased-withdynamicscontext.js', `
    import { withDynamicsContext as raw } from './dynamics-context';
    export function f() { return raw({ restrictions: [], requestId: 'x' }, () => 1); }
  `);

  // (xii) adversarial-review finding (P1): namespace/member-form
  // withDynamicsContext call with empty restrictions -> RED.
  write('lib/services/red-namespace-withdynamicscontext.js', `
    import * as dc from './dynamics-context';
    export function f() { return dc.withDynamicsContext({ restrictions: [], requestId: 'x' }, () => 1); }
  `);
}

function removeRedFixtures() {
  const names = [
    'red-static-import.js', 'red-aliased-import.js', 'red-namespace-member.js',
    'red-dynamic-import.js', 'red-inline-require.js', 'red-reexport.js',
    'red-nonliteral-source.js', 'red-empty-restrictions.js',
    'red-unresolved-restrictions.js', 'red-script-only-outside-scripts.js',
    'red-aliased-withdynamicscontext.js', 'red-namespace-withdynamicscontext.js',
  ];
  for (const name of names) fs.rmSync(path.join(tempRoot, 'lib/services', name), { force: true });
}

function runRedAssertion() {
  setupGreenFixtures();
  writeRedFixtures();

  const run = runGate();
  expect(run.status !== 0, `expected RED (non-zero exit) with violating fixtures present, got 0:\n${run.output}`);

  const mustFlag = [
    ['red-static-import.js', 'bypass-import'],
    ['red-aliased-import.js', 'bypass-import'],
    ['red-namespace-member.js', 'bypass-namespace-member'],
    ['red-dynamic-import.js', 'bypass-dynamic-import'],
    ['red-inline-require.js', 'bypass-require'],
    ['red-reexport.js', 'bypass-reexport'],
    ['red-nonliteral-source.js', 'bypass-require'],
    ['red-empty-restrictions.js', 'empty-restrictions'],
    ['red-unresolved-restrictions.js', 'unresolved-restrictions'],
    ['red-script-only-outside-scripts.js', 'script-only-outside-scripts'],
    ['red-aliased-withdynamicscontext.js', 'empty-restrictions'],
    ['red-namespace-withdynamicscontext.js', 'empty-restrictions'],
  ];
  for (const [file, rule] of mustFlag) {
    expect(run.output.includes(file) && run.output.includes(rule),
      `expected ${file} to be flagged with rule "${rule}":\n${run.output}`);
  }

  const mustNotFlag = [
    'lib/dataverse/core/context.js',
    'lib/services/dynamics-context.js',
    'lib/services/notification-service.js',
    'pages/api/dynamics-explorer/chat.js',
    'lib/services/legit-restricted-caller.js',
  ];
  for (const file of mustNotFlag) {
    expect(!run.output.includes(file), `GREEN fixture ${file} wrongly flagged:\n${run.output}`);
  }

  console.log(`PASS red assertion (all ${mustFlag.length} required shapes flagged; ${mustNotFlag.length} green fixtures clean)`);
}

function runGreenAssertion() {
  setupGreenFixtures();
  writeRedFixtures();
  removeRedFixtures();

  const run = runGate();
  expect(run.status === 0, `expected GREEN (exit 0) after removing violating fixtures, got ${run.status}:\n${run.output}`);
  expect(/OK — \d+ file\(s\) scanned; 0 violations\./.test(run.output), `expected the one-line OK summary, got:\n${run.output}`);
  console.log('PASS green assertion (gate clears once violating fixtures are removed)');
}

try {
  runRedAssertion();
  runGreenAssertion();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
} finally {
  cleanup();
}
