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
  'git add . && git commit -m y',            // second segment of a compound
  'git add -A ; git commit',
  'cd repo && git commit -m y',
  'git commit -m "fix: a || b"',             // separator inside the message
];

const NO_MATCH = [
  'git commit-tree abc123',                  // plumbing, NOT commit
  'git commit-graph write',                  // plumbing, NOT commit
  'git log --oneline -5',
  'git status',
  'git add .',
  'git diff --cached',
  'echo "git commit"',                       // quoted lookalike
  'npm run check:trust-boundary-guid',
  'ls -la',
  '',
  'git',
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

// isAmend
for (const [c, want] of [['git commit --amend', true], ['git commit -m x', false], ['git commit --amend --no-edit', true]]) {
  try { assert.strictEqual(isAmend(c), want); console.log(`  ✓ isAmend(${JSON.stringify(c)}) === ${want}`); }
  catch { failures++; console.error(`  ✗ isAmend(${JSON.stringify(c)}) — expected ${want}`); }
}

if (failures) { console.error(`\ngit-commit-detect test FAILED — ${failures} case(s).`); process.exit(1); }
console.log(`\ngit-commit-detect test OK — ${MATCH.length + NO_MATCH.length + 3} cases.`);
