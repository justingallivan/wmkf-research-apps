#!/usr/bin/env node
'use strict';

// Read-only transcription release snapshot. This script reads only the
// explicitly supplied env file, reports allowlisted enablement states (never
// raw values), and uses a read-only Postgres transaction that is rolled back.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const MANIFEST_PATH = path.join(__dirname, '..', 'lib', 'db', 'migrations-manifest.json');
const TRANSCRIPTION_TABLES = [
  'transcription_jobs',
  'transcription_workflow_dispatches',
  'meeting_transcript_publications',
];
const FLAG_KEYS = [
  'TRANSCRIPTION_PILOT_ENABLED',
  'TRANSCRIPTION_SUBMISSIONS_ENABLED',
  'MEETING_TRACKER_TRANSCRIPTION_ACCESS',
  'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY',
  'MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY',
  'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED',
  'MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED',
  'POST_PRESENTATION_MATERIALS_SCHEMA_READY',
  'POST_PRESENTATION_MATERIALS_ACCESS',
];

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--env-file' || !argv[1]) {
    throw new Error('usage: node scripts/probe-transcription-release.js --env-file <path>');
  }
  return { envPath: argv[1] };
}

function safeFlagState(key, value) {
  if (value === undefined || value === '') return 'unset';
  if (key === 'TRANSCRIPTION_PILOT_ENABLED' || key === 'TRANSCRIPTION_SUBMISSIONS_ENABLED') {
    if (value === 'true' || value === 'false') return value;
    return 'unrecognized-redacted';
  }
  if (key === 'MEETING_TRACKER_TRANSCRIPTION_ACCESS'
      || key === 'POST_PRESENTATION_MATERIALS_ACCESS') {
    if (value === 'on' || value === 'off') return value;
    if (/^test:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return 'test-pinned';
    }
    return 'unrecognized-redacted';
  }
  if (value === 'on' || value === 'off') return value;
  return 'unrecognized-redacted';
}

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(parsed.files) || parsed.files.some((name) => typeof name !== 'string')) {
    throw new Error('migration_manifest_invalid');
  }
  return parsed.files;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function readSnapshot(env) {
  const connectionString = env.POSTGRES_URL || env.DATABASE_URL;
  if (!connectionString) throw new Error('database_url_unavailable');

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    application_name: 'transcription-release-readonly-probe',
  });
  let transactionOpen = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('read_only_transaction_not_confirmed');
    }

    const expectedMigrations = readManifest();
    const ledgerPresent = (await client.query(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
    )).rows[0].present;
    let migrationLedger;
    if (ledgerPresent) {
      const tracked = (await client.query(
        'SELECT name FROM public.schema_migrations ORDER BY name',
      )).rows.map((row) => row.name);
      const expected = new Set(expectedMigrations);
      const actual = new Set(tracked);
      migrationLedger = {
        present: true,
        expectedCount: expected.size,
        trackedCount: actual.size,
        missing: [...expected].filter((name) => !actual.has(name)).sort(),
        extra: [...actual].filter((name) => !expected.has(name)).sort(),
      };
    } else {
      migrationLedger = {
        present: false,
        expectedCount: new Set(expectedMigrations).size,
        trackedCount: 0,
        missing: [...new Set(expectedMigrations)].sort(),
        extra: [],
      };
    }

    const presentRows = (await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [TRANSCRIPTION_TABLES],
    )).rows;
    const presentTables = new Set(presentRows.map(({ table_name }) => table_name));
    const tables = {};
    for (const tableName of TRANSCRIPTION_TABLES) {
      if (!presentTables.has(tableName)) {
        tables[tableName] = { present: false };
        continue;
      }
      const columns = (await client.query(
        `SELECT column_name, data_type, udt_name, is_nullable,
                column_default, character_maximum_length, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [tableName],
      )).rows;
      const constraints = (await client.query(
        `SELECT c.conname AS name, c.contype AS type,
                pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
           FROM pg_catalog.pg_constraint AS c
           JOIN pg_catalog.pg_class AS t ON t.oid = c.conrelid
           JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = $1
          ORDER BY c.conname`,
        [tableName],
      )).rows;
      const indexes = (await client.query(
        `SELECT indexname AS name, indexdef AS definition
           FROM pg_catalog.pg_indexes
          WHERE schemaname = 'public' AND tablename = $1
          ORDER BY indexname`,
        [tableName],
      )).rows;
      const rowCount = (await client.query(
        `SELECT COUNT(*)::text AS exact_row_count FROM public.${quoteIdentifier(tableName)}`,
      )).rows[0].exact_row_count;
      tables[tableName] = { present: true, rowCount, columns, constraints, indexes };
    }

    await client.query('ROLLBACK');
    transactionOpen = false;
    return { migrationLedger, tables };
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  const { envPath } = parseArgs(process.argv.slice(2));
  let env;
  try {
    env = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  } catch {
    throw new Error('env_file_unavailable_or_invalid');
  }
  const flags = Object.fromEntries(FLAG_KEYS.map((key) => [key, safeFlagState(key, env[key])]));
  const snapshot = await readSnapshot(env);
  process.stdout.write(`${JSON.stringify({ flags, ...snapshot, readOnlyTransaction: true, rolledBack: true }, null, 2)}\n`);
}

main().catch((error) => {
  const code = /^[a-z0-9_]+$/.test(error.message) ? error.message : 'readonly_probe_failed';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
