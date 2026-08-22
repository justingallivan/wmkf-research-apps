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

// ---------------------------------------------------------------------------
// Memory-router early-warning Stop advisories
// (docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md §4, tests T1–T7)
// ---------------------------------------------------------------------------

const {
  advisedKeyDigest: mrAdvisedKeyDigest,
  clearAdvisedKeyBeforeBlock: mrClearKey,
  comparableAdvisedKey: mrComparableKey,
  routerAdvisory: mrRouterAdvisory,
} = require('./session-lifecycle');
const MR_THRESHOLDS = require('../../scripts/lib/memory-router-thresholds.js');
const ROUTER_REL = '.claude-memory/MEMORY.md';

function mrCrossingText(startBytes, currentBytes) {
  return `Memory router crossing: edits in this session carried .claude-memory/MEMORY.md from ${startBytes}B to ${currentBytes}B, over the ${MR_THRESHOLDS.NOTICE_BYTES}B routine-audit trigger. Run the router diet per docs/MEMORY_HYGIENE_RUNBOOK.md §10 now, or record the debt explicitly in SESSION_PROMPT.md.`;
}

// Fixture: a tmp repo root with a controllable router file, an optional
// gate-mapped touched path whose npm script is deterministic, and a seeded
// session-state file. Returns paths + helpers.
function mrFixture({ routerStart = null, routerNow = null, touchRouter = false, gate = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-mr-stop-'));
  write(path.join(root, 'CLAUDE.md'), '# Test instructions\n');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-memory'), { recursive: true });
  if (routerNow !== null) write(path.join(root, ROUTER_REL), 'x'.repeat(routerNow));
  const touched = [];
  if (touchRouter) touched.push(ROUTER_REL);
  // A touched router matches GATE_MAP's `.claude-memory/` rule, which selects
  // check:fact-consistency — so EVERY fixture defines both mapped scripts
  // deterministically (fact-consistency always green; api-routes per `gate`).
  write(path.join(root, 'gate.js'), `console.log('sentinel-gate-output');process.exit(${gate === 'fail' ? 1 : 0});\n`);
  write(path.join(root, 'package.json'), JSON.stringify({
    name: 'mr-fixture', version: '1.0.0',
    scripts: {
      'check:fact-consistency': 'node -e "process.exit(0)"',
      'check:api-routes': 'node gate.js',
    },
  }));
  if (gate) {
    // 'pages/api/**' maps to check:api-routes in GATE_MAP.
    touched.push('pages/api/test.js');
    write(path.join(root, 'pages/api/test.js'), '// fixture route\n');
  }
  const sessionId = `mr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stateFile = statePath({ session_id: sessionId }, root);
  const baselineInvariantFailures = checkAgentInvariants(root)
    .filter((item) => !item.ok)
    .map((item) => item.name);
  const seedState = (extra = {}) => write(stateFile, JSON.stringify({
    version: 3,
    root,
    baseline: {},
    baselineInvariantFailures,
    touched,
    touchLog: touched.map((p) => ({ path: p, at: new Date().toISOString() })),
    staleDocWarnings: [],
    adversarialReviewRequirements: {},
    adversarialReviewReceipts: {},
    gateCache: {},
    routerBytesAtStart: routerStart,
    ...extra,
  }));
  seedState();
  const runStop = (env = {}, hookFile = path.join(HOOK_DIR, 'session-lifecycle.js')) => spawnSync(
    process.execPath, [hookFile, 'stop'],
    {
      cwd: root,
      input: JSON.stringify({ cwd: root, session_id: sessionId }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_STOP_GATE_MODE: '', ...env },
    }
  );
  const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  return { root, stateFile, seedState, runStop, readState, sessionId };
}

// Replicates runGate()'s transform against an independent spawn, so the
// expected advisory text is exact without being circular.
function mrExpectedGateAdvisory(root) {
  const r = spawnSync('npm', ['run', 'check:api-routes'], { cwd: root, encoding: 'utf8', env: process.env });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
  return `Advisory changed-surface gate failure (blocking rollout is not enabled):\n\`check:api-routes\` failed:\n${output}`;
}

function mrParseSingleJson(stdout) {
  const trimmed = stdout.trim();
  const parsed = JSON.parse(trimmed); // throws on zero/partial/multiple objects
  return parsed;
}

// One combined-path execution for one hook file, returning both the exact
// expected contract (computed from the same fixture) and the actual result.
// The mutation subruns use ONE such execution per mutant: spawn health, the
// deviation oracle, and the contract-violation check all read the same
// result, so a second execution's infrastructure failure can never
// masquerade as contract rejection.
function mrCombinedRun(hookFile) {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true, gate: 'fail' });
  const expected = {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: `${mrExpectedGateAdvisory(fx.root)}\n\n${mrCrossingText(7000, 9000)}`,
    },
  };
  return { expected, result: fx.runStop({}, hookFile) };
}

