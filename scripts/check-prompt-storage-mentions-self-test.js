#!/usr/bin/env node
/**
 * Binding self-test for scripts/check-prompt-storage-mentions.js.
 *
 * Same architectural shape as check:drain-table-mentions-self-test:
 * positive fixtures (must flag), negative fixtures (must NOT flag),
 * file-marker constraint test (marker on wrong-path is a configuration
 * error, not a silent bypass).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
const gate = path.join(repoRoot, 'scripts', 'check-prompt-storage-mentions.js');
const tempDir = path.join(repoRoot, 'docs', 'prompt_storage_selftest_tmp');

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('docs/prompt_storage_selftest_tmp');

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
    // Positive — bare mention without annotation
    {
      name: 'bare backticked mention is flagged',
      file: 'pos_bare.md',
      body: 'Prompts will live in `wmkf_prompt_template` per the plan.',
      expectFlagged: true,
    },
    {
      name: 'bare quoted (single) is flagged',
      file: 'pos_single_quote.md',
      body: "Plan says prompts come from 'wmkf_prompt_template'.",
      expectFlagged: true,
    },
    {
      name: 'dotted column ref is flagged',
      file: 'pos_dotted.md',
      body: 'Read wmkf_prompt_template.wmkf_body for the system prompt.',
      expectFlagged: true,
    },
    {
      name: 'unbackticked + db-context is flagged',
      file: 'pos_db_context.md',
      body: 'The wmkf_prompt_template table needs three new columns.',
      expectFlagged: true,
    },
    {
      name: 'SQL-shape phrasing is flagged',
      file: 'pos_sql_shape.md',
      body: 'Job fetches from wmkf_prompt_template at startup.',
      expectFlagged: true,
    },
    {
      name: 'stale "wmkf_ai_prompt is the live table; wmkf_prompt_template" is flagged when no historical keyword',
      file: 'pos_dataverse_keyword_alone.md',
      body: 'Both Dataverse `wmkf_ai_prompt` and `wmkf_prompt_template` are options for storage.',
      expectFlagged: true,
    },
    // Negative — annotated mentions
    {
      name: 'same-line "historical" annotation passes',
      file: 'neg_historical.md',
      body: 'Historical name `wmkf_prompt_template` was renamed before shipping.',
      expectFlagged: false,
    },
    {
      name: 'same-line "renamed" annotation passes',
      file: 'neg_renamed.md',
      body: '`wmkf_prompt_template` was renamed to `wmkf_ai_prompt` before deployment.',
      expectFlagged: false,
    },
    {
      name: 'same-line "never materialized" annotation passes',
      file: 'neg_never_materialized.md',
      body: 'The `wmkf_prompt_template` table never materialized — Connor built it as `wmkf_ai_prompt` instead.',
      expectFlagged: false,
    },
    {
      name: 'same-line "proposed" annotation passes',
      file: 'neg_proposed.md',
      body: 'The proposed `wmkf_prompt_template` table evolved into the live `wmkf_ai_prompt`.',
      expectFlagged: false,
    },
    {
      name: 'strikethrough markdown passes',
      file: 'neg_strikethrough.md',
      body: '~~`wmkf_prompt_template`~~ → `wmkf_ai_prompt` (final name).',
      expectFlagged: false,
    },
    {
      name: 'structured ignore marker passes',
      file: 'neg_marker.md',
      body: 'Reference: `wmkf_prompt_template` (old design name). <!-- prompt-storage:ignore reason=test -->',
      expectFlagged: false,
    },
    // Negative — false-positive guards
    {
      name: 'unrelated identifier with similar suffix is not flagged',
      file: 'neg_similar.md',
      body: 'The `wmkf_prompt_template_v2_legacy` cache lives elsewhere.',
      expectFlagged: false,
    },
    // Post-pass-N additions per Codex review.
    {
      name: 'double-quoted name is flagged',
      file: 'pos_double_quote.md',
      body: 'The team picked "wmkf_prompt_template" as the working name.',
      expectFlagged: true,
    },
    {
      name: 'Dataverse-prefixed identifier is flagged',
      file: 'pos_dataverse_prefix.md',
      body: 'PA will read from Dataverse wmkf_prompt_template at startup.',
      expectFlagged: true,
    },
    {
      name: 'plural variant is flagged',
      file: 'pos_plural.md',
      body: 'A pool of `wmkf_prompt_templates` per program area is planned.',
      expectFlagged: true,
    },
    {
      name: 'no-underscore variant is flagged',
      file: 'pos_no_underscore.md',
      body: 'The wmkf_prompttemplate entity is the source of prompts.',
      expectFlagged: true,
    },
    {
      name: '"draft" alone does NOT exempt (regression guard for tightened keywords)',
      file: 'pos_draft_not_exempt.md',
      body: 'Create draft rows in `wmkf_prompt_template` for review.',
      expectFlagged: true,
    },
    {
      name: '"pre-shipped" alone does NOT exempt (regression guard)',
      file: 'pos_pre_shipped_not_exempt.md',
      body: 'Create pre-shipped rows in `wmkf_prompt_template` ahead of cutover.',
      expectFlagged: true,
    },
    {
      name: '"Dataverse" alone does NOT exempt (regression guard)',
      file: 'pos_dataverse_not_exempt.md',
      body: 'The Dataverse `wmkf_prompt_template` table is the source.',
      expectFlagged: true,
    },
    {
      name: '"wmkf_ai_prompt" mention alone does NOT exempt',
      file: 'pos_ai_prompt_not_exempt.md',
      body: 'Use either `wmkf_prompt_template` or `wmkf_ai_prompt` depending on the cycle.',
      expectFlagged: true,
    },
    {
      name: '"legacy" annotation passes',
      file: 'neg_legacy.md',
      body: 'The legacy `wmkf_prompt_template` design was retired before deployment.',
      expectFlagged: false,
    },
    {
      name: '"replaces" annotation passes',
      file: 'neg_replaces.md',
      body: '`wmkf_ai_prompt` replaces `wmkf_prompt_template` per the rename.',
      expectFlagged: false,
    },
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

function assertFileMarkerConstraint() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });
  const offending = path.join(tempDir, 'pos_marker_wrong_path.md');
  fs.writeFileSync(offending, '<!-- prompt-storage:file-purpose=design-history -->\n\nNot the actual PROMPT_STORAGE_DESIGN.md path.\n');
  const { status, output } = runGate();
  cleanup();
  if (status !== 2) {
    throw new Error(`file-marker constraint should fail with exit 2 (configuration error) on a marker outside its allowed paths; got status ${status}:\n${output}`);
  }
  if (!/configuration error/i.test(output) || !/file-purpose=design-history/.test(output)) {
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
  console.log('prompt-storage-mentions self-test OK — positive/negative fixtures handled correctly, and file-marker constraint enforced.');
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e.message || e);
  process.exit(1);
}
