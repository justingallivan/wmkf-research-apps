#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const { getBootstrapGroups } = require('./setup-database');
const { bootstrapFreshDatabase } = require('./lib/fresh-database-bootstrap');

const EXPECTED_ENDPOINT_LABEL = 'ep-gentle-smoke-b77a6d90-pooler';
const ADMIN_EMAIL = 'jgallivan@wmkeck.org';
const ADMIN_AZURE_ID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const AUTH_TABLES = new Set([
  'account', 'invitation', 'jwks', 'member', 'organization', 'project_config',
  'session', 'user', 'verification',
]);
const EXPECTED_TRANSCRIPTION_CONSTRAINTS = [
  'transcription_jobs_state_check', 'transcription_jobs_owner_idempotency_unique',
  'transcription_jobs_lease_shape', 'transcription_jobs_attempt_shape',
  'transcription_jobs_submitting_shape', 'transcription_jobs_conflict_shape',
  'transcription_jobs_uncertain_shape', 'transcription_jobs_ready_shape',
  'transcription_jobs_purged_content_shape', 'transcription_jobs_digest_shape',
  'transcription_jobs_region_check', 'transcription_jobs_abandonment_shape',
];
const EXPECTED_TRANSCRIPTION_INDEXES = [
  'idx_transcription_jobs_global_active_slot', 'idx_transcription_jobs_owner_recent',
  'idx_transcription_jobs_worker_due', 'idx_transcription_jobs_cleanup_due',
  'idx_transcription_jobs_expiry_due',
];
const EXPECTED_TRANSCRIPTION_COLUMNS = [
  'id', 'owner_profile_id', 'idempotency_key', 'attempt_correlation_id', 'status',
  'lease_token', 'lease_expires_at', 'provider_transcript_id', 'output_pathname',
  'output_sha256', 'expires_at', 'receipt_expires_at', 'receipt_purged_at',
];

function parsePostgresUrl(value, label) {
  if (!value) throw new Error(`${label}_missing`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}_malformed`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${label}_protocol_invalid`);
  if (!url.hostname.endsWith('.neon.tech')) throw new Error(`${label}_not_neon`);
  if (!['require', 'verify-ca', 'verify-full'].includes((url.searchParams.get('sslmode') || '').toLowerCase())) {
    throw new Error(`${label}_tls_required`);
  }
  if (label === 'target_url' && ((url.port && url.port !== '5432') || url.pathname !== '/neondb' || !url.username || !url.password)) {
    throw new Error('target_url_shape_invalid');
  }
  return url;
}

function validateTarget(targetText, productionText) {
  let targetEnv;
  let productionEnv;
  try {
    targetEnv = parseEnv(targetText);
    productionEnv = parseEnv(productionText);
  } catch {
    throw new Error('environment_file_malformed');
  }
  const targetUrl = parsePostgresUrl(targetEnv.POSTGRES_URL, 'target_url');
  if (targetUrl.hostname.split('.')[0] !== EXPECTED_ENDPOINT_LABEL) {
    throw new Error('target_endpoint_mismatch');
  }
  const productionUrls = ['POSTGRES_URL', 'DATABASE_URL']
    .map((key) => productionEnv[key])
    .filter(Boolean)
    .map((value) => parsePostgresUrl(value, 'production_url'));
  if (!productionUrls.length) throw new Error('production_host_comparison_unavailable');
  const normalizeHost = (host) => host.toLowerCase().replace(/-pooler(?=\.)/, '');
  if (productionUrls.some((url) => normalizeHost(url.hostname) === normalizeHost(targetUrl.hostname))) {
    throw new Error('target_matches_local_production_host');
  }
  return targetUrl;
}

