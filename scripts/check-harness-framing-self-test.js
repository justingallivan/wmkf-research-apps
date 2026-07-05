#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { registerTmpFixture } = require('./lib/selftest-fixture');

const checker = path.resolve(__dirname, 'check-harness-framing.js');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function run(root) {
  return spawnSync(process.execPath, [checker, '--root', root], {
    encoding: 'utf8',
  });
}

let failures = 0;

function expect(name, condition, details = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${details ? ` — ${details}` : ''}`);
  }
}

const { dir: cleanRoot } = registerTmpFixture('harness-framing-clean-');
write(path.join(cleanRoot, '.claude/hooks/example.js'), `
const msg = 'Before committing, complete the staged-surface self-review with file evidence.';
`);
write(path.join(cleanRoot, '.claude/skills/example/SKILL.md'), `
# Example

Trace lifecycle and provenance before delegating review.
`);
write(path.join(cleanRoot, '.claude/skills/example/RATIONALE.md'), `
Historical note: Codex kept catching this before the procedure existed.
`);
write(path.join(cleanRoot, 'docs/agent-wiki/topics/example.md'), `
# Example

Use this page to route recurring work to source files and verification commands.
`);
let result = run(cleanRoot);
expect('clean active files pass and rationale sidecar is ignored', result.status === 0, result.stderr);

const { dir: badSkillRoot } = registerTmpFixture('harness-framing-bad-skill-');
write(path.join(badSkillRoot, '.claude/skills/example/SKILL.md'), `
# Example

This exists because my recurring failures are not knowledge gaps.
`);
result = run(badSkillRoot);
expect('self-focused skill framing fails', result.status === 1 && /my recurring failures/.test(result.stderr), result.stderr);

const { dir: badHookRoot } = registerTmpFixture('harness-framing-bad-hook-');
write(path.join(badHookRoot, '.claude/hooks/example.js'), `
// Maintainer comment: Codex kept catching this before the procedure existed.
const msg = 'Codex kept catching this for you, so do the check.';
`);
result = run(badHookRoot);
expect('emitted hook failure framing fails but comment alone would not', result.status === 1 && /Codex kept catching/.test(result.stderr), result.stderr);

const { dir: badWikiTopicRoot } = registerTmpFixture('harness-framing-bad-wiki-topic-');
write(path.join(badWikiTopicRoot, 'docs/agent-wiki/topics/example.md'), `
# Example

Use this because I keep missing the surrounding lifecycle.
`);
result = run(badWikiTopicRoot);
expect('self-focused wiki topic framing fails', result.status === 1 && /I keep missing/.test(result.stderr), result.stderr);

const { dir: backupRoot } = registerTmpFixture('harness-framing-backup-');
write(path.join(backupRoot, '.harness-backups/old/.claude/skills/example/SKILL.md'), `
This exists because my recurring failures are not knowledge gaps.
`);
result = run(backupRoot);
expect('backup archive is ignored', result.status === 0, result.stderr);

if (failures) {
  console.error(`\nharness-framing self-test FAILED — ${failures} case(s).`);
  process.exit(1);
}

console.log('\nharness-framing self-test OK — active/rationale/backup fixtures behaved as expected.');
