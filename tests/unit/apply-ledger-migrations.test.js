/** @jest-environment node */
import {
  decideFileAction, sha256Text, tableNamesIn, stripOuterTxn, decideTrackedPrefixVerification, selectTrackedPrefixFiles,
} from '../../lib/db/ledger-migrations';

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

/**
 * Codex round-3 #2: a tracked row's matching checksum only proves the
 * migration file's TEXT hasn't changed since it was applied — it says
 * nothing about whether the live ledger's objects still match what that
 * file's SQL would produce. decideTrackedPrefixVerification is the pure
 * decision over a scratch-vs-live comparison of the tracked, checksum-
 * matching PREFIX of files, run before the per-file loop even considers its
 * first file.
 */
describe('Codex round-3 #2: decideTrackedPrefixVerification', () => {
  test('no prefix to verify (nothing tracked yet) -> ok', () => {
    expect(decideTrackedPrefixVerification({ prefixDiff: null })).toEqual({ ok: true });
  });

  test('a clean comparison -> ok', () => {
    expect(decideTrackedPrefixVerification({ prefixDiff: { missing: [], differing: [], extra: [] } })).toEqual({ ok: true });
  });

  // The required case: a tracked, checksum-matching 054 whose live objects
  // have drifted (e.g. a hand-dropped/altered CHECK constraint under the
  // same name) must refuse the WHOLE run — before the loop even reaches
  // 058 — not just skip 054 and move on.
  test('054 checksum-matches but its live prefix diff has a differing object -> refuse before 058 is considered', () => {
    const decision = decideTrackedPrefixVerification({
      prefixDiff: { missing: [], differing: ['constraint test_request_runs.test_request_runs_status_check'], extra: [] },
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/drifted from the live ledger/);
  });

  test('a missing object -> refuse', () => {
    const decision = decideTrackedPrefixVerification({
      prefixDiff: { missing: ['table test_request_status_changes'], differing: [], extra: [] },
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/drifted from the live ledger/);
  });

  test('an unapproved extra object -> refuse', () => {
    const decision = decideTrackedPrefixVerification({
      prefixDiff: { missing: [], differing: [], extra: ['table test_request_hand_added'] },
      approvedAhead: [],
      liveFingerprint: { tables: { test_request_hand_added: {} } },
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toMatch(/unapproved extra object/);
  });

  test('an extra object that is exactly shape-approved by the ahead list -> ok', () => {
    const APPROVED_TABLE_SHAPE = {
      columns: [{ name: 'binding_id', type: 'uuid', nullable: false, default: null }],
      constraints: [],
      indexes: [],
      triggers: [],
    };
    const decision = decideTrackedPrefixVerification({
      prefixDiff: { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] },
      approvedAhead: [{ migration: '058_test_request_cast_slot_bindings.sql', tables: { test_request_cast_slot_bindings: APPROVED_TABLE_SHAPE } }],
      liveFingerprint: { tables: { test_request_cast_slot_bindings: APPROVED_TABLE_SHAPE } },
    });
    expect(decision).toEqual({ ok: true });
  });

  // Opus round-3 M1: before this fix, a prefix extra with an EMPTY
  // approvedAhead was always unapproved and refused the whole run — even
  // when the extra is simply an object a LATER, not-yet-tracked checkout
  // file (e.g. 058) already creates. decideFileAction's own `adopt` path
  // never got a chance to run. laterFilesFingerprint (the scratch
  // fingerprint of applying EVERY checkout file) lets that specific case
  // through, but only when the live shape is EXACTLY what the later file
  // itself would produce.
  describe('Opus round-3 M1: a prefix extra a later checkout file already explains', () => {
    const SLOT_BINDINGS_SHAPE = {
      columns: [{ name: 'run_id', type: 'uuid', nullable: false, default: null }],
      constraints: [],
      indexes: [],
      triggers: [],
    };

    test('054 tracked, prefix diff shows an extra 058 table, approvedAhead empty, laterFilesFingerprint has the same shape -> ok', () => {
      const decision = decideTrackedPrefixVerification({
        prefixDiff: { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] },
        approvedAhead: [],
        liveFingerprint: { tables: { test_request_cast_slot_bindings: SLOT_BINDINGS_SHAPE } },
        laterFilesFingerprint: { tables: { test_request_cast_slot_bindings: SLOT_BINDINGS_SHAPE } },
      });
      expect(decision).toEqual({ ok: true });
    });

    test('same, but the live table shape differs from the later file -> refuse', () => {
      const laterShape = { ...SLOT_BINDINGS_SHAPE, columns: [{ name: 'run_id', type: 'uuid', nullable: false, default: null }, { name: 'member_id', type: 'uuid', nullable: false, default: null }] };
      const decision = decideTrackedPrefixVerification({
        prefixDiff: { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] },
        approvedAhead: [],
        liveFingerprint: { tables: { test_request_cast_slot_bindings: SLOT_BINDINGS_SHAPE } },
        laterFilesFingerprint: { tables: { test_request_cast_slot_bindings: laterShape } },
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toMatch(/unapproved extra object/);
    });

    test('an extra no later file explains (absent from laterFilesFingerprint entirely) -> refuse', () => {
      const decision = decideTrackedPrefixVerification({
        prefixDiff: { missing: [], differing: [], extra: ['table test_request_hand_added'] },
        approvedAhead: [],
        liveFingerprint: { tables: { test_request_hand_added: SLOT_BINDINGS_SHAPE } },
        laterFilesFingerprint: { tables: {} },
      });
      expect(decision.ok).toBe(false);
    });

    test('missing/differing on the prefix itself stay fatal even with a laterFilesFingerprint present', () => {
      const decision = decideTrackedPrefixVerification({
        prefixDiff: { missing: ['table test_request_status_changes'], differing: [], extra: [] },
        laterFilesFingerprint: { tables: { test_request_status_changes: SLOT_BINDINGS_SHAPE } },
      });
      expect(decision.ok).toBe(false);
      expect(decision.reason).toMatch(/drifted from the live ledger/);
    });
  });
});

/**
 * Opus round-3 L1: a legacy NULL-checksum tracked row is still an
 * already-applied file — it must be included in the prefix
 * verifyTrackedPrefix checks, not skipped, so --accept-tracked-checksums
 * cannot record a checksum for a drifted row and move on to the next file
 * with no live comparison of the row it just "accepted".
 */
describe('Opus round-3 L1: selectTrackedPrefixFiles', () => {
  const files = ['054_test_request_runs.sql', '058_test_request_cast_slot_bindings.sql'];
  const fileChecksum = new Map([['054_test_request_runs.sql', 'abc'], ['058_test_request_cast_slot_bindings.sql', 'def']]);

  test('a checksum-matching tracked row is included', () => {
    const tracked = new Map([['054_test_request_runs.sql', { sha256: 'abc' }]]);
    expect(selectTrackedPrefixFiles(files, tracked, fileChecksum)).toEqual(['054_test_request_runs.sql']);
  });

  test('a legacy NULL-checksum tracked row is included (the case this fix adds)', () => {
    const tracked = new Map([['054_test_request_runs.sql', { sha256: null }]]);
    expect(selectTrackedPrefixFiles(files, tracked, fileChecksum)).toEqual(['054_test_request_runs.sql']);
  });

  test('a checksum-mismatched tracked row is excluded (decideFileAction refuses it directly)', () => {
    const tracked = new Map([['054_test_request_runs.sql', { sha256: 'edited-since-applied' }]]);
    expect(selectTrackedPrefixFiles(files, tracked, fileChecksum)).toEqual([]);
  });

  test('an untracked file is excluded', () => {
    expect(selectTrackedPrefixFiles(files, new Map(), fileChecksum)).toEqual([]);
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

/**
 * Opus round-3 L2: the tracker table's own CREATE TABLE/ALTER COLUMN DDL
 * must run AFTER the identity check and the tracked-prefix verification —
 * never before this runner has proven the ledger it is about to write the
 * tracker to is trustworthy. This runs the actual (non-dry-run) script
 * against a recording fake `pg` Client with nothing tracked yet (so prefix
 * verification is a no-op) and asserts every query BEFORE the first
 * non-SELECT statement is one of the two required read-only checks, and
 * that the first non-SELECT statement is the tracker's own CREATE TABLE.
 */
describe('Opus round-3 L2: tracker DDL runs only after identity check + prefix verification', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, TEST_REQUEST_SANDBOX_LEDGER_URL: 'postgres://postgres:pw@127.0.0.1:5433/ledger' };
    process.argv = ['node', 'scripts/apply-ledger-migrations.js', '--url-env=TEST_REQUEST_SANDBOX_LEDGER_URL'];
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  test('CREATE TABLE/ALTER COLUMN come after current_database and to_regclass, never before', async () => {
    const calls = [];
    jest.doMock('pg', () => ({
      Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn(async () => {}),
        query: jest.fn(async (text) => {
          calls.push(String(text));
          if (/current_database/i.test(text)) return { rows: [{ db: 'ledger', schema: 'public', port: 5432 }] };
          if (/to_regclass/i.test(text)) return { rows: [{ reg: null }] }; // tracker absent -> nothing tracked -> prefix verification is a no-op
          if (/pg_tables/i.test(text)) return { rows: [] };
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

    const firstNonSelectIndex = calls.findIndex((t) => !/^\s*SELECT\b/i.test(t));
    expect(firstNonSelectIndex).toBeGreaterThan(-1);
    expect(calls[firstNonSelectIndex]).toMatch(/^\s*CREATE TABLE IF NOT EXISTS ledger_schema_migrations/i);

    const before = calls.slice(0, firstNonSelectIndex);
    expect(before.some((t) => /current_database/i.test(t))).toBe(true);
    expect(before.some((t) => /to_regclass/i.test(t))).toBe(true);
    for (const t of before) expect(/^\s*SELECT\b/i.test(t)).toBe(true);
  }, 10000);
});
