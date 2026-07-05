#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { registerTmpFixture } = require('./lib/selftest-fixture');

const repoRoot = path.resolve(__dirname, '..');
let failures = 0;

function assert(name, condition) {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function run(root) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-agent-wiki.js'), '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function fixtureRoot() {
  const { dir: root } = registerTmpFixture('wmkf-agent-wiki-self-test-');
  writeFile(root, 'CLAUDE.md', '# Fixture\n');
  writeFile(root, 'docs/CLAUDE_INSTRUCTION_AUTHORITY.md', '# Authority\n');
  writeFile(root, 'lib/services/contact-enrichment-service.js', '// fixture\n');
  writeFile(root, 'pages/api/reviewer-finder/save-candidates.js', '// fixture\n');
  return root;
}

function writeValidWiki(root, overrides = {}) {
  const today = '2026-06-07';
  writeFile(root, 'docs/agent-wiki/index.md', `---
agent_wiki: index
status: active
last_verified: ${today}
stale_after_days: 365
source_files:
  - CLAUDE.md
canonical_docs:
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
---

# Agent Wiki

| Trigger | Read first |
|---|---|
| reviewer identity | [reviewer identity](topics/reviewer-identity.md) |
`);
  writeFile(root, 'docs/agent-wiki/log.md', `---
agent_wiki: log
status: active
last_verified: ${today}
stale_after_days: 365
source_files:
  - CLAUDE.md
canonical_docs:
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
---

# Agent Wiki Log
`);
  writeFile(root, 'docs/agent-wiki/topics/reviewer-identity.md', `---
agent_wiki: topic
status: active
last_verified: ${overrides.lastVerified || today}
stale_after_days: ${overrides.staleAfter || 365}
owner: agent-operations
source_files:
  - lib/services/contact-enrichment-service.js
  - pages/api/reviewer-finder/save-candidates.js
canonical_docs:
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
watch_paths:
  - lib/services/contact-enrichment-service.js
  - pages/api/reviewer-finder/**
update_triggers:
  - reviewer identity persistence changes
---

# Reviewer Identity
`);
}

const okRoot = fixtureRoot();
writeValidWiki(okRoot);
assert('valid fixture passes', run(okRoot).status === 0);

const missingTopicRoot = fixtureRoot();
writeValidWiki(missingTopicRoot);
fs.unlinkSync(path.join(missingTopicRoot, 'docs/agent-wiki/topics/reviewer-identity.md'));
assert('missing required topic fails', run(missingTopicRoot).status === 1);

const staleRoot = fixtureRoot();
writeValidWiki(staleRoot, { lastVerified: '2024-01-01', staleAfter: 1 });
assert('stale active topic fails', run(staleRoot).status === 1);

const badPathRoot = fixtureRoot();
writeValidWiki(badPathRoot);
let text = fs.readFileSync(path.join(badPathRoot, 'docs/agent-wiki/topics/reviewer-identity.md'), 'utf8');
text = text.replace('lib/services/contact-enrichment-service.js', 'lib/services/does-not-exist.js');
fs.writeFileSync(path.join(badPathRoot, 'docs/agent-wiki/topics/reviewer-identity.md'), text);
assert('missing source file fails', run(badPathRoot).status === 1);

if (failures) {
  console.error(`agent-wiki self-test failed: ${failures} fixture(s)`);
  process.exit(1);
}
console.log('agent-wiki self-test passed.');