// The full T1 contract for one hook file: exact object + exit status.
function mrAssertCombinedContract(hookFile) {
  const { expected, result } = mrCombinedRun(hookFile);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(mrParseSingleJson(result.stdout), expected);
}

test('T1: no-advisory paths produce status 0 and byte-empty stdout', () => {
  const none = mrFixture({ routerStart: 5000, routerNow: 5000, touchRouter: false });
  const r1 = none.runStop();
  assert.strictEqual(r1.status, 0, r1.stderr);
  assert.strictEqual(r1.stdout, '');
  const green = mrFixture({ routerStart: 5000, routerNow: 5000, touchRouter: false, gate: 'pass' });
  const r2 = green.runStop();
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.strictEqual(r2.stdout, '');
});

test('T1: gate-only failure emits exactly the complete expected object', () => {
  const fx = mrFixture({ routerStart: 5000, routerNow: 5000, touchRouter: false, gate: 'fail' });
  const expected = {
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: mrExpectedGateAdvisory(fx.root) },
  };
  const result = fx.runStop();
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(mrParseSingleJson(result.stdout), expected);
});

test('T1: router-only crossing emits exactly the complete expected object', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const expected = {
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: mrCrossingText(7000, 9000) },
  };
  const result = fx.runStop();
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(mrParseSingleJson(result.stdout), expected);
});

test('T1: combined gate + router path carries both producers in order', () => {
  mrAssertCombinedContract(path.join(HOOK_DIR, 'session-lifecycle.js'));
});

