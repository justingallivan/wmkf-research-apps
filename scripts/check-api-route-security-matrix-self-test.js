#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-api-route-security-matrix.js.
 *
 * Drives the real gate against synthetic fixture routes + a fixture matrix via
 * the API_ROUTE_GATE_API_ROOT / API_ROUTE_GATE_MATRIX_PATH env overrides, then
 * asserts which routes are warned about (no recognized guard) and which are not.
 *
 * Covers the Phase-4 HMAC recognition added 2026-06-11:
 *   - HMAC helper token + documented HMAC matrix row  → NOT warned
 *   - HMAC helper token + NON-HMAC matrix row         → still warned
 *   - known session guard token                        → NOT warned
 *   - intentional `None` guard row                     → NOT warned
 *   - no guard token + non-None row                    → warned
 *
 * Fixtures live under pages/_route_gate_selftest_tmp so the gate's
 * pages-relative toRoute() produces clean route strings. Cleans up always.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-api-route-security-matrix.js');
const fixtureApiRoot = path.join(repoRoot, 'pages', '_route_gate_selftest_tmp');
const fixtureMatrix = path.join(repoRoot, 'scripts', '_route_gate_selftest_matrix.md');
const routePrefix = '/_route_gate_selftest_tmp';

function cleanup() {
  if (fs.existsSync(fixtureApiRoot)) fs.rmSync(fixtureApiRoot, { recursive: true, force: true });
  if (fs.existsSync(fixtureMatrix)) fs.rmSync(fixtureMatrix, { force: true });
}

function runGate(env) {
  // Merge stderr into stdout (2>&1): the gate writes its no-guard warnings via
  // console.warn (stderr) but exits 0, so a plain execSync return — which is
  // stdout only — would miss the warnings on the success path.
  try {
    return {
      status: 0,
      output: execSync(`node ${JSON.stringify(gate)} 2>&1`, {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: { ...process.env, ...env },
      }),
    };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

// name → { source, matrixRow, expectWarned }
function buildFixtures() {
  const row = (name, intendedClass, currentGuard) =>
    `| \`${routePrefix}/${name}\` | POST | ${intendedClass} | ${currentGuard} | Fixture scope | None | Low | self-test fixture |`;
  return [
    {
      name: 'hmac-documented',
      source: "import { verifyBillWebhook } from '../../lib/bill';\nexport default function handler(req, res) { verifyBillWebhook(); res.end(); }\n",
      matrixRow: row('hmac-documented', 'Shared secret (HMAC)', '`x-sig` HMAC-SHA256 verified'),
      expectWarned: false,
    },
    {
      name: 'hmac-undocumented',
      source: "import { verifyInternalCall } from '../../lib/bill/internal-call-auth';\nexport default function handler(req, res) { verifyInternalCall(); res.end(); }\n",
      // HMAC helper present but the row documents no shared-secret boundary → still warned.
      matrixRow: row('hmac-undocumented', 'Internal', '(planned)'),
      expectWarned: true,
    },
    {
      name: 'known-guard',
      source: "import { requireAppAccess } from '../../lib/utils/auth';\nexport default function handler(req, res) { requireAppAccess(req, res); res.end(); }\n",
      matrixRow: row('known-guard', 'App-scoped', '`requireAppAccess`'),
      expectWarned: false,
    },
    {
      name: 'intentional-none',
      source: "export default function handler(req, res) { res.json({ ok: true }); }\n",
      matrixRow: row('intentional-none', 'Public metadata', 'None'),
      expectWarned: false,
    },
    {
      name: 'unguarded',
      source: "export default function handler(req, res) { res.json({ secret: true }); }\n",
      matrixRow: row('unguarded', 'Authenticated', 'TODO add guard'),
      expectWarned: true,
    },
  ];
}

function assertFixtures() {
  cleanup();
  fs.mkdirSync(fixtureApiRoot, { recursive: true });
  const fixtures = buildFixtures();
  for (const fx of fixtures) {
    fs.writeFileSync(path.join(fixtureApiRoot, `${fx.name}.js`), fx.source);
  }
  const matrixBody = [
    '| Route | Methods | Intended Class | Current Guard | Data Scope | Persistence | Risk | Notes |',
    '|---|---:|---|---|---|---|---|---|',
    ...fixtures.map((fx) => fx.matrixRow),
    '',
  ].join('\n');
  fs.writeFileSync(fixtureMatrix, matrixBody);

  const { status, output } = runGate({
    API_ROUTE_GATE_API_ROOT: fixtureApiRoot,
    API_ROUTE_GATE_MATRIX_PATH: fixtureMatrix,
  });

  // All fixture routes are present in the fixture matrix, so the gate must not
  // hard-fail on "missing from matrix" (exit 1). Warnings keep exit 0.
  if (status !== 0) {
    throw new Error(`gate hard-failed (status ${status}) on fully-documented fixtures; expected 0.\nOutput:\n${output}`);
  }

  const failures = [];
  for (const fx of fixtures) {
    const warned = new RegExp(`-\\s+${routePrefix}/${fx.name}\\b`).test(output);
    if (warned !== fx.expectWarned) failures.push({ fx, warned });
  }
  if (failures.length > 0) {
    const details = failures
      .map(({ fx, warned }) => `  - ${fx.name}: expected warned=${fx.expectWarned}, got ${warned}`)
      .join('\n');
    throw new Error(`fixture assertion failures:\n${details}\n\nGate output:\n${output}`);
  }
}

function assertMissingRouteHardFails() {
  // A fixture route absent from the matrix must hard-fail (exit 1), proving the
  // HMAC-recognition change did not weaken the missing-from-matrix guarantee.
  cleanup();
  fs.mkdirSync(fixtureApiRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureApiRoot, 'orphan.js'), 'export default function handler(req, res) { res.end(); }\n');
  fs.writeFileSync(
    fixtureMatrix,
    '| Route | Methods | Intended Class | Current Guard | Data Scope | Persistence | Risk | Notes |\n|---|---:|---|---|---|---|---|---|\n',
  );
  const { status, output } = runGate({
    API_ROUTE_GATE_API_ROOT: fixtureApiRoot,
    API_ROUTE_GATE_MATRIX_PATH: fixtureMatrix,
  });
  cleanup();
  if (status !== 1) {
    throw new Error(`expected missing-from-matrix route to hard-fail (exit 1); got ${status}.\nOutput:\n${output}`);
  }
  if (!/missing from/i.test(output)) {
    throw new Error(`expected "missing from" message for orphan route; got:\n${output}`);
  }
}

function assertCleanBaseline() {
  // The real gate (no overrides) must be clean before and after the self-test.
  cleanup();
  const { status, output } = runGate({});
  if (status !== 0) {
    throw new Error(`baseline real gate must pass before/after self-test; got status ${status}:\n${output}`);
  }
}

function main() {
  cleanup();
  assertCleanBaseline();
  assertFixtures();
  cleanup();
  assertMissingRouteHardFails();
  assertCleanBaseline();
  console.log('api-route-security-matrix self-test OK — HMAC recognition, known guards, intentional None, and missing-route hard-fail all enforced.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
