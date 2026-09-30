/** @jest-environment node */
import { decideFileAction, sha256Text, tableNamesIn, stripOuterTxn } from '../../lib/db/ledger-migrations';

// Opus round-2 item 4: a genuinely clean scratch diff has NO extra either —
// the prior fixture used a diff containing an extra table and still called
// it "clean", which is exactly the bug Codex found (decideFileAction
// ignored scratchDiff.extra and adopted anyway).
const CLEAN_DIFF = { missing: [], differing: [], extra: [] };
const DIRTY_DIFF = { missing: ['table test_request_status_changes'], differing: [], extra: [] };

const APPROVED_TABLE_SHAPE = {
  columns: [{ name: 'binding_id', type: 'uuid', nullable: false, default: null }],
  constraints: [{ name: 'test_request_cast_slot_bindings_pkey', type: 'p', definition: 'PRIMARY KEY (binding_id)' }],
  indexes: [{ name: 'test_request_cast_slot_bindings_pkey', unique: true, primary: true, definition: 'CREATE UNIQUE INDEX ... (binding_id)' }],
  triggers: [],
};
const APPROVED_AHEAD = [{ migration: '058_test_request_cast_slot_bindings.sql', tables: { test_request_cast_slot_bindings: APPROVED_TABLE_SHAPE } }];

describe('Codex round-1 Fix 3: decideFileAction', () => {
  test('tracked, checksum matches -> skip', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: { sha256: 'abc' },
    });
    expect(decision).toEqual({ action: 'skip' });
  });

  test('tracked, checksum mismatch -> refuse (file changed since it was applied)', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: { sha256: 'different' },
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/changed since it was applied/);
    expect(decision.reason).toMatch(/forward migration/);
  });

  test('tracked with no recorded checksum (legacy row) -> refuse unless --accept-tracked-checksums', () => {
    const refused = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: { sha256: null },
    });
    expect(refused.action).toBe('refuse');
    expect(refused.reason).toMatch(/accept-tracked-checksums/);

    const accepted = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: { sha256: null },
      acceptTrackedChecksums: true,
    });
    expect(accepted).toEqual({ action: 'accept-checksum' });
  });

  test('untracked, no live objects -> apply', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: false,
    });
    expect(decision).toEqual({ action: 'apply' });
  });

  test('untracked + clean (scratch diff has no missing/differing) -> adopt', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: true,
      scratchDiff: CLEAN_DIFF,
    });
    expect(decision).toEqual({ action: 'adopt' });
  });

  test('untracked + drift (scratch diff has missing or differing) -> refuse', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: true,
      scratchDiff: DIRTY_DIFF,
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/differ from the checkout's migration/);
  });

  test('Opus round-2 item 4: an unapproved extra (e.g. an extra trigger) refuses, never adopts silently', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: true,
      scratchDiff: { missing: [], differing: [], extra: ['trigger test_request_runs.unexpected_side_effect'] },
      approvedAhead: [],
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/unapproved extra object/);
    expect(decision.reason).toMatch(/unexpected_side_effect/);
  });

  test('an extra table that is exactly shape-approved by lib/db/ledger-schema-ahead.json adopts', () => {
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: true,
      scratchDiff: { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] },
      approvedAhead: APPROVED_AHEAD,
      liveFingerprint: { tables: { test_request_cast_slot_bindings: APPROVED_TABLE_SHAPE } },
    });
    expect(decision).toEqual({ action: 'adopt' });
  });

  test('the same approved-ahead table with a DIFFERENT live shape refuses, not adopts', () => {
    const driftedShape = { ...APPROVED_TABLE_SHAPE, columns: [{ name: 'binding_id', type: 'text', nullable: false, default: null }] };
    const decision = decideFileAction({
      file: '054_test_request_runs.sql',
      currentChecksum: 'abc',
      trackedRow: null,
      liveHasObjects: true,
      scratchDiff: { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] },
      approvedAhead: APPROVED_AHEAD,
      liveFingerprint: { tables: { test_request_cast_slot_bindings: driftedShape } },
    });
    expect(decision.action).toBe('refuse');
    expect(decision.reason).toMatch(/unapproved extra object/);
  });
});

