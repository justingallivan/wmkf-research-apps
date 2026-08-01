'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  buildObservationEvent,
  isObservationEvent,
  observationDirectory,
  readObservationEvents,
  recordAdvisoryObservation,
  recordObservationSession,
  sessionKey,
  summarizeObservationEvents,
} = require('./claim-evidence-observations');

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.stack || error.message}`);
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-root-'));
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-state-'));
  return { root, stateRoot };
}

function recordArgs(root, stateRoot, overrides = {}) {
  return {
    root,
    stateRoot,
    input: {
      session_id: 'session-sensitive-value',
      transcript_path: '/secret/transcript.jsonl',
      tool_name: 'Write',
      tool_input: { content: 'raw content must not persist' },
    },
    relativePath: 'docs/TEST_PLAN.md',
    missingClaims: [{
      sentence: '[VERIFIED] All routes contain TOP_SECRET_VALUE.',
      shapes: ['universal', 'count'],
      symbols: ['TOP_SECRET_VALUE'],
      evidenceTerms: ['secret@example.org'],
    }],
    ...overrides,
  };
}

function spawnRecorder(modulePath, root, stateRoot, index) {
  const source = [
    "const m = require(process.argv[1]);",
    "m.recordAdvisoryObservation({",
    "  root: process.argv[2],",
    "  stateRoot: process.argv[3],",
    "  input: { session_id: 'concurrent-session', tool_name: 'Write' },",
    "  relativePath: `docs/CONCURRENT_${process.argv[4]}.md`,",
    "  missingClaims: [{ shapes: ['count'] }],",
    "});",
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source, modulePath, root, stateRoot, String(index)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
  });
}

(async () => {
  await test('observation schema is an exact metadata allowlist', () => {
    const event = buildObservationEvent(recordArgs('/repo', []));
    assert.strictEqual(isObservationEvent(event), true);
    assert.strictEqual(isObservationEvent({ ...event, sentence: 'must not persist' }), false);
    assert.strictEqual(isObservationEvent({ ...event, eventId: '----------------' }), false);
    assert.strictEqual(isObservationEvent({
      ...event,
      shapeCounts: { ...event.shapeCounts, universal: event.claimCount + 1 },
    }), false);
    assert.strictEqual(isObservationEvent({
      ...event,
      occurredAt: '2026-07-31T00:00:00Z',
    }), false);
    assert.deepStrictEqual(Object.keys(event).sort(), [
      'claimCount', 'documentPath', 'eventId', 'occurredAt', 'schemaVersion',
      'sessionKey', 'shapeCounts', 'toolName',
    ]);
  });

  await test('stored event excludes claim, transcript, command, and arbitrary input content', () => {
    const { root, stateRoot } = fixture();
    const { file } = recordAdvisoryObservation(recordArgs(root, stateRoot));
    const raw = fs.readFileSync(file, 'utf8');
    for (const forbidden of [
      'TOP_SECRET_VALUE', 'secret@example.org', 'session-sensitive-value',
      '/secret/transcript.jsonl', 'raw content must not persist', '[VERIFIED]',
    ]) assert.strictEqual(raw.includes(forbidden), false, forbidden);
    assert.match(raw, /docs\/TEST_PLAN\.md/);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  });

  await test('readers cannot observe a partially written event', () => {
    const { root, stateRoot } = fixture();
    let readDuringWrite = null;
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      onPartialWrite: () => {
        readDuringWrite = readObservationEvents(root, { stateRoot });
      },
    }));
    assert.strictEqual(readDuringWrite.events.length, 0);
    assert.strictEqual(readDuringWrite.invalidFiles, 0);
    const afterPublish = readObservationEvents(root, { stateRoot });
    assert.strictEqual(afterPublish.events.length, 1);
    assert.strictEqual(afterPublish.invalidFiles, 0);
  });

  await test('atomic publisher retries legal short writes until the record is complete', () => {
    const { root, stateRoot } = fixture();
    const shortWrite = (fd, buffer, offset, length, position) =>
      fs.writeSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2)), position);
    recordAdvisoryObservation(recordArgs(root, stateRoot, { writeSync: shortWrite }));
    const result = readObservationEvents(root, { stateRoot });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.invalidFiles, 0);
  });

  await test('event-per-file writes remain complete under concurrent hook processes', async () => {
    const { root, stateRoot } = fixture();
    const modulePath = path.resolve(__dirname, 'claim-evidence-observations.js');
    await Promise.all(Array.from({ length: 24 }, (_, index) =>
      spawnRecorder(modulePath, root, stateRoot, index)
    ));
    const result = readObservationEvents(root, { stateRoot });
    assert.strictEqual(result.invalidFiles, 0);
    assert.strictEqual(result.events.length, 24);
    assert.strictEqual(new Set(result.events.map((event) => event.eventId)).size, 24);
  });

  await test('retention keeps the newest configured event count', () => {
    const { root, stateRoot } = fixture();
    for (let index = 0; index < 5; index += 1) {
      recordAdvisoryObservation(recordArgs(root, stateRoot, {
        now: new Date(Date.UTC(2026, 6, 1, 0, 0, index)),
        eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        maxEvents: 3,
        maxAgeMs: Number.MAX_SAFE_INTEGER,
      }));
    }
    const result = readObservationEvents(root, { stateRoot });
    assert.strictEqual(result.events.length, 3);
    assert.deepStrictEqual(result.events.map((event) => event.occurredAt), [
      '2026-07-01T00:00:02.000Z', '2026-07-01T00:00:03.000Z', '2026-07-01T00:00:04.000Z',
    ]);
  });

  await test('retention removes events older than the configured age', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-01-01T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-07-31T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000002',
    }));
    const result = readObservationEvents(root, { stateRoot });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].occurredAt, '2026-07-31T00:00:00.000Z');
  });

  await test('report-time retention removes dormant expired events', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-01-01T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    const result = readObservationEvents(root, {
      stateRoot,
      enforceRetention: true,
      nowMs: Date.parse('2026-07-31T00:00:00.000Z'),
    });
    assert.strictEqual(result.events.length, 0);
  });

  await test('report-time maintenance removes stale crash-pending files', () => {
    const { root, stateRoot } = fixture();
    const directory = observationDirectory(root, { stateRoot });
    fs.mkdirSync(directory, { recursive: true });
    const pending = path.join(
      directory,
      '.pending-123-00000000-0000-4000-8000-000000000001.tmp',
    );
    fs.writeFileSync(pending, '{"documentPath":"docs/STALE.md"');
    const old = new Date('2025-01-01T00:00:00.000Z');
    fs.utimesSync(pending, old, old);
    const result = readObservationEvents(root, {
      stateRoot,
      enforceRetention: true,
      nowMs: Date.parse('2026-07-31T00:00:00.000Z'),
    });
    assert.strictEqual(fs.existsSync(pending), false);
    assert.strictEqual(result.stalePendingFiles, 1);
    assert.strictEqual(result.cleanupErrors, 0);
  });

  await test('malformed observation files are skipped and surfaced', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot));
    const directory = observationDirectory(root, { stateRoot });
    fs.writeFileSync(
      path.join(directory, 'event-9999999999999-00000000-0000-4000-8000-000000000000.json'),
      '{not-json',
    );
    const result = readObservationEvents(root, { stateRoot });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.invalidFiles, 1);
  });

  await test('malformed future files do not displace valid retained events', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-07-31T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    const directory = observationDirectory(root, { stateRoot });
    for (let index = 2; index <= 4; index += 1) {
      fs.writeFileSync(
        path.join(directory, `event-9999999999999-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.json`),
        '{not-json',
      );
    }
    const result = readObservationEvents(root, {
      stateRoot,
      enforceRetention: true,
      nowMs: Date.parse('2026-07-31T00:01:00.000Z'),
      maxEvents: 2,
    });
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.invalidFiles, 3);
  });

  await test('cleanup failure is surfaced and expired records are excluded from summary input', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2025-01-01T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    const directory = observationDirectory(root, { stateRoot });
    fs.chmodSync(directory, 0o500);
    try {
      const result = readObservationEvents(root, {
        stateRoot,
        enforceRetention: true,
        nowMs: Date.parse('2026-07-31T00:00:00.000Z'),
      });
      assert.strictEqual(result.events.length, 0);
      assert.strictEqual(result.cleanupErrors, 1);
    } finally {
      fs.chmodSync(directory, 0o700);
    }
  });

  await test('summary is deterministic and groups only metadata', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-07-31T10:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-07-31T10:01:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000002',
      input: { session_id: 'second-session', tool_name: 'Edit' },
      relativePath: 'docs/SECOND_DESIGN.md',
      missingClaims: [{ shapes: ['call-path'] }],
    }));
    const result = readObservationEvents(root, { stateRoot });
    const first = summarizeObservationEvents(result.events);
    const second = summarizeObservationEvents([...result.events].reverse());
    assert.deepStrictEqual(first, second);
    assert.strictEqual(first.sessionCount, 2);
    assert.strictEqual(first.eventCount, 2);
    assert.deepStrictEqual(first.shapeCounts, { 'call-path': 1, universal: 1, count: 1 });
  });

  await test('exact-session summary resists a later event from a concurrent session', () => {
    const { root, stateRoot } = fixture();
    recordAdvisoryObservation(recordArgs(root, stateRoot, {
      now: new Date('2026-07-31T11:04:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
      input: { session_id: 'prior-session', tool_name: 'Write' },
    }));
    const currentInput = { session_id: 'current-session' };
    recordObservationSession({
      root,
      stateRoot,
      input: currentInput,
      now: new Date('2026-07-31T11:00:00.000Z'),
    });
    const result = readObservationEvents(root, { stateRoot });
    const summary = summarizeObservationEvents(result.events, {
      sessions: result.sessions,
      onlySessionKey: sessionKey(currentInput),
    });
    assert.strictEqual(summary.sessionCount, 1);
    assert.strictEqual(summary.sessions[0].sessionKey, sessionKey(currentInput));
    assert.strictEqual(summary.sessions[0].eventCount, 0);
    assert.deepStrictEqual(summary.sessions[0].documents, []);
  });

  await test('session marker stores only a hash and timestamp', () => {
    const { root, stateRoot } = fixture();
    const input = { session_id: 'raw-session-id-must-not-persist' };
    const { file } = recordObservationSession({ root, stateRoot, input });
    const raw = fs.readFileSync(file, 'utf8');
    assert.strictEqual(raw.includes(input.session_id), false);
    assert.strictEqual(raw.includes(sessionKey(input)), true);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  });

  await test('report command reads the local store and emits machine-readable summary', () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-report-'));
    const repoRoot = path.resolve(__dirname, '../../..');
    const input = { session_id: 'report-session', tool_name: 'Write' };
    recordObservationSession({ root: repoRoot, stateRoot, input });
    recordAdvisoryObservation(recordArgs(repoRoot, stateRoot, {
      input,
      missingClaims: [{ shapes: ['count'] }],
    }));
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/report-claim-evidence-pilot.js'), '--current', '--json'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          WMKF_CLAIM_EVIDENCE_SESSION_KEY: sessionKey(input),
          WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot,
        },
        encoding: 'utf8',
      },
    );
    assert.strictEqual(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.strictEqual(summary.sessionCount, 1);
    assert.strictEqual(summary.eventCount, 1);
    assert.strictEqual(summary.shapeCounts.count, 1);
    assert.strictEqual(summary.eligibleSessionRecorded, true);
  });

  await test('current report distinguishes a session with no eligible documentation activity', () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-no-activity-'));
    const repoRoot = path.resolve(__dirname, '../../..');
    const input = { session_id: 'no-eligible-docs' };
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/report-claim-evidence-pilot.js'), '--current', '--json'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          WMKF_CLAIM_EVIDENCE_SESSION_KEY: sessionKey(input),
          WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot,
        },
        encoding: 'utf8',
      },
    );
    assert.strictEqual(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.strictEqual(summary.eligibleSessionRecorded, false);
    assert.strictEqual(summary.sessionCount, 0);
    assert.strictEqual(summary.eventCount, 0);
  });

  await test('current report treats an advisory event as eligible when its session marker is absent', () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-event-only-'));
    const repoRoot = path.resolve(__dirname, '../../..');
    const input = { session_id: 'event-without-marker', tool_name: 'Write' };
    recordAdvisoryObservation({
      ...recordArgs(repoRoot, stateRoot),
      input,
    });
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/report-claim-evidence-pilot.js'), '--current', '--json'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          WMKF_CLAIM_EVIDENCE_SESSION_KEY: sessionKey(input),
          WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot,
        },
        encoding: 'utf8',
      },
    );
    assert.strictEqual(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.strictEqual(summary.eligibleSessionRecorded, true);
    assert.strictEqual(summary.sessionCount, 1);
    assert.strictEqual(summary.eventCount, 1);
  });

  await test('report command surfaces an unreadable state root instead of reporting zero', () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-bad-report-'));
    const blocker = path.join(stateRoot, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');
    const repoRoot = path.resolve(__dirname, '../../..');
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/report-claim-evidence-pilot.js'), '--latest', '--json'],
      {
        cwd: repoRoot,
        env: { ...process.env, WMKF_CLAIM_EVIDENCE_STATE_ROOT: blocker },
        encoding: 'utf8',
      },
    );
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /report unavailable/);
    assert.strictEqual(result.stdout, '');
  });

  await test('report command exits nonzero when expired files cannot be removed', () => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wmkf-claim-observation-cleanup-report-'));
    const repoRoot = path.resolve(__dirname, '../../..');
    recordAdvisoryObservation(recordArgs(repoRoot, stateRoot, {
      now: new Date('2025-01-01T00:00:00.000Z'),
      eventId: '00000000-0000-4000-8000-000000000001',
    }));
    const directory = observationDirectory(repoRoot, { stateRoot });
    fs.chmodSync(directory, 0o500);
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(repoRoot, 'scripts/report-claim-evidence-pilot.js'), '--latest'],
        {
          cwd: repoRoot,
          env: { ...process.env, WMKF_CLAIM_EVIDENCE_STATE_ROOT: stateRoot },
          encoding: 'utf8',
        },
      );
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stdout, /could not be removed/);
      assert.match(result.stdout, /advisory events: 0/);
    } finally {
      fs.chmodSync(directory, 0o700);
    }
  });

  await test('an invalid state root fails explicitly for the caller to handle', () => {
    const { root, stateRoot } = fixture();
    const blocker = path.join(stateRoot, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');
    assert.throws(
      () => recordAdvisoryObservation(recordArgs(root, blocker)),
      /ENOTDIR|EEXIST/,
    );
  });

  if (failures) {
    console.error(`\nclaim-evidence-observations test FAILED (${failures})`);
    process.exit(1);
  }
  console.log('\nclaim-evidence-observations test OK');
})();
