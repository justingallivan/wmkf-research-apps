#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-build-claim-freshness.js.
 *
 * Same shape as the doc-symbol-refs self-test: positive fixtures (a pending
 * construction on an EXISTING path must be flagged), negative fixtures (pending
 * on an ABSENT path, completion markers, bare "planned" labels, the wrong path
 * on a multi-path line, gitignored artifacts, structured marker — none flagged),
 * plus a live-baseline-clean assertion (the audited corpus must stay green).
 *
 * Fixtures are written under docs/agent-wiki/ (a scanned root, opened to the
 * temp dir via the env override) so the gate picks them up, then removed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-build-claim-freshness.js');
const tempDir = path.join(repoRoot, 'docs', 'agent-wiki', '_build_claim_freshness_selftest_tmp');

// A path that EXISTS (this gate), and one that does NOT.
const PRESENT = 'scripts/check-build-claim-freshness.js';
const MISSING = 'lib/services/__build_claim_freshness_selftest_missing__.js';

// A path that EXISTS but is gitignored — via a nested .gitignore + a real file
// created under it in assertFixtures(). The git check-ignore skip must drop it.
const GITIGNORED_SUBDIR = 'ignored-artifacts';
const GITIGNORED_REF = `docs/agent-wiki/_build_claim_freshness_selftest_tmp/${GITIGNORED_SUBDIR}/built.js`;

function cleanup() {
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
}

function runGate() {
  try {
    return { status: 0, output: execSync(`node ${JSON.stringify(gate)}`, {
      cwd: repoRoot,
      env: { ...process.env, BUILD_CLAIM_FRESHNESS_INCLUDE_SELFTEST_TMP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }) };
  } catch (e) {
    return { status: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function buildFixtures() {
  return [
    // ── Positives — a pending construction on an EXISTING path must be flagged ──
    { name: '"to live at `PATH`" where PATH exists is flagged', file: 'pos_to_live_at.md',
      body: `The helper will live at \`${PRESENT}\`.`, expectFlagged: true },
    { name: '"Planned: `PATH`" where PATH exists is flagged', file: 'pos_planned_colon.md',
      body: `Planned: \`${PRESENT}\` carries the gate.`, expectFlagged: true },
    { name: '"`PATH` (planned)" tag where PATH exists is flagged', file: 'pos_after_tag.md',
      body: `See \`${PRESENT}\` (planned) for the shape.`, expectFlagged: true },
    { name: '"to be created at `PATH`" where PATH exists is flagged', file: 'pos_to_be_created.md',
      body: `A gate to be created at \`${PRESENT}\`.`, expectFlagged: true },

    // ── Negatives — must NOT be flagged ───────────────────────────────────────
    { name: 'pending construction on an ABSENT path is not flagged (doc-symbol-refs job)', file: 'neg_pending_absent.md',
      body: `The helper will live at \`${MISSING}\`.`, expectFlagged: false },
    { name: 'plain existing-path reference (no pending) is not flagged', file: 'neg_plain_existing.md',
      body: `Ground truth: \`${PRESENT}\`.`, expectFlagged: false },
    { name: 'completion marker on the line exempts an existing path', file: 'neg_done_marker.md',
      body: `The gate to be created at \`${PRESENT}\` is now built and shipped.`, expectFlagged: false },
    { name: '"now lives at `PATH`" is not a pending construction', file: 'neg_now_lives.md',
      body: `The gate now lives at \`${PRESENT}\`.`, expectFlagged: false },
    { name: 'bare "planned" topic label near an existing path is not flagged', file: 'neg_bare_planned_label.md',
      body: `Strategy, roadmap, planned automation — see \`${PRESENT}\` for the gate.`, expectFlagged: false },
    { name: 'multi-path line: pending governs the ABSENT path, existing path untouched', file: 'neg_multipath.md',
      body: `Extend \`${PRESENT}\` to call a new helper (to live at \`${MISSING}\`).`, expectFlagged: false },
    { name: 'structured ignore marker passes', file: 'neg_marker.md',
      body: `The gate will live at \`${PRESENT}\`. <!-- build-claim-freshness:ignore reason=test -->`, expectFlagged: false },
    // gitignored existing artifact in a pending construction: skipped via git check-ignore.
    { name: 'gitignored existing artifact is skipped (not flagged)', file: 'neg_gitignored.md',
      body: `Output to live at \`${GITIGNORED_REF}\`.`, expectFlagged: false },
  ];
}

function assertFixtures() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });
  // Nested .gitignore + a REAL file under it, so GITIGNORED_REF both exists and
  // is git-ignored (the skip path only triggers on existing candidates).
  fs.writeFileSync(path.join(tempDir, '.gitignore'), `${GITIGNORED_SUBDIR}/\n`);
  fs.mkdirSync(path.join(tempDir, GITIGNORED_SUBDIR), { recursive: true });
  fs.writeFileSync(path.join(tempDir, GITIGNORED_SUBDIR, 'built.js'), '// selftest artifact\n');

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
  }
  cleanup();
  if (failures.length) {
    throw new Error(`fixture expectations failed:\n  - ${failures.join('\n  - ')}\n\nGate output:\n${output}`);
  }
}

function assertBaselineClean() {
  cleanup();
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
  console.log('build-claim-freshness self-test OK — positive/negative fixtures handled correctly, live baseline clean.');
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
