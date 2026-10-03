/** @jest-environment node */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { bootstrapFreshDatabase, readMigrationManifest, RETIRED_MIGRATIONS } = require('../../scripts/lib/fresh-database-bootstrap');
const { getBootstrapGroups } = require('../../scripts/setup-database');

const TEST_URL = process.env.DATABASE_BOOTSTRAP_TEST_URL;

function requireLoopbackScratchUrl(rawUrl) {
  if (!rawUrl) return null;
  const parsed = new URL(rawUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || parsed.port !== '5433' || parsed.pathname !== '/ledger') {
    throw new Error('DATABASE_BOOTSTRAP_TEST_URL must target the known loopback:5433/ledger scratch service.');
  }
  if (parsed.search || parsed.hash) throw new Error('DATABASE_BOOTSTRAP_TEST_URL must not set connection options or fragments.');
  return parsed;
}

const adminUrl = requireLoopbackScratchUrl(TEST_URL);
const TEST_TIMEOUT = 120000;

async function createScratchDatabase(admin, createdNames) {
  const name = `bootstrap_${crypto.randomUUID().replace(/-/g, '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  createdNames.add(name);
  const databaseUrl = new URL(adminUrl.toString());
  databaseUrl.pathname = `/${name}`;
  return { name, connectionString: databaseUrl.toString() };
}

describe('fresh database bootstrap on isolated local Postgres', () => {
  (adminUrl ? test : test.skip)('executes manifest migrations, records honest tracker provenance, and rolls back failures', async () => {
    const admin = new Client({ connectionString: adminUrl.toString() });
    const createdNames = new Set();
    await admin.connect();
    try {
      const scratch = await createScratchDatabase(admin, createdNames);
      const client = new Client({ connectionString: scratch.connectionString });
      await client.connect();
      try {
        await client.query('SET search_path TO pg_catalog');
        await bootstrapFreshDatabase(client, getBootstrapGroups());

        const manifest = readMigrationManifest();
        const tracker = await client.query('SELECT name, applied_by FROM public.schema_migrations ORDER BY name');
        expect(tracker.rows.map((row) => row.name)).toEqual([...manifest].sort());
        for (const row of tracker.rows) {
          expect(row.applied_by).toBe(
            RETIRED_MIGRATIONS[row.name]
              ? 'setup-database.js (retired targets verified absent)'
              : 'setup-database.js (migration SQL executed)',
          );
        }

        const tableResult = await client.query(`
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND ((table_name = 'maintenance_runs' AND column_name IN ('started_at', 'completed_at'))
              OR (table_name = 'bill_webhook_events' AND column_name IN ('subscription_id', 'event_id')))
        `);
        expect(tableResult.rows.filter((row) => row.table_name === 'maintenance_runs'))
          .toEqual(expect.arrayContaining([
            expect.objectContaining({ column_name: 'started_at', data_type: 'timestamp with time zone' }),
            expect.objectContaining({ column_name: 'completed_at', data_type: 'timestamp with time zone' }),
          ]));
        expect(tableResult.rows.some((row) => row.table_name === 'bill_webhook_events' && row.column_name === 'subscription_id')).toBe(true);
        expect(tableResult.rows.some((row) => row.table_name === 'bill_webhook_events' && row.column_name === 'event_id')).toBe(true);

        const namedConstraints = await client.query(`
          SELECT conname FROM pg_constraint
          WHERE conrelid IN ('public.integrity_screening_reviews'::regclass, 'public.dynamics_explorer_requests'::regclass)
        `);
        const constraintNames = new Set(namedConstraints.rows.map((row) => row.conname));
        expect(constraintNames.has('integrity_screening_reviews_hold_notes')).toBe(true);
        expect(constraintNames.has('integrity_screening_reviews_notes_length')).toBe(true);
        expect(constraintNames.has('dynamics_explorer_requests_terminal_shape')).toBe(true);

        const retiredTargets = await client.query(`
          SELECT tablename FROM pg_catalog.pg_tables
          WHERE schemaname = 'public'
            AND tablename = ANY($1::text[])
        `, [[...new Set(Object.values(RETIRED_MIGRATIONS).flat())]]);
        expect(retiredTargets.rows).toEqual([]);

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-migration-runner-'));
        try {
          const rerun = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/apply-migrations.js')], {
            cwd: tempDir,
            env: { PATH: process.env.PATH, POSTGRES_URL: scratch.connectionString },
            encoding: 'utf8',
            timeout: 60000,
          });
          expect(rerun.status).toBe(0);
          expect(rerun.stdout).toContain(`Summary: 0 applied, ${manifest.length} skipped, ${manifest.length} total`);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }

        await expect(bootstrapFreshDatabase(client, getBootstrapGroups())).rejects.toThrow('Refusing fresh-install setup');
      } finally {
        await client.end();
      }

      const cliScratch = await createScratchDatabase(admin, createdNames);
      const cliCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-cli-'));
      let cliRun;
      try {
        cliRun = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/setup-database.js')], {
          cwd: cliCwd,
          env: { PATH: process.env.PATH, POSTGRES_URL: cliScratch.connectionString },
          encoding: 'utf8',
          timeout: 60000,
        });
      } finally {
        fs.rmSync(cliCwd, { recursive: true, force: true });
      }
      expect(cliRun.status).toBe(0);
      const cliCheck = new Client({ connectionString: cliScratch.connectionString });
      await cliCheck.connect();
      try {
        const cliTables = await cliCheck.query(`
          SELECT to_regclass('public.bill_webhook_events') AS bill_events,
                 to_regclass('public.bill_onboarding_state') AS bill_state,
                 (SELECT count(*) FROM public.schema_migrations) AS tracked
        `);
        expect(cliTables.rows[0].bill_events).toBe('bill_webhook_events');
        expect(cliTables.rows[0].bill_state).toBe('bill_onboarding_state');
        expect(Number(cliTables.rows[0].tracked)).toBe(readMigrationManifest().length);

        const billIndexes = await cliCheck.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename IN ('bill_webhook_events', 'bill_onboarding_state')
        `);
        const billIndexNames = new Set(billIndexes.rows.map((row) => row.indexname));
        expect(billIndexNames.has('idx_bill_webhook_events_received_at')).toBe(true);
        expect(billIndexNames.has('idx_bill_onboarding_pending')).toBe(true);
        expect(billIndexNames.has('idx_bill_onboarding_updated_at')).toBe(true);
      } finally {
        await cliCheck.end();
      }

      const retiredScratch = await createScratchDatabase(admin, createdNames);
      const retiredClient = new Client({ connectionString: retiredScratch.connectionString });
      await retiredClient.connect();
      try {
        const config = getBootstrapGroups();
        config.baseGroups = [...config.baseGroups, ['CREATE TABLE researchers (id INTEGER)']];
        await expect(bootstrapFreshDatabase(retiredClient, config)).rejects.toThrow(
          'Cannot classify 002_contact_enrichment.sql as retired; target tables exist: researchers',
        );
        const afterRetiredGuard = await retiredClient.query(`
          SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'
        `);
        expect(afterRetiredGuard.rows).toEqual([]);
      } finally {
        await retiredClient.end();
      }

      const rollbackScratch = await createScratchDatabase(admin, createdNames);
      const rollbackClient = new Client({ connectionString: rollbackScratch.connectionString });
      await rollbackClient.connect();
      try {
        await rollbackClient.query('SET search_path TO pg_catalog');
        const config = getBootstrapGroups();
        config.supplementalGroups = [['CREATE TABLE bootstrap_failure_probe(id INTEGER)', 'INVALID SQL']];
        await expect(bootstrapFreshDatabase(rollbackClient, config)).rejects.toThrow();
        const afterRollback = await rollbackClient.query(`
          SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'
        `);
        expect(afterRollback.rows).toEqual([]);
      } finally {
        await rollbackClient.end();
      }
    } finally {
      for (const name of createdNames) await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  }, TEST_TIMEOUT);
});
