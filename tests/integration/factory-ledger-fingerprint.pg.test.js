/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { SHARED_DATABASE_URL_VARS } from '../../lib/db/ledger-registry';
import {
  LEDGER_MIGRATIONS_DIR,
  REGENERATE_COMMAND,
  compareLedgerFingerprint,
  formatLedgerDiff,
  listLedgerMigrationFiles,
  readExpectedFingerprint,
  readLedgerFingerprint,
} from '../../lib/db/ledger-schema';
import {
  decideFileAction, fingerprintFilesInScratch, verifyTrackedPrefix, decideTrackedPrefixVerification,
} from '../../lib/db/ledger-migrations';

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

    // Codex round-3 #5: relation kind and RLS/policy state were not
    // fingerprinted at all — a table with FORCE RLS and an added policy
    // compared clean against the baseline.
    test('ENABLE ROW LEVEL SECURITY under the same table name is reported as differing', async () => {
      await client.query('ALTER TABLE test_request_runs ENABLE ROW LEVEL SECURITY;');
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing.some((d) => d.includes('table test_request_runs row security'))).toBe(true);
    });

    test('SET UNLOGGED is differing and cannot pass a later-file exemption or adoption', async () => {
      const tableName = 'test_request_status_changes';
      await client.query(`ALTER TABLE ${tableName} SET UNLOGGED;`);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.ok).toBe(false);
      expect(diff.differing).toContain(`table ${tableName} relpersistence (p → u)`);

      const prefixDecision = decideTrackedPrefixVerification({
        prefixDiff: { missing: [], differing: [], extra: [`table ${tableName}`] },
        approvedAhead: [],
        liveFingerprint: live,
        laterFilesFingerprint: baseline,
      });
      expect(prefixDecision.ok).toBe(false);
      expect(prefixDecision.reason).toMatch(/unapproved extra object/);

      const expectedTable = { tables: { [tableName]: baseline.tables[tableName] }, functions: [] };
      const liveTable = { tables: { [tableName]: live.tables[tableName] }, functions: [] };
      const adoptionDecision = decideFileAction({
        file: 'synthetic_later_test_request_file.sql',
        currentChecksum: 'irrelevant-for-untracked-path',
        trackedRow: null,
        beforeDiff: { missing: [], differing: [], extra: [`table ${tableName}`] },
        throughDiff: compareLedgerFingerprint(expectedTable, liveTable),
        approvedAhead: [],
        liveFingerprint: live,
      });
      expect(adoptionDecision.action).toBe('refuse');
      expect(adoptionDecision.reason).toMatch(/relpersistence/);
    });

    test('a CREATE POLICY under the same table is reported as extra', async () => {
      await client.query(`CREATE POLICY test_request_runs_all ON test_request_runs FOR SELECT USING (true);`);
      const live = await readLedgerFingerprint(client);
      const diff = compareLedgerFingerprint(baseline, live);
      expect(diff.extra.some((e) => e === 'policy test_request_runs.test_request_runs_all')).toBe(true);
    });
  });

  /**
   * Codex round-3 #2: a tracked row's matching checksum only proves the
   * migration file's TEXT hasn't changed — it says nothing about whether the
   * live ledger's objects still match what that file's SQL would produce.
   * Applies 054, mutates one CHECK constraint under the same name (a
   * live-only hand patch an unchanged, still-tracked file would never
   * reveal to decideFileAction's per-file loop, since that loop only
   * re-derives a comparison for UNTRACKED files), then calls the exported
   * orchestration function directly — not the CLI script — and proves it
   * refuses before any file would be considered.
   */
  describe('Codex round-3 #2: verifyTrackedPrefix catches live-only drift under a tracked, checksum-matching file', () => {
    afterEach(async () => {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      for (const f of listLedgerMigrationFiles()) {
        await client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'));
      }
    });

    test('054 is tracked and checksum-matching, but its live CHECK has drifted -> refuse', async () => {
      const file054 = listLedgerMigrationFiles()[0]; // 054_test_request_runs.sql
      await client.query(`
        ALTER TABLE test_request_runs DROP CONSTRAINT test_request_runs_status_check;
        ALTER TABLE test_request_runs ADD CONSTRAINT test_request_runs_status_check
          CHECK (status IN ('pending', 'dispatched', 'verified'));
      `);
      const result = await verifyTrackedPrefix(client, {
        // The tracked prefix is every ledger file the checkout applied to this
        // schema (054 alone before B4 merges, 054 + 058 after).
        trackedFiles: listLedgerMigrationFiles(),
        migrationsDir: LEDGER_MIGRATIONS_DIR,
        readLedgerFingerprint,
        approvedAhead: [],
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/drifted from the live ledger/);
    });

    test('054 tracked, checksum-matching, and untouched -> ok (nothing drifted)', async () => {
      const file054 = listLedgerMigrationFiles()[0];
      const result = await verifyTrackedPrefix(client, {
        // The tracked prefix is every ledger file the checkout applied to this
        // schema (054 alone before B4 merges, 054 + 058 after).
        trackedFiles: listLedgerMigrationFiles(),
        migrationsDir: LEDGER_MIGRATIONS_DIR,
        readLedgerFingerprint,
        approvedAhead: [],
      });
      expect(result).toEqual({ ok: true });
    });

    test('no tracked files -> ok (nothing to verify yet)', async () => {
      const result = await verifyTrackedPrefix(client, {
        trackedFiles: [],
        migrationsDir: LEDGER_MIGRATIONS_DIR,
        readLedgerFingerprint,
        approvedAhead: [],
      });
      expect(result).toEqual({ ok: true });
    });
  });

  /**
   * Opus round-3 M1: before this fix, a live-but-untracked LATER file (058,
   * applied by hand ahead of its tracker row) made verifyTrackedPrefix
   * refuse the WHOLE run — the 054 prefix's scratch fingerprint compared
   * against a live schema that also has 058's objects always finds them
   * "extra", and with an empty approvedAhead there is nothing to exempt
   * them. decideFileAction's own `adopt` path for 058 never got a chance to
   * run. This proves the fix: 058 (fetched from the B4 branch, since this
   * checkout does not have it yet) is applied directly to the live schema
   * without a tracker row; a scratch migrations directory containing BOTH
   * 054 and 058 stands in for what the checkout's `allFiles` will be once
   * 058 is merged, so laterFilesFingerprint can recognize the extra as
   * something a later file already explains.
   */
  describe('Opus round-3 M1: a live, untracked LATER file no longer blocks the whole run', () => {
    let gitAvailable = true;
    let file058Sql;
    let tempMigrationsDir;
    const FILE_054 = '054_test_request_runs.sql';
    const FILE_058 = '058_test_request_cast_slot_bindings.sql';

    beforeAll(() => {
      try {
        file058Sql = execFileSync('git', ['show', `origin/codex/factory-reviewer-b4-runtime:lib/db/migrations/${FILE_058}`], { cwd: process.cwd(), encoding: 'utf8' });
      } catch {
        gitAvailable = false;
        return;
      }
      tempMigrationsDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ledger-m1-'));
      fs.writeFileSync(path.join(tempMigrationsDir, FILE_054), fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, FILE_054), 'utf8'));
      fs.writeFileSync(path.join(tempMigrationsDir, FILE_058), file058Sql);
    });

    afterAll(() => {
      if (tempMigrationsDir) fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
    });

    afterEach(async () => {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      for (const f of listLedgerMigrationFiles()) {
        await client.query(fs.readFileSync(path.join(LEDGER_MIGRATIONS_DIR, f), 'utf8'));
      }
    });

    (TEST_URL ? test : test.skip)('054 tracked, 058 live-but-untracked, approvedAhead empty -> verifyTrackedPrefix ok, then decideFileAction adopts 058', async () => {
      if (!gitAvailable) return;
      // Simulate a ledger where 058 was hand-applied ahead of its tracker row.
      await client.query(file058Sql);

      const result = await verifyTrackedPrefix(client, {
        trackedFiles: [FILE_054],
        allFiles: [FILE_054, FILE_058],
        migrationsDir: tempMigrationsDir,
        readLedgerFingerprint,
        approvedAhead: [],
      });
      expect(result).toEqual({ ok: true });

      // Now prove decideFileAction's own per-file path reaches 'adopt' for
      // 058 — the fix's whole point is that this path gets a chance to run
      // at all, rather than the run refusing before it is ever reached.
      const beforeFp = await fingerprintFilesInScratch(client, [FILE_054], tempMigrationsDir, readLedgerFingerprint);
      const throughFp = await fingerprintFilesInScratch(client, [FILE_054, FILE_058], tempMigrationsDir, readLedgerFingerprint);
      const liveFingerprint = await readLedgerFingerprint(client);
      const beforeDiff = compareLedgerFingerprint(beforeFp, liveFingerprint);
      const throughDiff = compareLedgerFingerprint(throughFp, liveFingerprint);
      const decision = decideFileAction({
        file: FILE_058,
        currentChecksum: 'irrelevant-for-untracked-path',
        trackedRow: null,
        beforeDiff,
        throughDiff,
        approvedAhead: [],
        liveFingerprint,
      });
      expect(decision).toEqual({ action: 'adopt' });
    });
  });

  describe('prefix-state classification through the actual migration runner', () => {
    const FIRST = '001_test_request_factory_base.sql';
    const SECOND = '002_test_request_factory_extension.sql';
    const firstSql = `
      CREATE TABLE IF NOT EXISTS test_request_factory_base (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      );
    `;
    const secondSql = `
      CREATE TABLE IF NOT EXISTS test_request_factory_base (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS test_request_factory_extension (
        id UUID PRIMARY KEY,
        base_id UUID NOT NULL REFERENCES test_request_factory_base(id),
        note TEXT NOT NULL
      );
    `;
    const databases = [];
    let admin;

    const databaseUrl = (name) => {
      const parsed = new URL(TEST_URL);
      parsed.pathname = `/${name}`;
      return parsed.toString();
    };

    const createDatabase = async () => {
      const name = `ledger_runner_${crypto.randomBytes(6).toString('hex')}`;
      if (!/^[a-z0-9_]+$/.test(name)) throw new Error('unsafe generated database identifier');
      await admin.query(`CREATE DATABASE ${name}`);
      databases.push(name);
      return databaseUrl(name);
    };

    const migrationsDir = ({ includeSecond = false } = {}) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-runner-'));
      fs.writeFileSync(path.join(dir, FIRST), firstSql);
      if (includeSecond) fs.writeFileSync(path.join(dir, SECOND), secondSql);
      return dir;
    };

    const runRunner = (ledgerUrl, dir) => {
      const env = { ...process.env, TEST_REQUEST_SANDBOX_LEDGER_URL: ledgerUrl };
      // Keep every shared variable explicitly parseable and pointed at the
      // original scratch database so a developer's .env.local cannot alter
      // this subprocess's classification.
      for (const name of SHARED_DATABASE_URL_VARS) env[name] = TEST_URL;
      return spawnSync(process.execPath, [
        path.join(process.cwd(), 'scripts/apply-ledger-migrations.js'),
        '--url-env=TEST_REQUEST_SANDBOX_LEDGER_URL',
        `--migrations-dir=${dir}`,
      ], { cwd: process.cwd(), env, encoding: 'utf8' });
    };

    beforeAll(async () => {
      admin = new Client({ connectionString: TEST_URL });
      await admin.connect();
    });

    afterAll(async () => {
      if (!admin) return;
      for (const name of databases) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      }
      await admin.end();
    });

    test('tracked first file only -> repeated CREATE plus a new table is applied and tracked', async () => {
      const ledgerUrl = await createDatabase();
      const dir = migrationsDir();
      try {
        expect(runRunner(ledgerUrl, dir).status).toBe(0);
        fs.writeFileSync(path.join(dir, SECOND), secondSql);
        const result = runRunner(ledgerUrl, dir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`[apply ok]  ${SECOND}`);

        const db = new Client({ connectionString: ledgerUrl });
        await db.connect();
        try {
          const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'test_request_factory_extension' ORDER BY ordinal_position");
          expect(columns.rows.map((r) => r.column_name)).toEqual(['id', 'base_id', 'note']);
          const tracked = await db.query('SELECT name FROM ledger_schema_migrations ORDER BY name');
          expect(tracked.rows.map((r) => r.name)).toEqual([FIRST, SECOND]);
        } finally {
          await db.end();
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('a partial second-file state with the new table in the wrong shape refuses', async () => {
      const ledgerUrl = await createDatabase();
      const dir = migrationsDir();
      try {
        expect(runRunner(ledgerUrl, dir).status).toBe(0);
        fs.writeFileSync(path.join(dir, SECOND), secondSql);
        const db = new Client({ connectionString: ledgerUrl });
        await db.connect();
        try {
          await db.query('CREATE TABLE test_request_factory_extension (id UUID PRIMARY KEY, wrong_column TEXT NOT NULL)');
        } finally {
          await db.end();
        }

        const result = runRunner(ledgerUrl, dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/\[refuse\]/);

        const verify = new Client({ connectionString: ledgerUrl });
        await verify.connect();
        try {
          const tracked = await verify.query('SELECT name FROM ledger_schema_migrations ORDER BY name');
          expect(tracked.rows.map((r) => r.name)).toEqual([FIRST]);
        } finally {
          await verify.end();
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('a fully-live second file is adopted and tracked without reapplying it', async () => {
      const ledgerUrl = await createDatabase();
      const dir = migrationsDir();
      try {
        expect(runRunner(ledgerUrl, dir).status).toBe(0);
        fs.writeFileSync(path.join(dir, SECOND), secondSql);
        const db = new Client({ connectionString: ledgerUrl });
        await db.connect();
        try {
          await db.query(secondSql);
        } finally {
          await db.end();
        }

        const result = runRunner(ledgerUrl, dir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`[adopt]     ${SECOND}`);

        const verify = new Client({ connectionString: ledgerUrl });
        await verify.connect();
        try {
          const tracked = await verify.query('SELECT name FROM ledger_schema_migrations ORDER BY name');
          expect(tracked.rows.map((r) => r.name)).toEqual([FIRST, SECOND]);
        } finally {
          await verify.end();
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
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
        const beforeFp = { tables: {}, functions: [] };
        const throughFp = await fingerprintFilesInScratch(histClient, [currentFile], LEDGER_MIGRATIONS_DIR, readLedgerFingerprint);
        const liveFp = await readLedgerFingerprint(histClient);
        const beforeDiff = compareLedgerFingerprint(beforeFp, liveFp);
        const throughDiff = compareLedgerFingerprint(throughFp, liveFp);

        const decision = decideFileAction({
          file: currentFile,
          currentChecksum: 'irrelevant-for-untracked-path',
          trackedRow: null,
          beforeDiff,
          throughDiff,
          liveFingerprint: liveFp,
        });
        expect(decision.action).toBe('refuse');
        expect(throughDiff.missing.length + throughDiff.differing.length).toBeGreaterThan(0);
      } finally {
        await histClient.query(`DROP SCHEMA IF EXISTS ${historicalSchema} CASCADE`).catch(() => {});
        await histClient.end();
      }
    });
  });
});
