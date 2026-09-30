/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
});