test('T1 mutations: each seeded defect produces its specific deviation and fails the contract by assertion', () => {
  const source = fs.readFileSync(path.join(HOOK_DIR, 'session-lifecycle.js'), 'utf8');
  // Each entry carries a deviation oracle proving the mutant hook actually ran
  // end-to-end and produced its INTENDED wrong output — an infrastructure
  // failure (spawn error, fixture error, malformed mutant) satisfies neither
  // the oracle nor the ERR_ASSERTION requirement below, so it can never be
  // mistaken for mutation detection.
  const mutations = [
    ['dropped gate summary',
      '(blocking rollout is not enabled):\\n${summary}`',
      '(blocking rollout is not enabled):`',
      (result) => {
        assert.strictEqual(result.status, 0, result.stderr);
        const context = mrParseSingleJson(result.stdout).hookSpecificOutput.additionalContext;
        assert.match(context, /blocking rollout is not enabled/, 'gate advisory header still present');
        assert.doesNotMatch(context, /sentinel-gate-output/, 'gate summary body is dropped');
      }],
    ['duplicated producer',
      'if (routerNote) stopAdvisories.push(routerNote);',
      'if (routerNote) { stopAdvisories.push(routerNote); stopAdvisories.push(routerNote); }',
      (result) => {
        assert.strictEqual(result.status, 0, result.stderr);
        const context = mrParseSingleJson(result.stdout).hookSpecificOutput.additionalContext;
        assert.strictEqual(context.split('Memory router crossing').length - 1, 2, 'router note appears exactly twice');
      }],
    ['wrong hookEventName',
      "additionalContext('Stop', stopAdvisories.join('\\n\\n'));",
      "additionalContext('PostToolUse', stopAdvisories.join('\\n\\n'));",
      (result) => {
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(mrParseSingleJson(result.stdout).hookSpecificOutput.hookEventName, 'PostToolUse');
      }],
    ['advisory mode exits 2',
      "additionalContext('Stop', stopAdvisories.join('\\n\\n'));",
      "additionalContext('Stop', stopAdvisories.join('\\n\\n'));\n  process.exit(2);",
      (result) => {
        assert.strictEqual(result.status, 2, 'mutant exits 2 on the advisory path');
        assert.ok(mrParseSingleJson(result.stdout), 'advisory JSON was emitted before the mutant exit');
      }],
  ];
  for (const [label, find, replace, expectDeviation] of mutations) {
    assert.ok(source.includes(find), `mutation seam present: ${label}`);
    const mutantPath = path.join(HOOK_DIR, `session-lifecycle.mutant-${Date.now()}-${Math.random().toString(16).slice(2)}.js`);
    fs.writeFileSync(mutantPath, source.replace(find, replace));
    try {
      // ONE execution per mutant — spawn health, deviation oracle, and the
      // contract-violation check all read this same result, so no separate
      // run's infrastructure failure can be mistaken for detection.
      const { expected, result } = mrCombinedRun(mutantPath);
      // 1. Spawn health: an infrastructure failure fails loudly here.
      assert.strictEqual(result.error, undefined, `mutant process spawned: ${label}`);
      // 2. Deviation oracle: the mutant produced its specific wrong output.
      expectDeviation(result);
      // 3. The same execution violates the exact T1 contract.
      let body = null;
      try { body = mrParseSingleJson(result.stdout); } catch { body = null; }
      assert.notDeepStrictEqual(
        { status: result.status, body },
        { status: 0, body: expected },
        `mutant output violates the exact contract: ${label}`
      );
    } finally {
      fs.rmSync(mutantPath, { force: true });
    }
  }
});

test('T2: router advisory tiers (crossing / growth-above / missing baseline / untouched)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-mr-tiers-'));
  fs.mkdirSync(path.join(root, '.claude-memory'), { recursive: true });
  write(path.join(root, ROUTER_REL), 'x'.repeat(9000));
  const owned = [ROUTER_REL];
  const crossing = mrRouterAdvisory(root, { routerBytesAtStart: 7000 }, owned);
  assert.match(crossing, /Memory router crossing/);
  write(path.join(root, ROUTER_REL), 'x'.repeat(9500));
  const growth = mrRouterAdvisory(root, { routerBytesAtStart: 9000 }, owned);
  assert.match(growth, /Memory router growth/);
  assert.doesNotMatch(growth, /crossing/);
  assert.strictEqual(mrRouterAdvisory(root, { routerBytesAtStart: null }, owned), null, 'missing baseline suppresses');
  assert.strictEqual(mrRouterAdvisory(root, {}, owned), null, 'absent baseline field suppresses');
  assert.strictEqual(mrRouterAdvisory(root, { routerBytesAtStart: 7000 }, []), null, 'untouched router suppresses');
  write(path.join(root, ROUTER_REL), 'x'.repeat(9000));
  assert.strictEqual(mrRouterAdvisory(root, { routerBytesAtStart: 9000 }, owned), null, 'already-over with no growth suppresses');
});

