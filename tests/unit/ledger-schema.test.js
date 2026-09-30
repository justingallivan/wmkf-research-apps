/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import {
  compareLedgerFingerprint,
  formatLedgerDiff,
  listLedgerMigrationFiles,
  readExpectedFingerprint,
} from '../../lib/db/ledger-schema';

const base = () => ({
  tables: {
    test_request_runs: {
      columns: [{ name: 'run_id', type: 'uuid', nullable: false }, { name: 'status', type: 'text', nullable: false }],
      constraints: [{ name: 'test_request_runs_pkey', type: 'p' }, { name: 'test_request_runs_status_check', type: 'c' }],
      indexes: ['test_request_runs_pkey', 'test_request_runs_status_idx'],
    },
  },
  functions: ['test_request_receipt_ok(receipt jsonb)'],
});

test('identical fingerprints compare clean', () => {
  const d = compareLedgerFingerprint(base(), base());
  expect(d).toEqual({ missing: [], differing: [], extra: [], ok: true });
});

test('a ledger behind the checkout fails on every missing object kind', () => {
  const live = base();
  live.tables.test_request_runs.columns.pop();
  live.tables.test_request_runs.constraints.pop();
  live.tables.test_request_runs.indexes.pop();
  live.functions = [];
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.missing).toEqual([
    'column test_request_runs.status',
    'constraint test_request_runs.test_request_runs_status_check',
    'index test_request_runs.test_request_runs_status_idx',
    'function test_request_receipt_ok(receipt jsonb)',
  ]);
  const withoutTable = { tables: {}, functions: base().functions };
  expect(compareLedgerFingerprint(base(), withoutTable).missing).toContain('table test_request_runs');
});

test('a changed column type, nullability, or constraint kind fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.columns[1] = { name: 'status', type: 'varchar', nullable: true };
  live.tables.test_request_runs.constraints[1] = { name: 'test_request_runs_status_check', type: 'u' };
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing).toEqual([
    'column test_request_runs.status (text not null → varchar)',
    'constraint test_request_runs.test_request_runs_status_check (c → u)',
  ]);
  expect(formatLedgerDiff(d)).toContain('DIFFERS   column test_request_runs.status');
});

test('a ledger ahead of the checkout (extra table, column, index, function) is ok with warnings', () => {
  const live = base();
  live.tables.test_request_runs.columns.push({ name: 'later', type: 'text', nullable: true });
  live.tables.test_request_runs.indexes.push('later_idx');
  live.tables.test_request_cast_slot_bindings = { columns: [], constraints: [], indexes: [] };
  live.functions.push('test_request_other()');
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(true);
  expect(d.extra).toEqual([
    'column test_request_runs.later',
    'index test_request_runs.later_idx',
    'table test_request_cast_slot_bindings',
    'function test_request_other()',
  ]);
  expect(formatLedgerDiff(d)).toContain('extra     table test_request_cast_slot_bindings');
});

test('the tracked fingerprint names exactly the ledger migration files in the checkout', () => {
  const expected = readExpectedFingerprint();
  expect(expected.generatedFrom).toEqual(listLedgerMigrationFiles());
  expect(Object.keys(expected.fingerprint.tables)).toContain('test_request_runs');
  expect(expected.fingerprint.functions).toContain('test_request_receipt_ok(receipt jsonb)');
  // No NOT NULL pseudo-constraints (Postgres 18 lists them; 16 does not).
  for (const t of Object.values(expected.fingerprint.tables)) {
    expect(t.constraints.every((c) => c.type !== 'n')).toBe(true);
  }
  expect(fs.existsSync(path.join(process.cwd(), 'lib/db/ledger-schema-fingerprint.json'))).toBe(true);
});
