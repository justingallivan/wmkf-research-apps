'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  detectStaleDocWarnings,
  fingerprint,
  record,
  recordAdversarialReview,
  statePath,
  unresolvedAdversarialReviewRequirements,
  unresolvedStaleDocWarnings,
} = require('./session-lifecycle');
const { checkAgentInvariants } = require('../../scripts/check-agent-invariants');
const {
  findClaimEvidenceObligations,
} = require('./lib/claim-evidence');
const claimEvidenceFixtures = require('./fixtures/claim-evidence.json');
const {
  readObservationEvents,
} = require('./lib/claim-evidence-observations');

const HOOK_DIR = __dirname;
const TEST_OBSERVATION_STATE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'wmkf-claim-evidence-hook-test-state-')
);
process.on('exit', () => {
  try { fs.rmSync(TEST_OBSERVATION_STATE_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
});

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, text) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, text);
}

function runHook(script, input, env = {}) {
  return spawnSync(process.execPath, [path.join(HOOK_DIR, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      WMKF_CLAIM_EVIDENCE_STATE_ROOT: TEST_OBSERVATION_STATE_ROOT,
      ...env,
    },
  });
}

function runHookRaw(script, input) {
  return spawnSync(process.execPath, [path.join(HOOK_DIR, script)], {
    input,
    encoding: 'utf8',
  });
}

function configuredHookCommand(scriptName) {
  const root = path.resolve(HOOK_DIR, '../..');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  for (const entries of Object.values(settings.hooks || {})) {
    for (const entry of entries || []) {
      for (const hook of entry.hooks || []) {
        if (hook.command?.includes(scriptName)) return hook.command;
      }
    }
  }
  return null;
}

function runConfiguredHook(scriptName, input) {
  const root = path.resolve(HOOK_DIR, '../..');
  const command = configuredHookCommand(scriptName);
  assert.ok(command, `${scriptName} is not wired in .claude/settings.json`);
  return spawnSync('/bin/bash', ['-lc', command], {
    cwd: root,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      WMKF_CLAIM_EVIDENCE_STATE_ROOT: TEST_OBSERVATION_STATE_ROOT,
    },
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

test('review delegation guard rejects an incomplete adversarial receipt prompt', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'codex',
      prompt: [
        '[ADVERSARIAL-REVIEW-RECEIPT: docs/audits/example.md]',
        'Perform an adversarial review with file:line evidence.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /without the full review contract/);
});

test('review delegation guard accepts a complete adversarial receipt prompt', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'codex',
      prompt: [
        '[ADVERSARIAL-REVIEW-RECEIPT: docs/audits/example.md]',
        'Perform an adversarial review with file:line evidence.',
        'For each recommendation, name a disconfirming check.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /SELF-TRACE GATE/);
});

test('codex rescue guard blocks prompts without foreground handoff contract', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: 'Help finish the failing route-service boundary work.',
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /durable foreground handoff contract/);
  assert.match(result.stderr, /Do not add\/pass\/use `--background`/);
});

test('codex rescue guard blocks review-shaped prompts that should use review path', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: [
        'CODEX RESCUE HANDOFF: Run Codex in foreground for work Claude must consume in this turn.',
        'P0 adversarial plan review. End with exactly SATISFIED or REQUIRED CHANGES.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /review-shaped Codex delegation/);
  assert.match(result.stderr, /\/codex:adversarial-review --wait/);
});

test('codex rescue guard allows prompts with foreground handoff contract', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: [
        'CODEX RESCUE HANDOFF: Run Codex in foreground for work Claude must consume in this turn.',
        'Do not add/pass/use `--background` unless the human explicitly requested background mode.',
        'Help finish the failing route-service boundary work.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CODEX RESCUE HANDOFF - keep the Claude<->Codex link durable/);
  assert.match(result.stdout, /SELF-TRACE GATE/);
});

