/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import {
  LEDGER_MIGRATIONS_DIR,
  REGENERATE_COMMAND,
  compareLedgerFingerprint,
  formatLedgerDiff,
  listLedgerMigrationFiles,
  readExpectedFingerprint,
  readLedgerFingerprint,
} from '../../lib/db/ledger-schema';
import { decideFileAction, tableNamesIn, fingerprintFilesInScratch } from '../../lib/db/ledger-migrations';

/**
 * Live-Postgres proof that lib/db/ledger-schema-fingerprint.json equals "the
 * checkout's ledger migration files applied to an empty database". When a
 * ledger migration file changes, this fails until the file is regenerated
 * (see REGENERATE_COMMAND). SKIPPED unless TEST_REQUEST_LEDGER_TEST_URL is
 * set to a scratch/local Postgres (never the shared database).
 */
const TEST_URL = process.env.TEST_REQUEST_LEDGER_TEST_URL || '';
if (!TEST_URL && process.env.TEST_REQUEST_LEDGER_REQUIRE === '1') {
  throw new Error('TEST_REQUEST_LEDGER_REQUIRE=1 but TEST_REQUEST_LEDGER_TEST_URL is unset.');
}
if (/neon\.tech/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
  throw new Error('Refusing to run the ledger fingerprint proof against the shared Production/Preview database.');
}
const describeIf = TEST_URL ? describe : describe.skip;

