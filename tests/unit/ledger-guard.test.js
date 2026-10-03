/** @jest-environment node */
/**
 * Executes lib/db/ledger-guard.js's requireLedgerUrl and ledgerSchemaCheck
 * directly (Opus round-2 item 6; Codex round-2 medium finding #7). The
 * round-1 literal-source test only proved every dispatch block in the CLI
 * CALLS these functions; it never executed them, so deleting the throw
 * blocks inside ledgerSchemaCheck left every round-1 assertion passing.
 * These tests exercise the actual behavior with an injectable fake db.
 */
import { requireLedgerUrl, ledgerSchemaCheck, LEDGER_CHECK_READ_ONLY_MODES } from '../../lib/db/ledger-guard';
import { MANAGED_LEDGER_HOSTS, SHARED_DATABASE_URL_VARS } from '../../lib/db/ledger-registry';

const MANAGED = MANAGED_LEDGER_HOSTS[0];

/**
 * Builds a fake `{ query }` db that answers readLedgerFingerprint's six
 * catalog queries (matched by a distinctive substring) from a plain JS
 * fingerprint object shaped exactly like readLedgerFingerprint's own
 * return value, so ledgerSchemaCheck's live-vs-expected comparison is
 * driven by the fixture, never a real Postgres connection.
 */
function fakeDbFromFingerprint(fp) {
  const columnRows = [];
  const constraintRows = [];
  const indexRows = [];
  const triggerRows = [];
  for (const [tableName, t] of Object.entries(fp.tables || {})) {
    for (const c of t.columns || []) columnRows.push({ table_name: tableName, column_name: c.name, type: c.type, nullable: c.nullable, default_expr: c.default });
    for (const c of t.constraints || []) constraintRows.push({ table_name: tableName, conname: c.name, contype: c.type, definition: c.definition });
    for (const idx of t.indexes || []) indexRows.push({ table_name: tableName, indexname: idx.name, is_unique: idx.unique, is_primary: idx.primary, definition: idx.definition });
    for (const tr of t.triggers || []) triggerRows.push({ table_name: tableName, tgname: tr.name, definition: tr.definition });
  }
  const functionRows = (fp.functions || []).map((f) => {
    const m = /^(.+?)\((.*)\)$/.exec(f.signature);
    return {
      proname: m[1], args: m[2], return_type: f.returnType, language: f.language, provolatile: f.volatile, prosrc: f.signature,
    };
  });
  return {
    query: async (text) => {
      if (/current_schema\(\) AS schema/.test(text)) return { rows: [{ schema: 'public' }] };
      if (/pg_attribute/.test(text)) return { rows: columnRows };
      if (/pg_constraint/.test(text)) return { rows: constraintRows };
      if (/pg_index/.test(text)) return { rows: indexRows };
      if (/pg_trigger/.test(text)) return { rows: triggerRows };
      if (/pg_proc/.test(text)) return { rows: functionRows };
      return { rows: [] };
    },
  };
}

const TABLE_SHAPE = (type = 'uuid') => ({
  columns: [{ name: 'run_id', type, nullable: false, default: null }],
  constraints: [],
  indexes: [],
  triggers: [],
});

const EXPECTED = { fingerprint: { tables: { test_request_runs: TABLE_SHAPE() }, functions: [] } };
const CLEAN_LIVE = { tables: { test_request_runs: TABLE_SHAPE() }, functions: [] };
const MISSING_LIVE = { tables: {}, functions: [] };
const DIFFERING_LIVE = { tables: { test_request_runs: TABLE_SHAPE('text') }, functions: [] };
const EXTRA_TABLE_SHAPE = TABLE_SHAPE();
const UNAPPROVED_EXTRA_LIVE = { tables: { test_request_runs: TABLE_SHAPE(), test_request_extra: EXTRA_TABLE_SHAPE }, functions: [] };
const APPROVED_AHEAD = [{ migration: '058.sql', tables: { test_request_extra: EXTRA_TABLE_SHAPE } }];

const WRITE_MODES = ['reserve', 'advance', 'set-status', 'status-recheck', 'status-abandon', 'create-cast', 'bind-reviewer', 'run-recheck'];
const READ_ONLY_MODES = [...LEDGER_CHECK_READ_ONLY_MODES];

