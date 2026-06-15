'use strict';

/**
 * Plain-node test matrix for git-commit-detect.js (no jest dependency).
 * Run: node .claude/hooks/lib/git-commit-detect.test.js
 *
 * Asserts the shared commit trigger MATCHES every real `git commit` form
 * (including global-option forms the old /\bgit\s+commit\b/ missed) and does NOT
 * match the plumbing/lookalike cases.
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { isGitCommit, isAmend } = require('./git-commit-detect');

const MATCH = [
  'git commit',
  'git commit -m "msg"',
  'git commit --amend',
  'git commit -F .git/MSG.txt',
  'git -c user.name=x commit -m y',          // global -c + value, old regex MISSED
  'git -c user.email=a@b -c user.name=x commit',
  'git -C /path/to/repo commit -m y',        // -C + value, old regex MISSED
  'git --no-pager commit',                   // bare global flag, old regex MISSED
  'git --git-dir=/x commit',                 // --opt=value form
  'git --git-dir /x commit',                 // --opt value (separate) form
  'git -c core.autocrlf=false commit',       // single -c=value then commit
  'git -C "path with spaces/repo" commit',   // quoted value for a value-taking global option
  'git -c "user.name=x" commit',             // quoted value must not make the skip consume commit
  'git --git-dir "/tmp/repo.git" commit',    // quoted separate value for long global option
  'git -C repo\\(old\\) commit',             // escaped parens in a value must not split away commit
  'git -P commit',                           // bare paginate flag, no value
  'git add . && git commit -m y',            // second segment of a compound
  'git add -A ; git commit',
  'cd repo && git commit -m y',
  'git commit -m "fix: a || b"',             // separator inside the (stripped) message
  '(git commit -m y)',                       // subshell grouping (Codex follow-up)
  'env GIT_DIR=.git git commit',             // env prefix (Codex follow-up)
  'sudo git commit -m y',                    // sudo prefix
  'GIT_AUTHOR_NAME=x git commit',            // leading env assignment
  'git commit -m "Justin\'s fix"',           // apostrophe inside a double-quoted message
  "git commit -m 'oops with no closing quote", // unterminated quote is left literal; liberal matcher still sees commit
];

const NO_MATCH = [
  'git commit-tree abc123',                  // plumbing, NOT commit
  'git commit-graph write',                  // plumbing, NOT commit
  'git log --oneline -5',
  'git status',
  'git add .',
  'git diff --cached',
  'git log --oneline | grep commit',         // commit only in a piped non-git segment
  'echo "git commit"',                       // quoted lookalike → stripped away
  'echo "about to run git commit later"',    // commit mention inside a quoted string
  'npm run check:trust-boundary-guid',
  'ls -la',
  '',
  'git',
];

// Accepted LIBERAL false-positives: an unquoted `git commit` lookalike with no
// real invocation. These return true on purpose — matching stays liberal so a
// blocking guard never MISSES a real commit; the cost is one extra gate run on a
// clean tree (harmless). Locked here so the behavior is intentional, not a
// surprise regression. (Codex S259 follow-up, Q2c.)
const LIBERAL_TRUE = [
  'echo git commit',                         // unquoted lookalike (no real commit)
];

let failures = 0;
for (const c of MATCH) {
  try { assert.strictEqual(isGitCommit(c), true); console.log(`  ✓ MATCH  ${c}`); }
  catch { failures++; console.error(`  ✗ MATCH  ${c} — expected true, got false`); }
}
for (const c of NO_MATCH) {
  try { assert.strictEqual(isGitCommit(c), false); console.log(`  ✓ no-match  ${JSON.stringify(c)}`); }
  catch { failures++; console.error(`  ✗ no-match  ${JSON.stringify(c)} — expected false, got true`); }
}
for (const c of LIBERAL_TRUE) {
  try { assert.strictEqual(isGitCommit(c), true); console.log(`  ✓ liberal-true (accepted)  ${JSON.stringify(c)}`); }
  catch { failures++; console.error(`  ✗ liberal-true  ${JSON.stringify(c)} — expected true`); }
}

// isAmend — blocking guards ignore it; self-review uses it to skip amends.
const AMEND_CASES = [
  ['git commit --amend', true],
  ['git commit -m x', false],
  ['git commit --amend --no-edit', true],
  ['git commit -m "do not use --amend here"', false], // --amend inside the message must NOT skip (Codex follow-up)
];
for (const [c, want] of AMEND_CASES) {
  try { assert.strictEqual(isAmend(c), want); console.log(`  ✓ isAmend(${JSON.stringify(c)}) === ${want}`); }
  catch { failures++; console.error(`  ✗ isAmend(${JSON.stringify(c)}) — expected ${want}`); }
}

// Blocking commit guards must fail OPEN if the shared trigger helper is missing
// or broken at load time. This locks the require-inside-try contract: the process
// exits 0 (allow) rather than 2 (block).
const BLOCKING_GUARDS = [
  'enum-parity-commit-guard.js',
  'trust-boundary-guid-commit-guard.js',
];
for (const hook of BLOCKING_GUARDS) {
  const hookPath = path.resolve(__dirname, '..', hook);
  const script = `
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === './lib/git-commit-detect') throw new Error('synthetic broken helper');
      return originalLoad.apply(this, arguments);
    };
    require(${JSON.stringify(hookPath)});
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m x' },
      cwd: path.resolve(__dirname, '..', '..', '..'),
    }),
    encoding: 'utf8',
  });
  try { assert.strictEqual(child.status, 0); console.log(`  ✓ ${hook} fails open when git-commit-detect load throws`); }
  catch {
    failures++;
    console.error(`  ✗ ${hook} should fail open on helper load error; status=${child.status} stderr=${JSON.stringify(child.stderr)}`);
  }
}

if (failures) { console.error(`\ngit-commit-detect test FAILED — ${failures} case(s).`); process.exit(1); }
console.log(`\ngit-commit-detect test OK — ${MATCH.length + NO_MATCH.length + LIBERAL_TRUE.length + AMEND_CASES.length + BLOCKING_GUARDS.length} cases.`);
