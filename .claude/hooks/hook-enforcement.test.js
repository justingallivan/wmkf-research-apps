'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  detectStaleDocWarnings,
  unresolvedStaleDocWarnings,
} = require('./session-lifecycle');

const HOOK_DIR = __dirname;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, text) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, text);
}

function runHook(script, input) {
  return spawnSync(process.execPath, [path.join(HOOK_DIR, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

test('plan source-read guard blocks unread live pages/lib paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-plan-read-'));
  write(path.join(root, 'pages/api/foo.js'), 'module.exports = {};\n');
  const transcript = path.join(root, 'transcript.jsonl');
  write(transcript, '');

  const result = runHook('plan-named-source-read-guard.js', {
    tool_name: 'Write',
    cwd: root,
    transcript_path: transcript,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '# Test Plan\n\nThis touches pages/api/foo.js.\n',
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /pages\/api\/foo\.js/);
});

test('plan source-read guard allows transcript read evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-plan-read-'));
  write(path.join(root, 'pages/api/foo.js'), 'module.exports = {};\n');
  const transcript = path.join(root, 'transcript.jsonl');
  write(transcript, JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: path.join(root, 'pages/api/foo.js') },
  }));

  const result = runHook('plan-named-source-read-guard.js', {
    tool_name: 'Write',
    cwd: root,
    transcript_path: transcript,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '# Test Plan\n\nThis touches pages/api/foo.js.\n',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('plan source-read guard allows visible NOT-READ escape', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-plan-read-'));
  write(path.join(root, 'lib/services/future.js'), 'module.exports = {};\n');
  const transcript = path.join(root, 'transcript.jsonl');
  write(transcript, '');

  const result = runHook('plan-named-source-read-guard.js', {
    tool_name: 'Write',
    cwd: root,
    transcript_path: transcript,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '# Test Plan\n\nlib/services/future.js [NOT-READ: lib/services/future.js — intentionally future work]\n',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('review delegation guard blocks untraced repo-local discovery asks', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'codex',
      prompt: 'P0 adversarial review. Check whether any routes stream.',
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /outsources repo-local discovery/);
});

test('review delegation guard allows adjacent trace evidence', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'codex',
      prompt: [
        'P0 adversarial review.',
        'TRACED:',
        '- pages/api/foo.js:12 checked stream handling; none found.',
        'Check whether any routes stream.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /SELF-TRACE GATE/);
});

test('scope claim reminder blocks plan assumption leakage into derived counts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-scope-leak-'));
  const result = runHook('scope-claim-reminder.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: [
        '# Test Plan',
        '| Subject | Count |',
        '| Route union | TBD at Stage 0 |',
        '| Wave arithmetic | 10 + 6 + 16 + 17 = 49 routes |',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /unresolved quantity uncertainty/);
});

test('scope claim reminder allows visibly derived plan counts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-scope-leak-'));
  const result = runHook('scope-claim-reminder.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: [
        '# Test Plan',
        '| Subject | Count |',
        '| Route union | TBD at Stage 0 |',
        '| Wave arithmetic | [DERIVED-FROM: scripts/probe.js:12; independent of TBD count] 49 routes |',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('session lifecycle detects unresolved strict same-session doc staleness', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-stale-doc-'));
  write(path.join(root, 'docs/TEST_PLAN.md'), [
    '---',
    'kind: plan',
    '---',
    'Gate design depends on scripts/check-example.js.',
  ].join('\n'));
  write(path.join(root, 'scripts/check-example.js'), 'console.log("changed");\n');

  const state = { touchLog: [{ path: 'docs/TEST_PLAN.md', at: '2026-07-04T00:00:00.000Z' }], staleDocWarnings: [] };
  const warnings = detectStaleDocWarnings(root, state, 'scripts/check-example.js');
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].strict, true);

  state.staleDocWarnings = warnings;
  assert.strictEqual(unresolvedStaleDocWarnings(root, state).length, 1);

  write(path.join(root, 'docs/TEST_PLAN.md'), [
    '---',
    'kind: plan',
    '---',
    'Gate design depends on scripts/check-example.js. [RECHECKED after scripts/check-example.js change: scripts/check-example.js:1]',
  ].join('\n'));
  assert.strictEqual(unresolvedStaleDocWarnings(root, state).length, 0);
});

if (failures) {
  console.error(`\nhook-enforcement test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('\nhook-enforcement test OK');