describe('requireLedgerUrl (executed, not just grepped for)', () => {
  test('missing/empty target throws', () => {
    expect(() => requireLedgerUrl(undefined, {})).toThrow(/non-empty --target/);
    expect(() => requireLedgerUrl('', {})).toThrow(/non-empty --target/);
    expect(() => requireLedgerUrl(null, {})).toThrow(/non-empty --target/);
  });

  test('classifyLedgerUrl reason: unset', () => {
    expect(() => requireLedgerUrl('sandbox', {})).toThrow(/is required for ledger-driven modes/);
  });

  test('classifyLedgerUrl reason: shared_database', () => {
    const shared = 'postgresql://role:pw@ep-frosty-credit-afovxswa-pooler.c-2.us-west-2.aws.neon.tech/verceldb';
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: shared, POSTGRES_URL: shared };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/shared Production\/Preview database/);
  });

  test('uses the shared-variable registry, including DATABASE_URL_UNPOOLED', () => {
    expect(SHARED_DATABASE_URL_VARS).toContain('DATABASE_URL_UNPOOLED');
    const ledger = 'postgresql://ledger_role:pw@127.0.0.1:5433/shared_db';
    const shared = 'postgresql://app_role:pw@localhost:5433/shared_db';
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: ledger, DATABASE_URL_UNPOOLED: shared };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/shared Production\/Preview database/);
  });

  test('classifyLedgerUrl reason: unregistered_host', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: 'postgresql://role:pw@db.example.com/ledger' };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/unregistered_host/);
  });

  test('classifyLedgerUrl reason: query_override', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: `postgresql://role:pw@${MANAGED}/ledger?host=evil.example` };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/query_override/);
  });

  test('classifyLedgerUrl reason: socket_destination', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: 'postgresql://role:pw@%2Ftmp/ledger' };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/socket_destination/);
  });

  test('classifyLedgerUrl reason: wrong_port', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: `postgresql://role:pw@${MANAGED}:6543/ledger` };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/wrong_port/);
  });

  test('classifyLedgerUrl reason: wrong_database', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: `postgresql://role:pw@${MANAGED}/ledger_prod?sslmode=require` };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/must name the ledger database/);
  });

  test('classifyLedgerUrl reason: tls_required', () => {
    const env = { TEST_REQUEST_SANDBOX_LEDGER_URL: `postgresql://role:pw@${MANAGED}/ledger` };
    expect(() => requireLedgerUrl('sandbox', env)).toThrow(/tls_required/);
  });

  test('an acceptable URL is returned unchanged', () => {
    const url = `postgresql://role:pw@${MANAGED}/ledger?sslmode=require`;
    expect(requireLedgerUrl('sandbox', { TEST_REQUEST_SANDBOX_LEDGER_URL: url })).toBe(url);
  });
});

describe('ledgerSchemaCheck (executed with a fake injectable db)', () => {
  test.each(WRITE_MODES)('a missing object throws for write mode "%s"', async (mode) => {
    const db = fakeDbFromFingerprint(MISSING_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode, db, expected: EXPECTED, ahead: [] }))
      .rejects.toThrow(/does not match/);
  });

  test.each(WRITE_MODES)('a differing object throws for write mode "%s"', async (mode) => {
    const db = fakeDbFromFingerprint(DIFFERING_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode, db, expected: EXPECTED, ahead: [] }))
      .rejects.toThrow(/does not match/);
  });

  test.each(WRITE_MODES)('an unapproved extra throws for write mode "%s"', async (mode) => {
    const db = fakeDbFromFingerprint(UNAPPROVED_EXTRA_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode, db, expected: EXPECTED, ahead: [] }))
      .rejects.toThrow(/approved-ahead list/);
  });

  test.each(READ_ONLY_MODES.filter((m) => m !== 'ledger-check'))('an unapproved extra only WARNS (does not throw) for read-only mode "%s"', async (mode) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDbFromFingerprint(UNAPPROVED_EXTRA_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode, db, expected: EXPECTED, ahead: [] })).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('an extra table that is exactly shape-approved by the ahead list passes (no throw)', async () => {
    const db = fakeDbFromFingerprint(UNAPPROVED_EXTRA_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode: 'reserve', db, expected: EXPECTED, ahead: APPROVED_AHEAD }))
      .resolves.toBeDefined();
  });

  test('the ledger-check mode never throws, even with missing + differing + unapproved extra all present', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const messyLive = {
      tables: { test_request_extra: EXTRA_TABLE_SHAPE }, // missing test_request_runs, plus an unapproved extra
      functions: [],
    };
    const db = fakeDbFromFingerprint(messyLive);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode: 'ledger-check', db, expected: EXPECTED, ahead: [] }))
      .resolves.toBeDefined();
    warn.mockRestore();
  });

  test('a clean, fully matching live fingerprint passes for a write mode', async () => {
    const db = fakeDbFromFingerprint(CLEAN_LIVE);
    await expect(ledgerSchemaCheck('postgresql://x/y', { mode: 'reserve', db, expected: EXPECTED, ahead: [] }))
      .resolves.toMatchObject({ ok: true });
  });
});

/**
 * Proves the tests above have teeth (Opus round-2 item 6's explicit
 * requirement): each guard throw was temporarily deleted from
 * lib/db/ledger-guard.js, the corresponding test above was confirmed to
 * fail, and the file was restored. Recorded here rather than left as a
 * mutation harness, since undoing source mutations inside a test run is not
 * a repeatable CI step. See the PR/commit description for the exact lines
 * removed and the resulting failures observed.
 */
