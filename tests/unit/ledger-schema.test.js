/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalizeDefinition,
  compareLedgerFingerprint,
  formatLedgerDiff,
  listLedgerMigrationFiles,
  readApprovedAhead,
  readExpectedFingerprint,
  unapprovedExtras,
} from '../../lib/db/ledger-schema';

const col = (name, type, nullable, def = null) => ({ name, type, nullable, default: def });
const cons = (name, type, definition) => ({ name, type, definition });
const idx = (name, definition, unique = false, primary = false) => ({ name, unique, primary, definition });
const trg = (name, definition) => ({ name, definition });
const fn = (signature, { returnType = 'void', language = 'sql', volatile = 'i', bodyHash = 'a'.repeat(64) } = {}) => (
  { signature, returnType, language, volatile, bodyHash }
);

const base = () => ({
  tables: {
    test_request_runs: {
      columns: [col('run_id', 'uuid', false), col('status', 'text', false, "'pending'::text")],
      constraints: [cons('test_request_runs_pkey', 'p', 'PRIMARY KEY (run_id)'), cons('test_request_runs_status_check', 'c', "CHECK (status = ANY (ARRAY['pending', 'done']))")],
      indexes: [idx('test_request_runs_pkey', 'CREATE UNIQUE INDEX ... USING btree (run_id)', true, true), idx('test_request_runs_status_idx', 'CREATE INDEX ... USING btree (status)')],
      triggers: [trg('test_request_runs_touch', 'CREATE TRIGGER test_request_runs_touch ...')],
    },
  },
  functions: [fn('test_request_receipt_ok(receipt jsonb)')],
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
  live.tables.test_request_runs.triggers = [];
  live.functions = [];
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.missing).toEqual([
    'column test_request_runs.status',
    'constraint test_request_runs.test_request_runs_status_check',
    'index test_request_runs.test_request_runs_status_idx',
    'trigger test_request_runs.test_request_runs_touch',
    'function test_request_receipt_ok(receipt jsonb)',
  ]);
  const withoutTable = { tables: {}, functions: base().functions };
  expect(compareLedgerFingerprint(base(), withoutTable).missing).toContain('table test_request_runs');
});

test('a changed column type, nullability, or default fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.columns[1] = col('status', 'varchar', true);
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('column test_request_runs.status');
  expect(formatLedgerDiff(d)).toContain('DIFFERS   column test_request_runs.status');
});

test('a changed CHECK body fails as differing under the same constraint name', () => {
  const live = base();
  live.tables.test_request_runs.constraints[1] = cons('test_request_runs_status_check', 'c', "CHECK (status = ANY (ARRAY['pending', 'done', 'archived']))");
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('constraint test_request_runs.test_request_runs_status_check');
});

test('a changed index (uniqueness or definition, e.g. a partial predicate) fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.indexes[1] = idx('test_request_runs_status_idx', "CREATE INDEX ... USING btree (status) WHERE status = 'pending'");
  let d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('index test_request_runs.test_request_runs_status_idx');

  const live2 = base();
  live2.tables.test_request_runs.indexes[0] = idx('test_request_runs_pkey', base().tables.test_request_runs.indexes[0].definition, false, true);
  d = compareLedgerFingerprint(base(), live2);
  expect(d.ok).toBe(false);
});

test('a changed trigger definition fails as differing', () => {
  const live = base();
  live.tables.test_request_runs.triggers[0] = trg('test_request_runs_touch', 'CREATE TRIGGER test_request_runs_touch ... EXECUTE FUNCTION other()');
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('trigger test_request_runs.test_request_runs_touch');
});

test('a changed function return type, language, volatility, or body hash fails as differing', () => {
  const live = base();
  live.functions[0] = fn('test_request_receipt_ok(receipt jsonb)', { bodyHash: 'b'.repeat(64) });
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(false);
  expect(d.differing[0]).toContain('function test_request_receipt_ok(receipt jsonb)');
});

test('a ledger ahead of the checkout (extra table, column, index, trigger, function) is ok with warnings', () => {
  const live = base();
  live.tables.test_request_runs.columns.push(col('later', 'text', true));
  live.tables.test_request_runs.indexes.push(idx('later_idx', 'CREATE INDEX later_idx ...'));
  live.tables.test_request_runs.triggers.push(trg('later_trigger', 'CREATE TRIGGER later_trigger ...'));
  live.tables.test_request_cast_slot_bindings = { columns: [], constraints: [], indexes: [], triggers: [] };
  live.functions.push(fn('test_request_other()'));
  const d = compareLedgerFingerprint(base(), live);
  expect(d.ok).toBe(true);
  expect(d.extra).toEqual([
    'column test_request_runs.later',
    'index test_request_runs.later_idx',
    'trigger test_request_runs.later_trigger',
    'table test_request_cast_slot_bindings',
    'function test_request_other()',
  ]);
  expect(formatLedgerDiff(d)).toContain('extra     table test_request_cast_slot_bindings');
});

describe('canonicalizeDefinition', () => {
  test('strips the current schema qualification (quoted and bare) and collapses whitespace', () => {
    expect(canonicalizeDefinition('CHECK (("ledger_fp_ab12".status = ANY (ARRAY[\'a\'::text])))', 'ledger_fp_ab12'))
      .toBe("CHECK ((status = ANY (ARRAY['a'::text])))");
    expect(canonicalizeDefinition('SELECT * FROM ledger_fp_ab12.test_request_runs', 'ledger_fp_ab12'))
      .toBe('SELECT * FROM test_request_runs');
    expect(canonicalizeDefinition('a   b\n\tc', null)).toBe('a b c');
  });
  test('does not lowercase (case is semantic)', () => {
    expect(canonicalizeDefinition('SELECT Foo', null)).toBe('SELECT Foo');
  });
  test('passes through null/undefined', () => {
    expect(canonicalizeDefinition(null, 'x')).toBeNull();
    expect(canonicalizeDefinition(undefined, 'x')).toBeNull();
  });
});

describe('approved-ahead extras (Codex round-1 Fix 4)', () => {
  test('unapprovedExtras filters out only objects named in the approved-ahead set', () => {
    const diff = { extra: ['table test_request_cast_slot_bindings', 'table something_unexpected'] };
    const approved = new Set(['table test_request_cast_slot_bindings']);
    expect(unapprovedExtras(diff, approved)).toEqual(['table something_unexpected']);
  });
  test('readApprovedAhead reads the tracked file', () => {
    const approved = readApprovedAhead();
    expect(approved instanceof Set).toBe(true);
  });
  test('readApprovedAhead returns an empty set when the file is missing', () => {
    expect(readApprovedAhead('/nonexistent/path.json')).toEqual(new Set());
  });
});

test('the tracked fingerprint names exactly the ledger migration files in the checkout', () => {
  const expected = readExpectedFingerprint();
  expect(expected.generatedFrom).toEqual(listLedgerMigrationFiles());
  expect(Object.keys(expected.fingerprint.tables)).toContain('test_request_runs');
  expect(expected.fingerprint.functions.some((f) => f.signature === 'test_request_receipt_ok(receipt jsonb)')).toBe(true);
  // No NOT NULL pseudo-constraints (Postgres 18 lists them; 16 does not).
  for (const t of Object.values(expected.fingerprint.tables)) {
    expect(t.constraints.every((c) => c.type !== 'n')).toBe(true);
  }
  expect(fs.existsSync(path.join(process.cwd(), 'lib/db/ledger-schema-fingerprint.json'))).toBe(true);
});