test('T3: dedup lifecycle — cross, silent repeat, shrink stores empty key, exact re-cross re-emits, legacy key never suppresses', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const r1 = fx.runStop();
  assert.strictEqual(r1.status, 0, r1.stderr);
  assert.match(mrParseSingleJson(r1.stdout).hookSpecificOutput.additionalContext, /Memory router crossing/);
  const keyAfterCross = fx.readState().lastAdvisedKey;
  assert.strictEqual(mrComparableKey(keyAfterCross) !== null, true, 'stored key is version-2 comparable');

  const r2 = fx.runStop();
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.strictEqual(r2.stdout, '', 'identical state repeat is silent');

  write(path.join(fx.root, ROUTER_REL), 'x'.repeat(5000)); // shrink below trigger
  const r3 = fx.runStop();
  assert.strictEqual(r3.status, 0, r3.stderr);
  assert.strictEqual(r3.stdout, '', 'shrink is silent');
  const keyAfterShrink = fx.readState().lastAdvisedKey;
  assert.notDeepStrictEqual(keyAfterShrink, keyAfterCross, 'shrink stores the empty-advisory key');

  write(path.join(fx.root, ROUTER_REL), 'x'.repeat(9000)); // byte-identical restore
  const r4 = fx.runStop();
  assert.strictEqual(r4.status, 0, r4.stderr);
  assert.match(mrParseSingleJson(r4.stdout).hookSpecificOutput.additionalContext, /Memory router crossing/);
  assert.deepStrictEqual(fx.readState().lastAdvisedKey, keyAfterCross, 'restored state reproduces the same key');

  // Inherited legacy/unversioned key encoding the byte-identical state must
  // never suppress the first v4 evaluation.
  fx.seedState({ lastAdvisedKey: keyAfterCross.key });
  const r5 = fx.runStop();
  assert.strictEqual(r5.status, 0, r5.stderr);
  assert.match(mrParseSingleJson(r5.stdout).hookSpecificOutput.additionalContext, /Memory router crossing/);
  assert.deepStrictEqual(fx.readState().lastAdvisedKey, keyAfterCross, 'legacy value replaced by { v: 2, key }');
});

test('T4: block-mode gate failure exits 2 with no advisory JSON and a cleared key; unblock re-emits', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true, gate: 'fail' });
  const r1 = fx.runStop(); // advisory mode: emits combined, stores key
  assert.strictEqual(r1.status, 0, r1.stderr);
  assert.ok(mrParseSingleJson(r1.stdout));

  const r2 = fx.runStop({ CLAUDE_STOP_GATE_MODE: 'block' });
  assert.strictEqual(r2.status, 2, `expected block exit, got ${r2.status}: ${r2.stderr}`);
  assert.match(r2.stderr, /Session-owned changed-surface gate failure/);
  assert.strictEqual(r2.stdout, '', 'blocking exit emits no advisory JSON');
  assert.strictEqual(fx.readState().lastAdvisedKey, undefined, 'blocking exit clears the stored key');

  // block → shrink → exact restore → unblock: the restored advisory re-emits.
  write(path.join(fx.root, ROUTER_REL), 'x'.repeat(5000));
  write(path.join(fx.root, ROUTER_REL), 'x'.repeat(9000));
  write(path.join(fx.root, 'gate.js'), "console.log('sentinel-gate-output');process.exit(0);\n"); // unblock
  const r3 = fx.runStop();
  assert.strictEqual(r3.status, 0, r3.stderr);
  assert.match(mrParseSingleJson(r3.stdout).hookSpecificOutput.additionalContext, /Memory router crossing/);
});

test('T4: blocking review-receipt path clears the key; a failed clear still exits 2', () => {
  // Blocking path with a healthy state file: key must be cleared.
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const rel = 'docs/audits/example.md';
  write(path.join(fx.root, rel), '# Verdict\nNEEDS WORK\n# Prioritized Findings\nRecommendation: change the order.\n');
  fx.seedState({
    lastAdvisedKey: { v: 2, key: 'seeded' },
    touched: [ROUTER_REL, rel],
    adversarialReviewRequirements: { [rel]: { fingerprint: fingerprint(fx.root, rel), requiredAt: new Date().toISOString() } },
  });
  const r1 = fx.runStop();
  assert.strictEqual(r1.status, 2, r1.stderr);
  assert.match(r1.stderr, /Adversarial review receipt/);
  assert.strictEqual(fx.readState().lastAdvisedKey, undefined, 'review-receipt block clears the key');

  // Failed clear (unit, via the exported helper): saveState throws because the
  // state path's parent is a FILE; the helper must swallow it — in stop() the
  // process.exit(2) then still fires. Integration variant: the invariant
  // blocking path runs before any other saveState; a read-only state file
  // cannot cancel it.
  const blockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-mr-clear-'));
  const parentAsFile = path.join(blockedDir, 'not-a-dir');
  write(parentAsFile, 'file');
  assert.doesNotThrow(() => mrClearKey(path.join(parentAsFile, 'state.json'), { lastAdvisedKey: { v: 2, key: 'x' } }));

  const fx2 = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  fx2.seedState({ baselineInvariantFailures: [], lastAdvisedKey: { v: 2, key: 'seeded' } }); // AGENTS.md invariant is newly-broken in a bare tmp root
  fs.chmodSync(fx2.stateFile, 0o444); // make every saveState (incl. the blocking clear) fail
  try {
    const r2 = fx2.runStop();
    assert.strictEqual(r2.status, 2, `invariant block must still exit 2 when the clear cannot persist: ${r2.stderr}`);
    assert.match(r2.stderr, /instruction invariant broken/);
    assert.strictEqual(r2.stdout, '', 'no advisory JSON on the blocking path');
  } finally {
    fs.chmodSync(fx2.stateFile, 0o644);
  }
});