test('codex rescue guard allows intentionally marked rescue with review language', () => {
  const result = runHook('pre-review-delegation-trace-guard.js', {
    tool_name: 'Agent',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: [
        'CODEX RESCUE HANDOFF: Run Codex in foreground for work Claude must consume in this turn.',
        'Do not add/pass/use `--background` unless the human explicitly requested background mode.',
        '[INTENTIONAL-RESCUE: implementation help after a prior review; this is not asking Codex to review.]',
        'Help apply the required fixes from the review.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CODEX RESCUE HANDOFF/);
});

test('codex verbatim reminder preserves rescue background launch handoff', () => {
  const result = runHook('codex-verbatim-reminder.js', {
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'codex:codex-rescue',
      prompt: 'CODEX RESCUE HANDOFF: run background because the human explicitly requested it.',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /background launch notice/);
  assert.match(result.stdout, /\/codex:status <job-id>/);
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

test('scope claim reminder does not treat Markdown list ordinals as numeric coverage claims', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-scope-list-'));
  const result = runHook('scope-claim-reminder.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: [
        '# Test Plan',
        '| Route union | TBD at Stage 0 |',
        '1. Verify every route against the accepted baseline.',
        '2. Keep the route scope fail-closed.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
});

test('scope claim reminder still blocks a real count inside a Markdown list item', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-scope-list-count-'));
  const result = runHook('scope-claim-reminder.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: [
        '# Test Plan',
        '| Route union | TBD at Stage 0 |',
        '1. Verify all 147 routes against the accepted baseline.',
      ].join('\n'),
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /unresolved quantity uncertainty/);
});

test('design assertion guard blocks the Zhang-style reviewer-email ownership claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-assertion-guard-'));
  const result = runHook('design-doc-assertion-guard.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/REVIEWER_AUDIT.md'),
      content: '`zhang@mit.edu` is almost certainly a different Zhang or a role mailbox, not Feng Zhang\'s personal address.',
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /reviewer-email ownership\/identity claim/);
});

test('design assertion guard permits sourced, assumed, and enumerated-example forms', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-assertion-guard-'));
  const variants = [
    '`zhang@mit.edu` is Feng Zhang\'s published address (https://mcgovern.mit.edu/profile/feng-zhang/).',
    '`zhang@mit.edu` may be Feng Zhang\'s address [ASSUMED].',
    '`zhang@mit.edu` is almost certainly a different Zhang. <!-- assertion-exempt: quoted-example -->',
  ];
  for (const content of variants) {
    const result = runHook('design-doc-assertion-guard.js', {
      tool_name: 'Write',
      cwd: root,
      tool_input: { file_path: path.join(root, 'docs/REVIEWER_AUDIT.md'), content },
    });
    assert.strictEqual(result.status, 0, `${content}\n${result.stderr}`);
  }
});

test('design assertion guard fails open on malformed hook input', () => {
  const result = runHookRaw('design-doc-assertion-guard.js', '{not-json');
  assert.strictEqual(result.status, 0, result.stderr);
});

test('configured design assertion hook preserves the intentional blocking exit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-assertion-wiring-'));
  const result = runConfiguredHook('design-doc-assertion-guard.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/REVIEWER_AUDIT.md'),
      content: '`zhang@mit.edu` is almost certainly a different Zhang or a role mailbox.',
    },
  });
  assert.strictEqual(result.status, 2, result.stderr);
});

test('claim-evidence fixture corpus preserves query-shape and advisory boundaries', () => {
  for (const fixture of claimEvidenceFixtures) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-'));
    const transcript = path.join(root, 'transcript.jsonl');
    write(transcript, fixture.transcript.join('\n'));
    const claims = findClaimEvidenceObligations(fixture.documentText);
    const shapes = [...new Set(claims.flatMap((claim) => claim.shapes))];
    assert.deepStrictEqual(shapes, fixture.expectedShapes, `${fixture.id}: detected shapes`);

    const result = runHook('claim-evidence-advisory.js', {
      tool_name: 'Write',
      cwd: root,
      transcript_path: transcript,
      tool_input: {
        file_path: path.join(root, 'docs/TEST_PLAN.md'),
        content: fixture.documentText,
      },
    });
    assert.strictEqual(result.status, 0, `${fixture.id}: ${result.stderr}`);
    assert.strictEqual(result.stderr, '', `${fixture.id}: unexpected fail-open/error output`);
    const advised = /CLAIM-EVIDENCE ADVISORY/.test(result.stdout);
    assert.strictEqual(advised, fixture.expectedAdvisory, `${fixture.id}: ${result.stdout}`);
    for (const required of fixture.requiredAdvisoryTerms || []) {
      assert.strictEqual(result.stdout.includes(required), true, `${fixture.id}: missing advisory term ${required}`);
    }
    for (const forbidden of fixture.forbiddenAdvisoryTerms || []) {
      assert.strictEqual(result.stdout.toLowerCase().includes(forbidden), false, `${fixture.id}: forbidden advisory term ${forbidden}`);
    }
  }
});

