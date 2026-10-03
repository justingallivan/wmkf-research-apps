#!/usr/bin/env node
'use strict';

/**
 * Bounded fresh-install operator for the dedicated Meeting Tracker test Neon
 * database. Read-only preflight is the default. Schema creation requires the
 * explicit --execute flag and refuses any existing public tables.
 *
 * Never use this script for shared Preview/Production or for a populated DB.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const EXPECTED_NEON_PROJECT_ID = 'dawn-paper-09421078';
const EXPECTED_HOST = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
const EXPECTED_DATABASE = 'neondb';
const REQUIRED_TABLES = [
  'schema_migrations',
  'user_profiles',
  'dynamics_user_roles',
  'presentation_material_links',
  'presentation_material_uploads',
  'presentation_material_slot_leases',
  'transcription_jobs',
  'transcription_workflow_dispatches',
  'meeting_transcript_publications',
];
const REQUIRED_COLUMNS = {
  transcription_jobs: [
    'request_id', 'site_visit_activity_id', 'publication_operation_id', 'updated_by_profile_id',
  ],
  meeting_transcript_publications: ['closed_by_profile_id'],
};

function parseArgs(argv) {
  const options = { mode: 'preflight', envFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute' || arg === '--verify-only' || arg === '--self-test') {
      if (options.mode !== 'preflight' || options.selfTest) throw new Error('invalid_mode_options');
      options.mode = arg === '--execute' ? 'execute' : arg === '--verify-only' ? 'verify' : 'self-test';
      options.selfTest = arg === '--self-test';
    } else if (arg === '--env-file') {
      if (options.envFile || !argv[i + 1]) throw new Error('env_file_required');
      options.envFile = argv[++i];
    } else {
      throw new Error('unknown_argument');
    }
  }
  if (options.mode !== 'self-test' && !options.envFile) throw new Error('env_file_required');
  if (options.mode === 'self-test' && options.envFile) throw new Error('invalid_mode_options');
  return options;
}

function parseEnvText(text) {
  try {
    return parseEnv(text);
  } catch {
    throw new Error('environment_file_malformed');
  }
}

function parseTargetUrl(value) {
  if (!value) throw new Error('database_url_missing');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('database_url_malformed');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('database_url_protocol_invalid');
  if (url.hostname.toLowerCase() !== EXPECTED_HOST) throw new Error('target_host_mismatch');
  if (url.pathname !== `/${EXPECTED_DATABASE}`) throw new Error('target_database_mismatch');
  if (!url.username || !url.password || (url.port && url.port !== '5432')) throw new Error('database_url_shape_invalid');
  const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode)) throw new Error('target_tls_required');
  return url;
}

function configuredDatabaseUrls(env) {
  return Object.entries(env)
    .filter(([key, value]) => /^(?:POSTGRES|DATABASE)_URL(?:_|$)/.test(key) && value)
    .map(([, value]) => value);
}

function readEnvironmentFileIfPresent(filePath) {
  try {
    return parseEnvText(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function validateTarget(targetEnv, comparisonEnvs = []) {
  if (targetEnv.NEON_PROJECT_ID !== EXPECTED_NEON_PROJECT_ID) throw new Error('target_project_id_mismatch');
  const primary = targetEnv.POSTGRES_URL || targetEnv.DATABASE_URL;
  const targetUrl = parseTargetUrl(primary);
  for (const value of [targetEnv.POSTGRES_URL, targetEnv.DATABASE_URL].filter(Boolean)) {
    const other = parseTargetUrl(value);
    if (other.hostname !== targetUrl.hostname || other.pathname !== targetUrl.pathname) {
      throw new Error('target_database_urls_disagree');
    }
  }

  for (const env of comparisonEnvs) {
    for (const value of configuredDatabaseUrls(env)) {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error('comparison_database_url_malformed');
      }
      if (url.hostname.toLowerCase() === targetUrl.hostname.toLowerCase()) {
        throw new Error('target_matches_existing_neon_host');
      }
    }
  }
  return targetUrl;
}

function loadTargetAndComparisons(envFile) {
  const targetEnv = parseEnvText(fs.readFileSync(envFile, 'utf8'));
  const repoRoot = path.resolve(__dirname, '..');
  const comparisons = [
    readEnvironmentFileIfPresent(path.join(repoRoot, '.env.local')),
    readEnvironmentFileIfPresent(path.join(repoRoot, '.env.transcription-preview.local')),
  ];
  const url = validateTarget(targetEnv, comparisons);
  return { env: targetEnv, url };
}

function safeErrorCode(error) {
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.code || '')) return error.code;
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.message || '')) return error.message;
  return 'unexpected_error';
}

async function readPublicTables(client) {
  const result = await client.query(
    `SELECT tablename FROM pg_catalog.pg_tables
     WHERE schemaname = 'public' ORDER BY tablename LIMIT 10`,
  );
  return result.rows.map((row) => row.tablename);
}

async function verifyInitializedSchema(client, manifest, retiredMigrations) {
  const tracker = await client.query('SELECT name, applied_by FROM public.schema_migrations ORDER BY name');
  const expected = new Map(manifest.map((name) => [
    name,
    retiredMigrations[name]
      ? 'setup-database.js (retired targets verified absent)'
      : 'setup-database.js (migration SQL executed)',
  ]));
  if (tracker.rows.length !== manifest.length ||
      tracker.rows.some((row) => expected.get(row.name) !== row.applied_by)) {
    throw new Error('migration_tracker_readback_failed');
  }

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const tableNames = new Set(tables.rows.map((row) => row.table_name));
  if (REQUIRED_TABLES.some((name) => !tableNames.has(name))) throw new Error('required_table_missing');

  const columns = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)],
  );
  const actual = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
    if (names.some((name) => !actual.has(`${table}.${name}`))) throw new Error('required_column_missing');
  }
  return { migrationCount: tracker.rows.length, requiredTableCount: REQUIRED_TABLES.length };
}

async function runSelfTest() {
  const url = 'postgresql://operator:secret@ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech/neondb?sslmode=verify-full';
  const validEnv = { NEON_PROJECT_ID: EXPECTED_NEON_PROJECT_ID, POSTGRES_URL: url };
  assert.equal(validateTarget(validEnv).hostname, EXPECTED_HOST);
  assert.throws(() => validateTarget({ ...validEnv, NEON_PROJECT_ID: 'other-project' }), /target_project_id_mismatch/);
  assert.throws(() => validateTarget({ ...validEnv, POSTGRES_URL: url.replace('/neondb?', '/other?') }), /target_host_mismatch|target_database_mismatch/);
  assert.throws(() => validateTarget(validEnv, [{ DATABASE_URL: url }]), /target_matches_existing_neon_host/);
  assert.throws(() => validateTarget({ ...validEnv, POSTGRES_URL: url.replace('sslmode=verify-full', 'sslmode=disable') }), /target_tls_required/);
  process.stdout.write('meeting_transcription_test_bootstrap_self_test_passed\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === 'self-test') return runSelfTest();

  const { env, url } = loadTargetAndComparisons(options.envFile);
  const { Client } = require('pg');
  const { getBootstrapGroups } = require('./setup-database');
  const { bootstrapFreshDatabase, readMigrationManifest, RETIRED_MIGRATIONS } = require('./lib/fresh-database-bootstrap');
  const manifest = readMigrationManifest();
  const client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    query_timeout: 30000,
    application_name: 'meeting-transcription-test-bootstrap',
  });

  let stage = 'connect';
  try {
    await client.connect();
    stage = 'identity';
    const identity = await client.query('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== EXPECTED_DATABASE) throw new Error('target_database_mismatch');

    if (options.mode === 'verify') {
      stage = 'schema_readback';
      await client.query('BEGIN READ ONLY');
      const verified = await verifyInitializedSchema(client, manifest, RETIRED_MIGRATIONS);
      await client.query('COMMIT');
      process.stdout.write(`${JSON.stringify({ verified: true, neonProjectId: EXPECTED_NEON_PROJECT_ID, database: EXPECTED_DATABASE, ...verified })}\n`);
      return;
    }

    stage = 'empty_database_preflight';
    await client.query('BEGIN READ ONLY');
    const existingTables = await readPublicTables(client);
    await client.query('COMMIT');
    if (existingTables.length) throw new Error('public_schema_not_empty');
    if (options.mode === 'preflight') {
      process.stdout.write(`${JSON.stringify({ targetVerified: true, emptyPublicSchema: true, neonProjectId: EXPECTED_NEON_PROJECT_ID, database: EXPECTED_DATABASE })}\n`);
      return;
    }

    stage = 'schema_bootstrap';
    await bootstrapFreshDatabase(client, {
      ...getBootstrapGroups(),
      allowPopulatedSetup: false,
    });
    stage = 'schema_readback';
    await client.query('BEGIN READ ONLY');
    const verified = await verifyInitializedSchema(client, manifest, RETIRED_MIGRATIONS);
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ initialized: true, neonProjectId: EXPECTED_NEON_PROJECT_ID, database: EXPECTED_DATABASE, ...verified })}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    process.stderr.write(`meeting_transcription_test_bootstrap_failed:${stage}:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`meeting_transcription_test_bootstrap_failed:arguments:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_HOST, EXPECTED_NEON_PROJECT_ID, parseArgs, parseTargetUrl, validateTarget };
