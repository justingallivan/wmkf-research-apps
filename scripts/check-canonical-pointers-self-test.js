#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-canonical-pointers.js.
 *
 * Writes synthetic markdown fixtures into a temp dir under `docs/` so the
 * scanner picks them up, runs the gate, and asserts each fixture is flagged
 * (or not) as expected. Cleans up on success or failure.
 *
 * Also exercises a known-good pointer-shape variant table so future tweaks to
 * the POINTER_RE regex must keep the documented forms working.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-canonical-pointers.js');
const tempDir = path.join(repoRoot, 'docs', 'canonical_pointers_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('docs/canonical_pointers_selftest_tmp');

function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gate)}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function buildFixtures() {
  return [
    {
      name: 'valid pointer to registered fact id is accepted',
      file: 'neg_valid.md',
      body: 'See all [17](docs/CANONICAL_COUNTS.md#app-definition-count) app definitions.',
      expectFlagged: false,
    },
    {
      name: 'valid pointer with ./ prefix is accepted',
      file: 'neg_relative.md',
      body: 'See [52](./docs/CANONICAL_COUNTS.md#requireappaccess-endpoint-count) app endpoints.',
      expectFlagged: false,
    },
    {
      name: 'pointer to unregistered fact id is flagged',
      file: 'pos_unregistered.md',
      body: 'See [99](docs/CANONICAL_COUNTS.md#never-registered) fake count.',
      expectFlagged: true,
      anchor: 'never-registered',
    },
    {
      name: 'pointer with typo in registered fact id is flagged',
      file: 'pos_typo.md',
      body: 'See [17](docs/CANONICAL_COUNTS.md#app-definition-counts) app definitions.',
      expectFlagged: true,
      anchor: 'app-definition-counts',
    },
    {
      name: 'no pointers means no violations',
      file: 'neg_empty.md',
      body: 'A doc with no canonical pointers at all.',
      expectFlagged: false,
    },
    {
      name: 'same-dir link (no docs/ prefix) is accepted',
      file: 'neg_same_dir.md',
      body: 'See all [17](CANONICAL_COUNTS.md#app-definition-count) app definitions.',
      expectFlagged: false,
    },
    {
      name: 'suffix-match path (MY_CANONICAL_COUNTS) is not matched',
      file: 'neg_suffix_safe.md',
      body: 'See [17](docs/MY_CANONICAL_COUNTS.md#app-definition-count) for unrelated doc.',
      expectFlagged: false,
    },
  ];
}

function assertFixtures() {
  fs.mkdirSync(tempDir, { recursive: true });
  const fixtures = buildFixtures();
  for (const fx of fixtures) fs.writeFileSync(path.join(tempDir, fx.file), fx.body + '\n');
  const { status, output } = runGate();

  const anyExpectFlagged = fixtures.some((fx) => fx.expectFlagged);
  if (anyExpectFlagged && status === 0) {
    throw new Error(`expected gate to fail (at least one positive fixture), got status 0.\nOutput:\n${output}`);
  }
  if (!anyExpectFlagged && status !== 0) {
    throw new Error(`expected gate to pass (no positive fixtures), got status ${status}.\nOutput:\n${output}`);
  }

  const failures = [];
  for (const fx of fixtures) {
    const flagged = output.includes(fx.file) && (fx.anchor ? output.includes(`#${fx.anchor}`) : true) && /✗/.test(output);
    // Stronger: re-check by line-matching the file in output
    const fileFlagged = new RegExp(`✗\\s+\\S*${fx.file.replace(/\./g, '\\.')}`).test(output);
    if (fileFlagged !== fx.expectFlagged) failures.push({ fx, flagged: fileFlagged });
  }
  if (failures.length > 0) {
    const details = failures.map(({ fx, flagged }) => `  - ${fx.name}: expected flagged=${fx.expectFlagged}, got ${flagged}`).join('\n');
    throw new Error(`fixture assertion failures:\n${details}\n\nGate output:\n${output}`);
  }
}

function assertCleanRunWhenNoFixtures() {
  cleanup();
  const { status, output } = runGate();
  if (status !== 0) throw new Error(`baseline gate must be clean before/after self-test, got status ${status}:\n${output}`);
}

function main() {
  cleanup();
  assertCleanRunWhenNoFixtures();
  assertFixtures();
  cleanup();
  assertCleanRunWhenNoFixtures();
  console.log('canonical-pointers self-test OK — valid/invalid pointer fixtures handled correctly.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