test('claim-evidence advisory judges only newly introduced edit text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-delta-'));
  const doc = path.join(root, 'docs/TEST_PLAN.md');
  write(doc, '# Test Plan\n\n[VERIFIED] All API routes use an authentication guard.\n\nOld ending.\n');
  const result = runHook('claim-evidence-advisory.js', {
    tool_name: 'Edit',
    cwd: root,
    tool_input: {
      file_path: doc,
      old_string: 'Old ending.',
      new_string: 'New ending without a claim.',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
});

test('claim-evidence advisory examines the touched line when an edit adds only a qualifier', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-qualifier-'));
  const doc = path.join(root, 'docs/TEST_PLAN.md');
  write(doc, '# Test Plan\n\n[VERIFIED] Some API routes use an authentication guard.\n');
  const result = runHook('claim-evidence-advisory.js', {
    tool_name: 'Edit',
    cwd: root,
    tool_input: {
      file_path: doc,
      old_string: 'Some API routes',
      new_string: 'All API routes',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
});

test('claim-evidence advisory examines the touched line when an edit promotes assumed to verified', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-promote-'));
  const doc = path.join(root, 'docs/TEST_PLAN.md');
  write(doc, '# Test Plan\n\n[ASSUMED] All API routes use an authentication guard.\n');
  const result = runHook('claim-evidence-advisory.js', {
    tool_name: 'Edit',
    cwd: root,
    tool_input: {
      file_path: doc,
      old_string: '[ASSUMED]',
      new_string: '[VERIFIED]',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
});

test('claim-evidence advisory records a metadata-only observation when it fires', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-observed-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-observed-state-'));
  const result = runHook('claim-evidence-advisory.js', {
    session_id: 'integration-session',
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '[VERIFIED] All API routes use an authentication guard.',
    },
  }, { WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
  const observed = readObservationEvents(root, { stateRoot });
  assert.strictEqual(observed.invalidFiles, 0);
  assert.strictEqual(observed.events.length, 1);
  assert.deepStrictEqual(observed.events[0].shapeCounts, {
    'call-path': 0,
    universal: 1,
    count: 0,
  });
  assert.strictEqual(observed.events[0].documentPath, 'docs/TEST_PLAN.md');
});

test('claim-evidence advisory records nothing when no advisory fires', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-unobserved-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-unobserved-state-'));
  const result = runHook('claim-evidence-advisory.js', {
    session_id: 'integration-session',
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: 'All API routes must use an authentication guard.',
    },
  }, { WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
  const observed = readObservationEvents(root, { stateRoot });
  assert.strictEqual(observed.events.length, 0);
  assert.strictEqual(observed.sessions.length, 1);
});

test('claim-evidence advisory stays non-blocking when observation storage fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-observation-fail-'));
  const stateRoot = path.join(root, 'not-a-directory');
  write(stateRoot, 'x');
  const result = runHook('claim-evidence-advisory.js', {
    session_id: 'integration-session',
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '[VERIFIED] All API routes use an authentication guard.',
    },
  }, { WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
  assert.match(result.stdout, /Observation logging is unavailable/);
});

test('claim-evidence monitoring failure is visible even when no advisory fires', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-marker-fail-'));
  const stateRoot = path.join(root, 'not-a-directory');
  write(stateRoot, 'x');
  const result = runHook('claim-evidence-advisory.js', {
    session_id: 'integration-session',
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: 'All API routes must use an authentication guard.',
    },
  }, { WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
  assert.match(result.stdout, /monitoring is unavailable/);
});

test('session lifecycle exports the current observation key without persisting an all-session marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-session-start-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-session-state-'));
  const envFile = path.join(root, 'claude-env');
  write(envFile, '');
  const input = {
    session_id: 'current-session-marker',
    hook_event_name: 'SessionStart',
    cwd: root,
  };
  const result = spawnSync(
    process.execPath,
    [path.join(HOOK_DIR, 'session-lifecycle.js'), 'start'],
    {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_ENV_FILE: envFile,
        WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot,
      },
    },
  );
  assert.strictEqual(result.status, 0, result.stderr);
  const observed = readObservationEvents(root, { stateRoot });
  assert.strictEqual(observed.invalidFiles, 0);
  assert.strictEqual(observed.sessions.length, 0);
  assert.match(fs.readFileSync(envFile, 'utf8'), /WMKF_CLAIM_EVIDENCE_SESSION_KEY=[0-9a-f]{16}/);
  assert.strictEqual(fs.readFileSync(envFile, 'utf8').includes(input.session_id), false);
});

