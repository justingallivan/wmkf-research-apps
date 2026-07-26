#!/usr/bin/env node
/**
 * Self-test for scripts/check-doc-currency.js.
 *
 * For every pattern in DRIFT_PATTERNS, exercise the gate against a synthetic
 * .md fixture written into a non-skipped subdirectory of docs/. Each fixture
 * is one of:
 *   - positive: content that should fire the named pattern.
 *   - negative: content that should NOT fire (verifying lookahead /
 *     negation-guard / canonical-shape suffix).
 *
 * Why this exists: doc-currency was promoted to a CI gate in S141. The
 * patterns include negation lookaheads (e.g. the SOT
 * `(?:does not|doesn't|never|no longer)` guard) and proximity constraints
 * that can silently regress when the regex is touched. This binds future
 * edits: drop or invert a pattern, fail CI.
 *
 * When DRIFT_PATTERNS gains a new entry in check-doc-currency.js, ADD a
 * fixture here for it (positive at minimum; negative if the pattern has
 * a lookahead / allow-list / canonical-shape exception worth pinning).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { registerRepoFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
// Inside docs/ so the gate's walker scans it; not in SKIP_DIRS; not a
// dot-directory. Each run cleans this up before and after.
const tempDir = path.join(repoRoot, 'docs', 'doc_currency_selftest_tmp');

// Fixtures: { name, patternId, kind: 'positive' | 'negative', content }.
const FIXTURES = [
  {
    name: 'codename-wmkf_app_researcher (positive)',
    patternId: 'codename-wmkf_app_researcher',
    kind: 'positive',
    content: 'See wmkf_app_researcher in the entity catalog.\n',
  },
  {
    name: 'codename-wmkf_app_publication (positive)',
    patternId: 'codename-wmkf_app_publication',
    kind: 'positive',
    content: 'The wmkf_app_publication table holds rows.\n',
  },
  {
    name: 'codename-wmkf_app_publication (negative — _author suffix)',
    patternId: 'codename-wmkf_app_publication',
    kind: 'negative',
    content: 'The wmkf_app_publication_author bridge stores authorship.\n',
  },
  {
    name: 'codename-wmkf_ai_run-stale-cols (positive)',
    patternId: 'codename-wmkf_ai_run-stale-cols',
    kind: 'positive',
    content: 'Field wmkf_prompt_was_overridden tracks override.\n',
  },
  {
    name: 'liveness-publications-as-live (positive)',
    patternId: 'liveness-publications-as-live',
    kind: 'positive',
    content: 'The publications table is load-bearing for reviewer search.\n',
  },
  {
    name: 'liveness-search_cache-as-live (positive)',
    patternId: 'liveness-search_cache-as-live',
    kind: 'positive',
    content: 'The search_cache table is currently live.\n',
  },
  {
    name: 'sot-prompt-resolver-reads-prompt-table (positive)',
    patternId: 'sot-prompt-resolver-reads-prompt-table',
    kind: 'positive',
    content: 'The prompt-resolver reads wmkf_ai_prompt directly.\n',
  },
  {
    name: 'sot-prompt-resolver-reads-prompt-table (negative — negation guard)',
    patternId: 'sot-prompt-resolver-reads-prompt-table',
    kind: 'negative',
    content: 'The prompt-resolver does not read wmkf_ai_prompt directly.\n',
  },
  {
    name: 'path-reviewer-uploads-wrong-shape (positive)',
    patternId: 'path-reviewer-uploads-wrong-shape',
    kind: 'positive',
    content: 'Files land under Reviewer_Upload (singular).\n',
  },
  {
    name: 'path-reviewer-uploads-wrong-shape (negative — canonical shape)',
    patternId: 'path-reviewer-uploads-wrong-shape',
    kind: 'negative',
    content: 'Files land under Reviewer_Uploads/{reviewerSubfolder}.\n',
  },
  {
    name: 'path-reviewer-materials-old-contract (positive — old folder)',
    patternId: 'path-reviewer-materials-old-contract',
    kind: 'positive',
    content: 'Reviewers fetch from Reviewer_Downloads/.\n',
  },
  {
    name: 'path-reviewer-materials-old-contract (positive — old env allowlist)',
    patternId: 'path-reviewer-materials-old-contract',
    kind: 'positive',
    content: 'Set REVIEWER_MATERIALS_FOLDERS to widen access.\n',
  },
  {
    name: 'path-reviewer-materials-old-contract (negative — canonical shape)',
    patternId: 'path-reviewer-materials-old-contract',
    kind: 'negative',
    content: 'Reviewers fetch only Reviewer Materials/Proposal_1002379.pdf.\n',
  },
];

// Disposer from the shared helper (cleans a prior orphan at registration and
// on catchable exit); every pre-existing cleanup() call point below is kept 1:1.
const { cleanup } = registerRepoFixture('docs/doc_currency_selftest_tmp');

function runGate() {
  try {
    return execSync('node scripts/check-doc-currency.js', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function uniqueBasename(seed) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${rand}_${seed}.md`;
}

// The gate prints each file's hits as:
//   ## <kind> (n)
//
//     <relative file path>
//       pattern: <id> (×N)
//       sample:  ...
//       reason:  ...
//
// Find the block for `fixturePath` and check whether the named pattern is
// listed inside it.
function fixtureMatched(output, fixturePath, patternId) {
  const escaped = fixturePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(`^  ${escaped}\\n((?:    .+\\n?)+)`, 'm');
  const m = output.match(blockRe);
  if (!m) return false;
  return m[1].includes(`pattern: ${patternId}`);
}

function main() {
  cleanup();
  fs.mkdirSync(tempDir, { recursive: true });

  const failures = [];
  let passed = 0;

  for (let i = 0; i < FIXTURES.length; i += 1) {
    const fixture = FIXTURES[i];
    const basename = uniqueBasename(`fix${i}`);
    const fixturePath = path.join(tempDir, basename);
    const fixtureRel = path.relative(repoRoot, fixturePath);
    fs.writeFileSync(fixturePath, fixture.content);

    const output = runGate();
    const matched = fixtureMatched(output, fixtureRel, fixture.patternId);

    const wantMatch = fixture.kind === 'positive';
    if (matched === wantMatch) {
      passed += 1;
    } else {
      failures.push({
        name: fixture.name,
        kind: fixture.kind,
        patternId: fixture.patternId,
        content: fixture.content.trim(),
        outputTail: output.slice(-400).trim(),
      });
    }

    fs.unlinkSync(fixturePath);
  }

  cleanup();

  if (failures.length > 0) {
    console.error(
      `Doc-currency self-test FAIL — ${failures.length} of ${FIXTURES.length} fixture(s) wrong:\n`,
    );
    for (const f of failures) {
      console.error(`  ✗ ${f.name}`);
      console.error(`    Pattern:    ${f.patternId} (${f.kind} fixture)`);
      console.error(`    Content:    ${f.content}`);
      console.error(`    Gate tail:  ${f.outputTail}\n`);
    }
    console.error(
      'A regression in scripts/check-doc-currency.js DRIFT_PATTERNS dropped or\n' +
        'inverted detection of a documented pattern. Restore the pattern, or — if\n' +
        "the intent changed — update both check-doc-currency.js AND this fixture\n" +
        'array together.\n',
    );
    process.exit(1);
  }

  console.log(
    `Doc-currency self-test OK — ${passed}/${FIXTURES.length} fixtures behaved as expected.`,
  );
}

try {
  main();
} catch (e) {
  cleanup();
  console.error(e);
  process.exit(2);
}