describeIf('factory ledger schema fingerprint (live Postgres)', () => {
  const schema = `ledger_fp_${crypto.randomBytes(4).toString('hex')}`;
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    for (const f of listLedgerMigrationFiles()) {
      await client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'));
    }
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  });

  test('the tracked fingerprint equals the migration files applied to an empty schema', async () => {
    const expected = readExpectedFingerprint();
    const live = await readLedgerFingerprint(client);
    const diff = compareLedgerFingerprint(expected.fingerprint, live);
    const message = `lib/db/ledger-schema-fingerprint.json is stale for ${listLedgerMigrationFiles().join(', ')}:\n${formatLedgerDiff(diff)}\nRegenerate with: ${REGENERATE_COMMAND}`;
    expect({ ok: diff.ok && diff.extra.length === 0, message }).toEqual({ ok: true, message });
    expect(expected.generatedFrom).toEqual(listLedgerMigrationFiles());
  });

  test('re-applying every ledger migration file is idempotent (no baseline step needed by the runner)', async () => {
    for (const f of listLedgerMigrationFiles()) {
      await expect(client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'))).resolves.toBeDefined();
    }
    const again = await readLedgerFingerprint(client);
    expect(compareLedgerFingerprint(readExpectedFingerprint().fingerprint, again)).toMatchObject({ ok: true, extra: [] });
  });

  /**
   * Codex round-1 Fix 2: the fingerprint must notice semantic drift under a
   * STABLE object name, not just a renamed/missing object. Each case mutates
   * one object of its class under the same name the baseline used, then
   * proves compareLedgerFingerprint reports it as `differing` against the
   * pre-mutation baseline (never `ok`).
   */
  describe('mutation detection: same-named semantic drift is reported as differing', () => {
    let baseline;

    beforeAll(async () => {
      baseline = await readLedgerFingerprint(client);
    });

    afterEach(async () => {
      // Restore a clean baseline for the next mutation case.
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      for (const f of listLedgerMigrationFiles()) {
        await client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'));
      }
    });

    test('a CHECK body changed under the same constraint name', async () => {
      await client.query(`
        ALTER TABLE test_request_runs DROP CONSTRAINT test_request_runs_status_check;
        ALTER TABLE test_request_runs ADD CONSTRAINT test_request_runs_status_check
          CHECK (status IN ('pending', 'dispatched', 'verified'));
      `);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes('constraint test_request_runs.test_request_runs_status_check'))).toBe(true);
    });

    test('a column default changed under the same column name', async () => {
      await client.query("ALTER TABLE test_request_cast_bindings ALTER COLUMN status SET DEFAULT 'queued';");
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes('column test_request_cast_bindings.status'))).toBe(true);
    });

    test('a partial-index predicate changed under the same index name', async () => {
      const table = Object.keys(baseline.tables).find((t) => baseline.tables[t].indexes.some((i) => !i.primary && !i.unique));
      const target = baseline.tables[table].indexes.find((i) => !i.primary && !i.unique);
      await client.query(`DROP INDEX ${target.name};`);
      const rebuilt = target.definition.replace(/^CREATE INDEX [^ ]+ ON /, `CREATE INDEX ${target.name} ON `);
      await client.query(`${rebuilt} WHERE run_id IS NOT NULL;`);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes(`index ${table}.${target.name}`))).toBe(true);
    });

    test('index uniqueness changed under the same index name', async () => {
      const table = Object.keys(baseline.tables).find((t) => baseline.tables[t].indexes.some((i) => !i.primary && !i.unique));
      const target = baseline.tables[table].indexes.find((i) => !i.primary && !i.unique);
      await client.query(`DROP INDEX ${target.name};`);
      const col = target.definition.match(/\(([^)]+)\)\s*$/)?.[1] || target.definition.match(/\(([^)]+)\)/)[1];
      await client.query(`CREATE UNIQUE INDEX ${target.name} ON ${table} (${col});`);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes(`index ${table}.${target.name}`))).toBe(true);
    });

    test('the receipt function body changed under the same signature', async () => {
      await client.query(`
        CREATE OR REPLACE FUNCTION test_request_receipt_ok(receipt jsonb) RETURNS boolean AS $$
          SELECT receipt IS NOT NULL;
        $$ LANGUAGE sql IMMUTABLE;
      `);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes('function test_request_receipt_ok'))).toBe(true);
    });
  });

  /**
   * Codex round-1 Fix 3: a ledger that was hand-built from an OLDER shape of
   * 054 (before checksums existed) must not be silently adopted. Applies
   * 054 as of commit af65a24bd — before the changes that added the cast
   * tables and widened several CHECK bodies — into a scratch schema, then
   * runs the same adopt decision the migration runner uses against the
   * CURRENT checkout's files. It must refuse (drift), never adopt.
   */
  describe('historical-upgrade case: an older hand-built 054 shape refuses to adopt', () => {
    let gitAvailable = true;
    let historicalSql;
    beforeAll(() => {
      try {
        historicalSql = execFileSync('git', ['show', 'af65a24bd:lib/db/migrations/054_test_request_runs.sql'], { cwd: process.cwd(), encoding: 'utf8' });
      } catch {
        gitAvailable = false;
      }
    });

    (TEST_URL ? test : test.skip)('adopting against the current files refuses rather than silently baselining', async () => {
      if (!gitAvailable) return;
      const historicalSchema = `ledger_hist_${crypto.randomBytes(4).toString('hex')}`;
      const histClient = new Client({ connectionString: TEST_URL });
      await histClient.connect();
      try {
        await histClient.query(`CREATE SCHEMA ${historicalSchema}`);
        await histClient.query(`SET search_path TO ${historicalSchema}`);
        await histClient.query(historicalSql);

        const files = listLedgerMigrationFiles();
        const currentFile = files[0]; // 054_test_request_runs.sql
        const currentSql = fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, currentFile), 'utf8');
        const names = tableNamesIn(currentSql);
        const { rows } = await histClient.query(
          'SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1) LIMIT 1',
          [names],
        );
        const liveHasObjects = rows.length > 0;
        expect(liveHasObjects).toBe(true); // the historical shape already has test_request_runs etc.

        const scratchFp = await fingerprintFilesInScratch(histClient, [currentFile], LEDGER_MIGRATIONS_DIR, readLedgerFingerprint);
        const liveFp = await readLedgerFingerprint(histClient);
        const scratchDiff = compareLedgerFingerprint(scratchFp, liveFp);

        const decision = decideFileAction({
          file: currentFile,
          currentChecksum: 'irrelevant-for-untracked-path',
          trackedRow: null,
          liveHasObjects,
          scratchDiff,
        });
        expect(decision.action).toBe('refuse');
        expect(scratchDiff.missing.length + scratchDiff.differing.length).toBeGreaterThan(0);
      } finally {
        await histClient.query(`DROP SCHEMA IF EXISTS ${historicalSchema} CASCADE`).catch(() => {});
        await histClient.end();
      }
    });
  });
});
