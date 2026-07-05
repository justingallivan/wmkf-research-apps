#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-doc-symbol-refs.js.
 *
 * Same architectural shape as the other fan-in gate self-tests: positive
 * fixtures (a dangling path must be flagged), negative fixtures (existing paths,
 * annotated/markered dangling paths, globs, ellipsis abbreviations, relative and
 * URL paths must NOT be flagged), plus a live-baseline-clean assertion.
 *
 * Fixtures are written under docs/agent-wiki/ (a scanned root) so the gate picks
 * them up, then removed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-doc-symbol-refs.js');
const tempDir = path.join(repoRoot, 'docs', 'agent-wiki', '_doc_symbol_refs_selftest_tmp');

// A path guaranteed NOT to exist, and one guaranteed to exist (this gate itself).
const MISSING = 'lib/services/__doc_symbol_refs_selftest_missing__.js';
const PRESENT = 'scripts/check-doc-symbol-refs.js';

// A path that doesn't exist on disk but IS gitignored — via a nested .gitignore
// written into the temp dir below. Has a scanned prefix + checkable ext so the
// detector picks it up, then the git check-ignore exemption must skip it.
const GITIGNORED_SUBDIR = 'ignored-artifacts';
const GITIGNORED_REF = `docs/agent-wiki/_doc_symbol_refs_selftest_tmp/${GITIGNORED_SUBDIR}/out.json`;

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('docs/agent-wiki/_doc_symbol_refs_selftest_tmp');

function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gate)}`, {
      cwd: repoRoot,
      env: { ...process.env, DOC_SYMBOL_REFS_INCLUDE_SELFTEST_TMP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function buildFixtures() {
  return [
    // ── Positives — an unannotated dangling path must be flagged ──────────────
    { name: 'bare backticked dangling path is flagged', file: 'pos_backtick.md',
      body: `Ground truth: \`${MISSING}\`.`, expectFlagged: true },
    { name: 'unbackticked dangling path is flagged', file: 'pos_plain.md',
      body: `See ${MISSING} for the implementation.`, expectFlagged: true },
    { name: 'dangling path with :line ref is flagged', file: 'pos_lineref.md',
      body: `Resolver at \`${MISSING}:42\` handles it.`, expectFlagged: true },
    { name: './-prefixed repo path is normalized and flagged', file: 'pos_dot_slash.md',
      body: `Resolver at \`./${MISSING}\` handles it.`, expectFlagged: true },
    { name: 'keyword exemption is per-ref, not line-wide', file: 'pos_mixed_keyword_proximity.md',
      body: `The \`lib/services/__doc_symbol_refs_selftest_removed__.js\` helper was removed in S281. ${'Filler '.repeat(30)}Also see \`lib/services/__doc_symbol_refs_selftest_far__.js\` for active behavior.`,
      expectFlagged: true,
      expectMissingRefs: ['lib/services/__doc_symbol_refs_selftest_far__.js'],
      expectAbsentRefs: ['lib/services/__doc_symbol_refs_selftest_removed__.js'] },

    // ── Negatives — must NOT be flagged ───────────────────────────────────────
    { name: 'existing path passes', file: 'neg_exists.md',
      body: `Ground truth: \`${PRESENT}\`.`, expectFlagged: false },
    { name: 'same-line "removed" annotation passes', file: 'neg_removed.md',
      body: `The \`${MISSING}\` helper was removed in S281.`, expectFlagged: false },
    { name: 'same-line "renamed to" annotation passes', file: 'neg_renamed.md',
      body: `\`${MISSING}\` was renamed to \`${PRESENT}\`.`, expectFlagged: false },
    { name: 'planned "name it" annotation passes', file: 'neg_planned.md',
      body: `Add a script — name it \`${MISSING}\`.`, expectFlagged: false },
    { name: 'structured ignore marker passes', file: 'neg_marker.md',
      body: `Reference: \`${MISSING}\`. <!-- doc-symbol-refs:ignore reason=test -->`, expectFlagged: false },
    { name: 'glob pattern is not treated as a literal path', file: 'neg_glob.md',
      body: 'Routes under `pages/api/__nope_selftest__/*.js` are gated.', expectFlagged: false },
    { name: 'ellipsis abbreviation segment is skipped', file: 'neg_ellipsis.md',
      body: 'Ground truth: `docs/.../__NOPE_SELFTEST__.md`.', expectFlagged: false },
    { name: 'relative (../) path is not flagged (excluded by lookbehind)', file: 'neg_relative.md',
      body: 'See `../docs/__nope_selftest__.md` for context.', expectFlagged: false },
    { name: 'URL containing a path-like segment is not flagged', file: 'neg_url.md',
      body: `Source: https://github.com/org/repo/blob/main/${MISSING}`, expectFlagged: false },
    // gitignored generated artifact: absent on disk but matched by the nested
    // .gitignore written in assertFixtures(). No same-line keyword, so ONLY the
    // git check-ignore exemption can keep this from being flagged.
    { name: 'gitignored artifact path is skipped (not flagged)', file: 'neg_gitignored.md',
      body: `Output artifact: \`${GITIGNORED_REF}\`.`, expectFlagged: false },
  ];
}

function assertFixtures() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });
  // Nested .gitignore so GITIGNORED_REF is git-ignored without the file existing.
  fs.writeFileSync(path.join(tempDir, '.gitignore'), `${GITIGNORED_SUBDIR}/\n`);
  const fixtures = buildFixtures();
  for (const fx of fixtures) fs.writeFileSync(path.join(tempDir, fx.file), fx.body + '\n');
  const { status, output } = runGate();

  const anyPositive = fixtures.some((fx) => fx.expectFlagged);
  if (anyPositive && status === 0) {
    throw new Error(`expected gate to FAIL (positive fixtures present), got status 0.\nOutput:\n${output}`);
  }

  const failures = [];
  for (const fx of fixtures) {
    const flagged = new RegExp(`✗\\s+\\S*${fx.file.replace(/\./g, '\\.')}`).test(output);
    if (flagged !== fx.expectFlagged) failures.push(`${fx.expectFlagged ? 'MISSED' : 'FALSE-FLAG'}: ${fx.name}`);
    for (const ref of fx.expectMissingRefs || []) {
      if (!output.includes(`missing path ${ref}`)) failures.push(`MISSED-REF: ${fx.name} did not flag ${ref}`);
    }
    for (const ref of fx.expectAbsentRefs || []) {
      if (output.includes(`missing path ${ref}`)) failures.push(`FALSE-FLAG-REF: ${fx.name} flagged ${ref}`);
    }
  }
  cleanup();
  if (failures.length) {
    throw new Error(`fixture expectations failed:\n  - ${failures.join('\n  - ')}\n\nGate output:\n${output}`);
  }
}

function assertBaselineClean() {
  cleanup(); // ensure no fixtures linger
  const { status, output } = runGate();
  if (status !== 0) {
    throw new Error(`live repo baseline is NOT clean (status ${status}):\n${output}`);
  }
}

function main() {
  try {
    assertFixtures();
    assertBaselineClean();
  } finally {
    cleanup();
  }
  console.log('doc-symbol-refs self-test OK — positive/negative fixtures handled correctly, live baseline clean.');
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
