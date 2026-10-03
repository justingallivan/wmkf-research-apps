'use strict';

const fs = require('fs');
const path = require('path');
const { assertFreshDatabase } = require('./database-bootstrap-guard');
const { stripOuterTxn } = require('../apply-migrations');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'lib/db/migrations');
const MANIFEST_PATH = path.join(REPO_ROOT, 'lib/db/migrations-manifest.json');

// These migrations describe tables intentionally removed from the current
// schema. They are recorded with distinct provenance only after verifying
// every target is absent; their SQL is never claimed as executed.
const RETIRED_MIGRATIONS = Object.freeze({
  '002_contact_enrichment.sql': ['researchers', 'reviewer_suggestions'],
  '007_drop_wave1_tables.sql': ['system_settings', 'user_app_access', 'user_preferences'],
  '014_drop_playing_with_neon.sql': ['playing_with_neon'],
  '018_drop_reviewer_finder_postgres_tables.sql': [
    'researchers',
    'researcher_keywords',
    'publications',
    'proposal_searches',
    'reviewer_suggestions',
  ],
});

function parseDotenv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && values[key] === undefined) values[key] = value;
  }
  return values;
}

function resolveDatabaseUrl({ env = process.env, dotenvText = null } = {}) {
  const explicitUrl = env.POSTGRES_URL || env.DATABASE_URL || null;
  const merged = { ...env };
  if (dotenvText !== null) {
    for (const [key, value] of Object.entries(parseDotenv(dotenvText))) {
      if (!merged[key]) merged[key] = value;
    }
  }
  const connectionString = explicitUrl || merged.POSTGRES_URL || merged.DATABASE_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL or DATABASE_URL is required (environment or .env.local).');
  }
  return connectionString;
}

function readMigrationManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error('Migration manifest must contain a files array.');
  }
  const actualFiles = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
  const listedFiles = [...manifest.files].sort();
  if (new Set(manifest.files).size !== manifest.files.length ||
      manifest.files.some((name, index) => name !== listedFiles[index]) ||
      actualFiles.length !== manifest.files.length ||
      actualFiles.some((name, index) => name !== listedFiles[index])) {
    throw new Error('Migration manifest must exactly list sorted SQL migration files before fresh bootstrap.');
  }
  return manifest.files;
}

async function assertRetiredTargetsAbsent(client, migrationName, targetTables) {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [targetTables],
  );
  if (result.rows.length) {
    throw new Error(
      `Cannot classify ${migrationName} as retired; target tables exist: ${result.rows.map((row) => row.table_name).join(', ')}`,
    );
  }
}

async function bootstrapFreshDatabase(client, {
  baseGroups,
  supplementalGroups,
  allowPopulatedSetup = false,
} = {}) {
  if (!Array.isArray(baseGroups) || !Array.isArray(supplementalGroups)) {
    throw new TypeError('Fresh bootstrap requires explicit baseGroups and supplementalGroups.');
  }
  const migrationFiles = readMigrationManifest();
  const filesOnDisk = new Set(migrationFiles);
  const unknownRetired = Object.keys(RETIRED_MIGRATIONS).filter((name) => !filesOnDisk.has(name));
  if (unknownRetired.length) {
    throw new Error(`Retired migration classification references absent files: ${unknownRetired.join(', ')}`);
  }

  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path TO public');
    const existing = await client.query(
      `SELECT tablename FROM pg_catalog.pg_tables
       WHERE schemaname = 'public' ORDER BY tablename LIMIT 10`,
    );
    assertFreshDatabase(existing.rows.map((row) => row.tablename), allowPopulatedSetup);

    for (const group of baseGroups) {
      for (const statement of group) await client.query(statement);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_by TEXT
      )
    `);

    const trackedRows = await client.query('SELECT name FROM schema_migrations');
    const tracked = new Set(trackedRows.rows.map((row) => row.name));
    for (const filename of migrationFiles) {
      if (tracked.has(filename)) continue;
      const retiredTargets = RETIRED_MIGRATIONS[filename];
      if (retiredTargets) {
        await assertRetiredTargetsAbsent(client, filename, retiredTargets);
        await client.query(
          `INSERT INTO schema_migrations (name, applied_by)
           VALUES ($1, $2)`,
          [filename, 'setup-database.js (retired targets verified absent)'],
        );
        continue;
      }

      const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      await client.query(stripOuterTxn(migrationSql));
      await client.query(
        `INSERT INTO schema_migrations (name, applied_by)
         VALUES ($1, $2)`,
        [filename, 'setup-database.js (migration SQL executed)'],
      );
    }

    for (const group of supplementalGroups) {
      for (const statement of group) await client.query(statement);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

module.exports = {
  RETIRED_MIGRATIONS,
  bootstrapFreshDatabase,
  readMigrationManifest,
  resolveDatabaseUrl,
};