async function verifyCatalogIsExpected(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schemaname, c.relname AS relationname,
           c.relkind, pg_get_userbyid(c.relowner) AS relationowner
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%'
    ORDER BY n.nspname, c.relname
  `);
  const actualAuthTables = rows.filter((row) => row.schemaname === 'neon_auth' && ['r', 'p'].includes(row.relkind));
  const nonTableAuthRelations = rows.filter((row) => row.schemaname === 'neon_auth' && !['r', 'p'].includes(row.relkind));
  const otherRelations = rows.filter((row) => row.schemaname !== 'neon_auth');
  if (otherRelations.length || actualAuthTables.length !== AUTH_TABLES.size ||
      actualAuthTables.some((row) => row.relationowner !== 'neon_auth' || !AUTH_TABLES.has(row.relationname)) ||
      nonTableAuthRelations.some((row) => row.relationowner !== 'neon_auth')) {
    throw new Error('database_not_pristine_for_preview_bootstrap');
  }
}

async function readOnlyPreflight(client) {
  await client.query('BEGIN READ ONLY');
  try {
    const identity = await client.query('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== 'neondb') throw new Error('target_database_mismatch');
    const { rows } = await client.query('SHOW transaction_read_only');
    if (rows[0]?.transaction_read_only !== 'on') throw new Error('readonly_transaction_not_confirmed');
    await verifyCatalogIsExpected(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function seedAdmin(client) {
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE public.user_profiles, public.dynamics_user_roles IN EXCLUSIVE MODE');
    const profileState = await client.query(`
      SELECT COUNT(*)::int AS count,
             BOOL_OR(name = $1 OR azure_id = $2 OR azure_email = $1) AS identity_collision
      FROM public.user_profiles
    `, [ADMIN_EMAIL, ADMIN_AZURE_ID]);
    if (profileState.rows[0]?.count !== 0 || profileState.rows[0]?.identity_collision) {
      throw new Error('profile_seed_guard_failed');
    }
    const roleState = await client.query('SELECT COUNT(*)::int AS count FROM public.dynamics_user_roles');
    if (roleState.rows[0]?.count !== 0) throw new Error('role_seed_guard_failed');

    const inserted = await client.query(`
      INSERT INTO public.user_profiles (name, display_name, azure_id, azure_email, is_active, needs_linking)
      VALUES ($1, $1, $2, $1, TRUE, FALSE)
      RETURNING id
    `, [ADMIN_EMAIL, ADMIN_AZURE_ID]);
    if (inserted.rows.length !== 1) throw new Error('profile_seed_insert_failed');
    await client.query(`
      INSERT INTO public.dynamics_user_roles (user_profile_id, role, granted_by)
      VALUES ($1, 'superuser', NULL)
    `, [inserted.rows[0].id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function verifyBootstrapReadback(client) {
  const { readMigrationManifest, RETIRED_MIGRATIONS } = require('./lib/fresh-database-bootstrap');
  const manifest = readMigrationManifest();
  const tracker = await client.query('SELECT name, applied_by FROM public.schema_migrations ORDER BY name');
  const expectedAppliedBy = new Map(manifest.map((name) => [
    name,
    RETIRED_MIGRATIONS[name]
      ? 'setup-database.js (retired targets verified absent)'
      : 'setup-database.js (migration SQL executed)',
  ]));
  if (tracker.rows.length !== manifest.length ||
      tracker.rows.some((row) => expectedAppliedBy.get(row.name) !== row.applied_by)) {
    throw new Error('schema_readback_failed');
  }
  const schema = await client.query(`
    SELECT to_regclass('public.user_profiles') AS profiles,
           to_regclass('public.dynamics_user_roles') AS roles,
           to_regclass('public.transcription_jobs') AS transcription_jobs
  `);
  if (!schema.rows[0]?.profiles || !schema.rows[0]?.roles || !schema.rows[0]?.transcription_jobs) {
    throw new Error('schema_readback_failed');
  }
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='transcription_jobs'
  `);
  if (EXPECTED_TRANSCRIPTION_COLUMNS.some((name) => !columns.rows.some((row) => row.column_name === name))) {
    throw new Error('schema_readback_failed');
  }
  const constraints = await client.query(`
    SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid='public.transcription_jobs'::regclass
  `);
  if (EXPECTED_TRANSCRIPTION_CONSTRAINTS.some((name) => !constraints.rows.some((row) => row.conname === name))) {
    throw new Error('schema_readback_failed');
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='transcription_jobs'
  `);
  if (EXPECTED_TRANSCRIPTION_INDEXES.some((name) => !indexes.rows.some((row) => row.indexname === name))) {
    throw new Error('schema_readback_failed');
  }
}

async function verifySeedReadback(client) {
  const result = await client.query(`
    SELECT p.id, p.azure_id, p.azure_email, p.is_active, p.needs_linking, r.role
    FROM public.user_profiles p
    JOIN public.dynamics_user_roles r ON r.user_profile_id = p.id
    WHERE p.name = $1
  `, [ADMIN_EMAIL]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row.azure_id !== ADMIN_AZURE_ID || row.azure_email !== ADMIN_EMAIL ||
      row.is_active !== true || row.needs_linking !== false || row.role !== 'superuser') {
    throw new Error('seed_readback_failed');
  }
}

async function runPreviewBootstrap({ client, groups = getBootstrapGroups(), bootstrap = bootstrapFreshDatabase } = {}) {
  let stage = 'read_only_catalog_preflight';
  let schemaCommitted = false;
  let adminCommitted = false;
  try {
    await readOnlyPreflight(client);
    stage = 'schema_bootstrap';
    await bootstrap(client, groups);
    schemaCommitted = true;
    stage = 'schema_readback';
    await verifyBootstrapReadback(client);
    stage = 'admin_seed';
    await seedAdmin(client);
    adminCommitted = true;
    stage = 'admin_seed_readback';
    await verifySeedReadback(client);
    return { completed: true, schemaCommitted, adminCommitted };
  } catch (error) {
    const safeCode = /^[a-z0-9_]+$/i.test(error.message || '') ? error.message : 'unexpected_error';
    const failure = new Error(`preview_bootstrap_failed:${stage}:${safeCode}`);
    failure.receipt = { stage, schemaCommitAcknowledged: schemaCommitted, adminCommitAcknowledged: adminCommitted,
      note: 'Unacknowledged commits require read-only reconciliation; never retry automatically.' };
    throw failure;
  }
}

async function main() {
  const verifyOnly = process.argv[2] === '--verify-only';
  if (!verifyOnly && process.argv[2] !== '--confirm-empty-preview-bootstrap') {
    throw new Error('explicit_preview_bootstrap_confirmation_required');
  }
  const root = path.resolve(__dirname, '..');
  const targetText = fs.readFileSync(path.join(root, '.env.transcription-preview.local'), 'utf8');
  const productionText = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
  const targetUrl = validateTarget(targetText, productionText);
  const client = new Client({
    host: targetUrl.hostname,
    port: Number(targetUrl.port || 5432),
    user: decodeURIComponent(targetUrl.username),
    password: decodeURIComponent(targetUrl.password),
    database: targetUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    application_name: 'transcription-preview-bootstrap',
  });
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'operator';
    let receipt;
    if (verifyOnly) {
      stage = 'read_only_verification';
      await client.query('BEGIN READ ONLY');
      await verifyBootstrapReadback(client);
      await verifySeedReadback(client);
      const counts = await client.query(`SELECT
        (SELECT COUNT(*)::int FROM public.schema_migrations) AS migrations,
        (SELECT COUNT(*)::int FROM public.user_profiles) AS profiles,
        (SELECT COUNT(*)::int FROM public.dynamics_user_roles) AS roles,
        (SELECT COUNT(*)::int FROM public.transcription_jobs) AS jobs,
        (SELECT COUNT(*)::int FROM pg_catalog.pg_tables WHERE schemaname='neon_auth' AND tableowner='neon_auth') AS provider_auth_tables`);
      await client.query('COMMIT');
      receipt = { readOnlyVerified: true, ...counts.rows[0] };
    } else {
      receipt = await runPreviewBootstrap({ client });
    }
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    const message = /^[a-z0-9_:]+$/i.test(error.message || '') ? error.message : 'unexpected_error';
    process.stderr.write(`preview_bootstrap_failed:${stage}:${message}\n`);
    if (error.receipt) process.stderr.write(`${JSON.stringify(error.receipt)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    const code = /^[a-z0-9_]+$/i.test(error.message || '') ? error.message : 'unexpected_error';
    process.stderr.write(`preview_bootstrap_failed:target_validation:${code}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  AUTH_TABLES,
  EXPECTED_TRANSCRIPTION_COLUMNS,
  EXPECTED_TRANSCRIPTION_CONSTRAINTS,
  EXPECTED_TRANSCRIPTION_INDEXES,
  parsePostgresUrl,
  readOnlyPreflight,
  runPreviewBootstrap,
  seedAdmin,
  validateTarget,
  verifyBootstrapReadback,
  verifyCatalogIsExpected,
  verifySeedReadback,
};