describe('helpers', () => {
  test('sha256Text is deterministic and sensitive to content', () => {
    expect(sha256Text('a')).toBe(sha256Text('a'));
    expect(sha256Text('a')).not.toBe(sha256Text('b'));
    expect(sha256Text('a')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('tableNamesIn finds CREATE TABLE [IF NOT EXISTS] names', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS test_request_runs (id uuid);
      CREATE TABLE other_table (id uuid);
    `;
    expect(tableNamesIn(sql)).toEqual(['test_request_runs', 'other_table']);
  });

  test('tableNamesIn returns empty for a file with no CREATE TABLE', () => {
    expect(tableNamesIn('ALTER TABLE x ADD COLUMN y text;')).toEqual([]);
  });

  test('stripOuterTxn removes only standalone BEGIN;/COMMIT; lines', () => {
    const body = 'BEGIN;\nCREATE TABLE x (id uuid);\nCOMMIT;\n';
    expect(stripOuterTxn(body)).toBe('\nCREATE TABLE x (id uuid);\n');
  });
});

/**
 * Opus round-2 item 5 (Codex #6): --dry-run must issue only SELECT queries.
 * The prior version still called fingerprintFilesInScratch for an untracked
 * file whose objects exist live, which executes BEGIN, CREATE SCHEMA, SET
 * LOCAL, the migration bodies, and ROLLBACK — real DDL, even though it rolls
 * back. This test runs the actual script (it has no require.main guard; it
 * calls main() at module load) against a recording fake `pg` Client and
 * proves no non-SELECT statement and no migration SQL is ever sent.
 */
describe('Opus round-2 item 5: apply-ledger-migrations.js --dry-run sends only SELECT queries', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, TEST_REQUEST_SANDBOX_LEDGER_URL: 'postgres://postgres:pw@127.0.0.1:5433/ledger' };
    process.argv = ['node', 'scripts/apply-ledger-migrations.js', '--url-env=TEST_REQUEST_SANDBOX_LEDGER_URL', '--dry-run'];
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  test('a connection whose identity does not match the classified ledger is refused before any tracker query (Opus round-2 low #1)', async () => {
    const calls = [];
    const exits = [];
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn(async () => {}),
        query: jest.fn(async (text) => {
          calls.push(String(text));
          if (/current_database/i.test(text)) return { rows: [{ db: 'ledger', schema: 'shadow', port: 5432 }] };
          return { rows: [] };
        }),
        end: jest.fn(async () => {}),
      })),
    }));
    let doneResolve;
    const done = new Promise((resolve) => { doneResolve = resolve; });
    jest.spyOn(process, 'exit').mockImplementation((code) => { exits.push(code); doneResolve(); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.isolateModules(() => { require('../../scripts/apply-ledger-migrations.js'); });
    await Promise.race([done, new Promise((resolve) => { setTimeout(resolve, 5000); })]);
    expect(exits).toEqual([1]);
    expect(calls.some((t) => /current_database/i.test(t))).toBe(true);
    expect(calls.some((t) => /ledger_schema_migrations|to_regclass|pg_tables/i.test(t))).toBe(false);
  }, 10000);

  test('no BEGIN/CREATE/ALTER/DROP/SET and no migration SQL is sent under --dry-run', async () => {
    const calls = [];
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn(async () => {}),
        query: jest.fn(async (text) => {
          calls.push(String(text));
          // Opus round-2 item 1: the runner now verifies connection
          // identity right after connecting; answer it so the test
          // continues past that into the actual dry-run file loop.
          if (/current_database/i.test(text)) return { rows: [{ db: 'ledger', schema: 'public', port: 5432 }] };
          // Simulate an untracked file whose objects already exist live —
          // exactly the path that used to run scratch DDL under --dry-run.
          if (/to_regclass/i.test(text)) return { rows: [{ reg: 'ledger_schema_migrations' }] };
          if (/information_schema\.columns/i.test(text)) return { rows: [{ x: 1 }] };
          if (/SELECT name, sha256 FROM/i.test(text)) return { rows: [] };
          if (/pg_tables/i.test(text)) return { rows: [{ x: 1 }] };
          return { rows: [] };
        }),
        end: jest.fn(async () => {}),
      })),
    }));

    let doneResolve;
    const done = new Promise((resolve) => { doneResolve = resolve; });
    jest.spyOn(process, 'exit').mockImplementation(() => { doneResolve(); });

    require('../../scripts/apply-ledger-migrations.js');
    await Promise.race([done, new Promise((resolve) => { setTimeout(resolve, 5000); })]);

    expect(calls.length).toBeGreaterThan(0);
    for (const text of calls) {
      expect(/^\s*(BEGIN|CREATE|ALTER|DROP|SET)\b/i.test(text)).toBe(false);
      expect(text).not.toMatch(/CREATE TABLE IF NOT EXISTS test_request_runs/i);
      expect(/^\s*SELECT\b/i.test(text)).toBe(true);
    }
  }, 10000);
});