test('T5: resume path preserves routerBytesAtStart', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const envFile = path.join(fx.root, 'claude-env');
  write(envFile, '');
  const result = spawnSync(
    process.execPath, [path.join(HOOK_DIR, 'session-lifecycle.js'), 'start'],
    {
      cwd: fx.root,
      input: JSON.stringify({ cwd: fx.root, session_id: fx.sessionId, hook_event_name: 'SessionStart' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_ENV_FILE: envFile },
    }
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(fx.readState().routerBytesAtStart, 7000, 'resume did not overwrite the baseline');
});

test('T6: unreadable thresholds module → hooks skip router advisories and never block', () => {
  // Mirror of the hooks dir with real lib/ + scripts/check-agent-invariants
  // but WITHOUT scripts/lib/memory-router-thresholds.js.
  const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-mr-nothresh-'));
  // Same two-level depth as the real .claude/hooks so `../../scripts/...`
  // resolves to mirror/scripts (which deliberately lacks the thresholds module).
  const mirrorHooks = path.join(mirror, '.claude', 'hooks');
  fs.mkdirSync(mirrorHooks, { recursive: true });
  fs.mkdirSync(path.join(mirror, 'scripts', 'lib'), { recursive: true });
  fs.symlinkSync(path.join(HOOK_DIR, 'lib'), path.join(mirrorHooks, 'lib'));
  fs.symlinkSync(
    path.resolve(HOOK_DIR, '../../scripts/check-agent-invariants.js'),
    path.join(mirror, 'scripts', 'check-agent-invariants.js')
  );
  for (const hookName of ['session-lifecycle.js', 'memory-router-guard.js']) {
    fs.copyFileSync(path.join(HOOK_DIR, hookName), path.join(mirrorHooks, hookName));
  }

  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const rStop = fx.runStop({}, path.join(mirrorHooks, 'session-lifecycle.js'));
  assert.strictEqual(rStop.status, 0, rStop.stderr);
  assert.strictEqual(rStop.stdout, '', 'router advisory skipped without thresholds');

  const bigWrite = {
    tool_name: 'Write',
    cwd: fx.root,
    tool_input: { file_path: path.join(fx.root, ROUTER_REL), content: 'x'.repeat(20000) },
  };
  const rGuard = spawnSync(process.execPath, [path.join(mirrorHooks, 'memory-router-guard.js')], {
    cwd: fx.root, input: JSON.stringify(bigWrite), encoding: 'utf8', env: process.env,
  });
  assert.strictEqual(rGuard.status, 0, 'guard fails open without thresholds');
});

test('T7: state-I/O failure in stop() never blocks and never emits partial JSON', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  fs.chmodSync(fx.stateFile, 0o444); // every saveState in stop() now fails
  try {
    const result = fx.runStop();
    assert.strictEqual(result.status, 0, `state-I/O failure must stay fail-open: ${result.stderr}`);
    const trimmed = result.stdout.trim();
    if (trimmed !== '') {
      const parsed = JSON.parse(trimmed); // exactly one well-formed object or nothing
      assert.strictEqual(typeof parsed.hookSpecificOutput.additionalContext, 'string');
    }
  } finally {
    fs.chmodSync(fx.stateFile, 0o644);
  }
});

