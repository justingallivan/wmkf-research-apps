#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { gatesForPaths, changedOwnedPaths, dirtyPaths } = require('../.claude/hooks/session-lifecycle');
const { checkAgentInvariants } = require('./check-agent-invariants');
const { assertFreshDatabase } = require('./lib/database-bootstrap-guard');

let failures = 0;
function assert(name, condition) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

assert('API route maps to the API gate without unrelated prompt gate', (() => {
  const gates = gatesForPaths(['pages/api/example.js']);
  return gates.includes('check:api-routes') && !gates.includes('check:prompt-injection-tagging');
})());
assert('unrelated UI file maps to no scoped gate', gatesForPaths(['pages/example.js']).length === 0);
assert('migration maps to Atlas and manifest gates', (() => {
  const gates = gatesForPaths(['lib/db/migrations/999_fixture.sql']);
  return gates.includes('check:atlas') && gates.includes('check:migrations-manifest');
})());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-instruction-arch-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: tmp });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: tmp });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'preexisting.txt'), 'before\n');
  fs.writeFileSync(path.join(tmp, 'owned.txt'), 'before\n');
  execFileSync('git', ['add', '.'], { cwd: tmp });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'preexisting.txt'), 'dirty before session\n');
  const baseline = { 'preexisting.txt': `file:${require('crypto').createHash('sha256').update('dirty before session\n').digest('hex')}` };
  fs.writeFileSync(path.join(tmp, 'owned.txt'), 'changed by session\n');
  const owned = changedOwnedPaths(tmp, { baseline, touched: ['owned.txt'] });
  assert('pre-existing untouched dirty file is not session-owned', !owned.includes('preexisting.txt'));
  assert('file touched and changed by session is session-owned', owned.includes('owned.txt'));
  fs.renameSync(path.join(tmp, 'owned.txt'), path.join(tmp, 'renamed.txt'));
  const renamedDirty = dirtyPaths(tmp);
  assert('rename status parsing keeps both affected paths', renamedDirty.includes('owned.txt') && renamedDirty.includes('renamed.txt'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const repoRoot = path.resolve(__dirname, '..');
assert('tracked AGENTS.md invariant is valid', checkAgentInvariants(repoRoot, { trackedOnly: true }).every((item) => item.ok));

const rootInstructions = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
assert('root CLAUDE.md stays below 200 lines', rootInstructions.split(/\r?\n/).length < 200);
assert('root CLAUDE.md no longer contains mutable app/table catalogues', !/^## (Applications|Database Schema|Environment Variables)$/m.test(rootInstructions));

const requiredRules = [
  'durable-docs.md',
  'api-routes.md',
  'database.md',
  'llm-and-prompts.md',
  'external-reviewers.md',
  'bill.md',
  'intake-uploads.md',
  'dataverse-dynamics.md',
  'auth-policy.md',
  'agent-wiki.md',
];
assert(
  'required path-scoped rules exist',
  requiredRules.every((name) => fs.existsSync(path.join(repoRoot, '.claude', 'rules', name))),
);

const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'settings.json'), 'utf8'));
assert('SessionStart lifecycle hook is wired', Array.isArray(settings.hooks.SessionStart));
assert('Stop lifecycle hook is wired', Array.isArray(settings.hooks.Stop));
assert(
  'protected path PreToolUse hook is wired',
  settings.hooks.PreToolUse.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('protected-path-guard.js'))),
);
assert(
  'agent-wiki freshness hook is wired',
  settings.hooks.PreToolUse.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('agent-wiki-reminder.js'))),
);
assert(
  'docs-catalog format hook is wired',
  settings.hooks.PreToolUse.some((entry) =>
    entry.hooks.some((hook) => hook.command.includes('docs-catalog-format-guard.js'))),
);
const designAssertionHook = settings.hooks.PreToolUse
  .flatMap((entry) => entry.hooks || [])
  .find((hook) => hook.command.includes('design-doc-assertion-guard.js'));
assert(
  'design-doc assertion blocker is wired without an exit-swallow wrapper',
  !!designAssertionHook &&
    !designAssertionHook.command.includes('|| true') &&
    !designAssertionHook.command.includes('2>/dev/null'),
);
assert(
  'PostToolUse adversarial review receipt recorder is wired',
  settings.hooks.PostToolUse.some((entry) =>
    entry.matcher === 'Task|Agent' &&
    entry.hooks.some((hook) => hook.command.includes('session-lifecycle.js') && hook.command.includes('review-record'))) &&
    !settings.hooks.PreToolUse.some((entry) =>
      entry.hooks.some((hook) => hook.command.includes('session-lifecycle.js') && hook.command.includes('review-record'))),
);
assert(
  'docs-catalog commit guard is wired',
  settings.hooks.PreToolUse.some((entry) =>
    entry.matcher === 'Bash' &&
    entry.hooks.some((hook) => hook.command.includes('docs-catalog-commit-guard.js'))),
);
assert('agent-wiki gate script exists', fs.existsSync(path.join(repoRoot, 'scripts', 'check-agent-wiki.js')));

const guardResult = require('child_process').spawnSync(
  process.execPath,
  [path.join(repoRoot, '.claude', 'hooks', 'protected-path-guard.js')],
  {
    cwd: repoRoot,
    input: JSON.stringify({
      cwd: repoRoot,
      tool_name: 'Write',
      tool_input: { file_path: path.join(repoRoot, 'AGENTS.md') },
    }),
    encoding: 'utf8',
  },
);
assert('protected-path guard blocks direct AGENTS.md writes', guardResult.status === 2);

const setupSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'setup-database.js'), 'utf8');
assert(
  'setup database source declares and enforces fresh-install-only contract',
  setupSource.includes('FRESH DATABASES ONLY') &&
    setupSource.includes('assertFreshDatabase'),
);
assert('fresh empty database passes bootstrap guard', (() => {
  try { assertFreshDatabase([]); return true; } catch { return false; }
})());
assert('populated database is refused by bootstrap guard', (() => {
  try { assertFreshDatabase(['user_profiles']); return false; } catch (error) {
    return /Refusing fresh-install setup/.test(error.message);
  }
})());
assert('deliberate populated bootstrap override passes guard', (() => {
  try { assertFreshDatabase(['user_profiles'], true); return true; } catch { return false; }
})());

if (failures) {
  console.error(`Instruction architecture check failed: ${failures} fixture(s)`);
  process.exit(1);
}
console.log('Instruction architecture checks passed.');
