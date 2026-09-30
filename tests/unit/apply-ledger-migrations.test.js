/** @jest-environment node */
import { decideFileAction, sha256Text, tableNamesIn, stripOuterTxn } from '../../lib/db/ledger-migrations';

const CLEAN_DIFF = { missing: [], differing: [], extra: ['table test_request_cast_slot_bindings'] };
const DIRTY_DIFF = { missing: ['table test_request_status_changes'], differing: [] };

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