test('session lifecycle visibly reports when current-session export is unavailable', () => {
  const root = path.resolve(HOOK_DIR, '../..');
  const input = {
    session_id: `current-session-export-fail-${process.pid}`,
    hook_event_name: 'SessionStart',
    cwd: root,
  };
  const result = spawnSync(
    process.execPath,
    [path.join(HOOK_DIR, 'session-lifecycle.js'), 'start'],
    {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_ENV_FILE: '' },
    },
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /current-session reporting is unavailable/);
  try { fs.rmSync(statePath(input, root), { force: true }); } catch { /* best effort */ }
});

test('claim-evidence advisory fails open and reports malformed hook input', () => {
  const result = runHookRaw('claim-evidence-advisory.js', '{not-json');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /internal hook error \(fail-open\)/);
});

test('configured claim-evidence hook remains advisory-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-evidence-wiring-'));
  const result = runConfiguredHook('claim-evidence-advisory.js', {
    tool_name: 'Write',
    cwd: root,
    tool_input: {
      file_path: path.join(root, 'docs/TEST_PLAN.md'),
      content: '[VERIFIED] All API routes use an authentication guard.',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /CLAIM-EVIDENCE ADVISORY/);
});

test('adversarial review receipt is fingerprint-bound and becomes stale after an edit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-review-receipt-'));
  const rel = 'docs/audits/example.md';
  const full = path.join(root, rel);
  const stateFile = path.join(root, 'state.json');
  const reviewText = [
    '# Verdict',
    'NEEDS WORK',
    '# Prioritized Findings',
    'Recommendation: change the execution order.',
  ].join('\n');
  write(full, reviewText);
  write(stateFile, JSON.stringify({
    version: 3,
    baseline: {},
    baselineInvariantFailures: [],
    touched: [],
    touchLog: [],
    staleDocWarnings: [],
    adversarialReviewRequirements: {},
    adversarialReviewReceipts: {},
    gateCache: {},
  }));

  record({ tool_input: { file_path: full } }, root, stateFile);
  let state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(unresolvedAdversarialReviewRequirements(root, state).length, 1);

  recordAdversarialReview({
    tool_input: {
      prompt: [
        `[ADVERSARIAL-REVIEW-RECEIPT: ${rel}]`,
        'Run an adversarial refutation.',
        'For each recommendation, provide file:line evidence and a disconfirming check.',
      ].join('\n'),
    },
  }, root, stateFile);
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(unresolvedAdversarialReviewRequirements(root, state).length, 0);

  write(full, `${reviewText}\nCorrection: updated after review.\n`);
  record({ tool_input: { file_path: full } }, root, stateFile);
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(unresolvedAdversarialReviewRequirements(root, state).length, 1);

  write(full, `${reviewText}\n<!-- adversarial-review:waived reason=owner accepted residual -->\n`);
  assert.strictEqual(unresolvedAdversarialReviewRequirements(root, state).length, 0);
});

test('session Stop blocks a consequential review with no current receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-review-stop-'));
  write(path.join(root, 'CLAUDE.md'), '# Test instructions\n');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-memory'), { recursive: true });
  const rel = 'docs/audits/example.md';
  write(path.join(root, rel), [
    '# Verdict',
    'NEEDS WORK',
    '# Prioritized Findings',
    'Recommendation: change the execution order.',
  ].join('\n'));
  const sessionId = `test-${Date.now()}`;
  const file = statePath({ session_id: sessionId }, root);
  const baselineInvariantFailures = checkAgentInvariants(root)
    .filter((item) => !item.ok)
    .map((item) => item.name);
  write(file, JSON.stringify({
    version: 3,
    root,
    baseline: {},
    baselineInvariantFailures,
    touched: [rel],
    touchLog: [{ path: rel, at: new Date().toISOString() }],
    staleDocWarnings: [],
    adversarialReviewRequirements: {
      [rel]: { fingerprint: fingerprint(root, rel), requiredAt: new Date().toISOString() },
    },
    adversarialReviewReceipts: {},
    gateCache: {},
  }));
  const result = spawnSync(process.execPath, [path.join(HOOK_DIR, 'session-lifecycle.js'), 'stop'], {
    cwd: root,
    input: JSON.stringify({ cwd: root, session_id: sessionId }),
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /Adversarial review receipt missing or stale/);
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
