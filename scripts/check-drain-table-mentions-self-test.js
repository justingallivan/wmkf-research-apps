#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-drain-table-mentions.js.
 *
 * Writes synthetic markdown fixtures into a temp dir under `docs/` so the
 * scanner picks them up, runs the gate, asserts each fixture is flagged
 * (or not) as expected. Cleans up on success or failure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-drain-table-mentions.js');
const tempDir = path.join(repoRoot, 'docs', 'drain_table_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('docs/drain_table_selftest_tmp');

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
    // Positive: bare mention with no annotation is flagged.
    {
      name: 'bare backticked mention without annotation is flagged',
      file: 'pos_bare.md',
      body: 'Saved candidates land in `reviewer_suggestions` for later processing.',
      expectFlagged: true,
    },
    {
      name: 'bare "Postgres X" phrasing without annotation is flagged',
      file: 'pos_postgres_phrase.md',
      body: 'Cycle data is stored in Postgres grant_cycles for the dashboard.',
      expectFlagged: true,
    },
    {
      name: 'multiple tables on one line — both flagged unless annotated',
      file: 'pos_multi.md',
      body: 'The pipeline writes to `researchers` and `publications` after each search.',
      expectFlagged: true,
    },
    // Negative: same-line keyword annotates the mention.
    {
      name: 'same-line "drain-only" annotation passes',
      file: 'neg_drain_keyword.md',
      body: '`reviewer_suggestions` is drain-only post-W3-W6 (2026-05-12).',
      expectFlagged: false,
    },
    {
      name: 'same-line Dataverse mention annotates the migration context',
      file: 'neg_dataverse_keyword.md',
      body: '`grant_cycles` data moved to Dataverse `wmkf_appgrantcycle` at W3 cutover.',
      expectFlagged: false,
    },
    {
      name: 'strikethrough markdown annotates retirement',
      file: 'neg_strikethrough.md',
      body: '~~`researchers` table read path~~ — retired 2026-05-12.',
      expectFlagged: false,
    },
    {
      name: 'structured ignore marker on same line passes',
      file: 'neg_marker.md',
      body: '`proposal_searches` referenced as a historical example. <!-- drain-table:ignore reason=test -->',
      expectFlagged: false,
    },
    {
      name: 'structured marker without reason attribute still passes',
      file: 'neg_marker_no_reason.md',
      body: '`reviewer_suggestions` referenced in legacy context. <!-- drain-table:ignore -->',
      expectFlagged: false,
    },
    // Negative: words that look similar but are not the table identifier.
    {
      name: 'non-backticked English noun "researchers" is not flagged',
      file: 'neg_english_noun.md',
      body: 'The researchers reviewed three proposals this cycle.',
      expectFlagged: false,
    },
    {
      name: 'unrelated table name with similar prefix is not flagged',
      file: 'neg_similar_prefix.md',
      body: 'The `researcher_metrics_legacy` cache lives elsewhere.',
      expectFlagged: false,
    },
    // S167 pass-5 regression guards — Codex flagged these gaps explicitly.
    {
      name: 'dotted column reference is flagged (was missed pre-tightening)',
      file: 'pos_dotted.md',
      body: 'Stale guard reads reviewer_suggestions.user_profile_id directly.',
      expectFlagged: true,
    },
    {
      name: 'single-quoted name is flagged',
      file: 'pos_single_quote.md',
      body: "Some old script queries 'reviewer_suggestions' for backfill diff.",
      expectFlagged: true,
    },
    {
      name: 'unbackticked db-context phrase is flagged',
      file: 'pos_db_context.md',
      body: 'The current reviewer_suggestions schema is what the planner consumes.',
      expectFlagged: true,
    },
    {
      name: 'SQL-shape phrasing is flagged',
      file: 'pos_sql_shape.md',
      body: 'The job reads from reviewer_suggestions every minute.',
      expectFlagged: true,
    },
    {
      name: 'stale "before Dataverse migration" no longer passes on Dataverse keyword alone',
      file: 'pos_stale_dataverse.md',
      body: 'Review Manager reads from Postgres `reviewer_suggestions` before Dataverse migration.',
      expectFlagged: true,
    },
    {
      name: 'bare "planned" no longer exempts',
      file: 'pos_stale_planned.md',
      body: 'Cleanup of `reviewer_suggestions` is planned for next quarter.',
      expectFlagged: true,
    },
    // File-purpose marker mechanism is exercised in a separate test (below)
    // because the marker tag has a path constraint and the temp-dir path
    // does not match any allowed tag's path pattern.
  ];
}

function assertFixtures() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });
  const fixtures = buildFixtures();
  for (const fx of fixtures) fs.writeFileSync(path.join(tempDir, fx.file), fx.body + '\n');
  const { status, output } = runGate();

  const anyExpectFlagged = fixtures.some((fx) => fx.expectFlagged);
  if (anyExpectFlagged && status === 0) {
    throw new Error(`expected gate to fail (positive fixtures present), got status 0.\nOutput:\n${output}`);
  }
  if (!anyExpectFlagged && status !== 0) {
    throw new Error(`expected gate to pass (no positive fixtures), got status ${status}.\nOutput:\n${output}`);
  }

  const failures = [];
  for (const fx of fixtures) {
    const fileFlagged = new RegExp(`✗\\s+\\S*${fx.file.replace(/\./g, '\\.')}`).test(output);
    if (fileFlagged !== fx.expectFlagged) failures.push({ fx, flagged: fileFlagged });
  }
  if (failures.length > 0) {
    const details = failures.map(({ fx, flagged }) => `  - ${fx.name}: expected flagged=${fx.expectFlagged}, got ${flagged}; body=${fx.body}`).join('\n');
    throw new Error(`fixture assertion failures:\n${details}\n\nGate output:\n${output}`);
  }
}

function assertCleanBaseline() {
  cleanup();
  const { status, output } = runGate();
  if (status !== 0) throw new Error(`baseline gate must be clean before/after self-test, got status ${status}:\n${output}`);
}

// Verify the file-purpose marker constraint: a marker declared on a file
// whose path is NOT in the tag's allowed-paths list must trigger a
// configuration error (gate exits 2), not a silent bypass. Codex pass-6
// flagged the unconstrained pre-fix mechanism as an unrestricted bypass;
// this test binds the constraint.
function assertFileMarkerConstraint() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });
  const offending = path.join(tempDir, 'pos_marker_wrong_path.md');
  fs.writeFileSync(offending, '<!-- drain-table:file-purpose=atlas-state-page -->\n\nNot actually an atlas path.\n');
  const { status, output } = runGate();
  cleanup();
  if (status !== 2) {
    throw new Error(`file-marker constraint should fail with exit 2 (configuration error) on a marker outside its allowed paths; got status ${status}:\n${output}`);
  }
  if (!/configuration error/i.test(output) || !/file-purpose=atlas-state-page/.test(output)) {
    throw new Error(`expected configuration-error output mentioning file-purpose tag; got:\n${output}`);
  }
}

function main() {
  cleanup();
  assertCleanBaseline();
  assertFixtures();
  cleanup();
  assertFileMarkerConstraint();
  assertCleanBaseline();
  console.log('drain-table-mentions self-test OK — positive/negative fixtures handled correctly, and file-marker constraint enforced.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