// T8: deterministic save-failure injection per blocker. Regression tests for
// the pre-block uncaught saveState that let a state-I/O failure fall to
// main()'s fail-open catch and cancel the strict-doc / review-receipt /
// block-mode exits (Codex post-build review, 2026-08-21).
test('T8: a state-save failure cannot cancel the strict-doc blocker', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const docRel = 'docs/fixture-plan.md';
  const srcRel = 'scripts/fixture-src.js';
  write(path.join(fx.root, docRel), '# Plan\nReads scripts/fixture-src.js on every save.\n');
  fx.seedState({
    lastAdvisedKey: { v: 2, key: 'seeded' },
    staleDocWarnings: [{ docPath: docRel, changedPath: srcRel, term: srcRel, strict: true, createdAt: new Date().toISOString() }],
  });
  fs.chmodSync(fx.stateFile, 0o444);
  try {
    const result = fx.runStop();
    assert.strictEqual(result.status, 2, `strict-doc block must survive a save failure: ${result.stderr} :: ${result.stdout}`);
    assert.match(result.stderr, /doc staleness unresolved/);
    assert.strictEqual(result.stdout, '', 'no advisory JSON on the blocking path');
  } finally {
    fs.chmodSync(fx.stateFile, 0o644);
  }
});

test('T8: a state-save failure cannot cancel the review-receipt blocker', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  const rel = 'docs/audits/fixture-review.md';
  write(path.join(fx.root, rel), '# Verdict\nNEEDS WORK\n# Prioritized Findings\nRecommendation: change the order.\n');
  fx.seedState({
    lastAdvisedKey: { v: 2, key: 'seeded' },
    adversarialReviewRequirements: { [rel]: { fingerprint: 'stale', requiredAt: new Date().toISOString() } },
  });
  fs.chmodSync(fx.stateFile, 0o444);
  try {
    const result = fx.runStop();
    assert.strictEqual(result.status, 2, `review-receipt block must survive a save failure: ${result.stderr} :: ${result.stdout}`);
    assert.match(result.stderr, /Adversarial review receipt/);
    assert.strictEqual(result.stdout, '', 'no advisory JSON on the blocking path');
  } finally {
    fs.chmodSync(fx.stateFile, 0o644);
  }
});

test('T8: a state-save failure cannot cancel the block-mode gate blocker', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true, gate: 'fail' });
  fs.chmodSync(fx.stateFile, 0o444);
  try {
    const result = fx.runStop({ CLAUDE_STOP_GATE_MODE: 'block' });
    assert.strictEqual(result.status, 2, `block-mode gate must survive a save failure: ${result.stderr} :: ${result.stdout}`);
    assert.match(result.stderr, /Session-owned changed-surface gate failure/);
    assert.strictEqual(result.stdout, '', 'no advisory JSON on the blocking path');
  } finally {
    fs.chmodSync(fx.stateFile, 0o644);
  }
});

test('T8: an advisory-stage save failure stays fail-open with the documented safe message', () => {
  const fx = mrFixture({ routerStart: 7000, routerNow: 9000, touchRouter: true });
  fs.chmodSync(fx.stateFile, 0o444); // first (and only) save in this path is the advisory-stage key write
  try {
    const result = fx.runStop();
    assert.strictEqual(result.status, 0, `advisory path must stay fail-open: ${result.stderr}`);
    const parsed = mrParseSingleJson(result.stdout);
    assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'Stop');
    assert.match(parsed.hookSpecificOutput.additionalContext, /failed safely/);
  } finally {
    fs.chmodSync(fx.stateFile, 0o644);
  }
});

if (failures) {
  console.error(`\nhook-enforcement test FAILED — ${failures} case(s).`);
  process.exit(1);
}
console.log('\nhook-enforcement test OK');
