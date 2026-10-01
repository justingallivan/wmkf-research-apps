#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { validateTarget,
  EXPECTED_TRANSCRIPTION_COLUMNS,
  EXPECTED_TRANSCRIPTION_CONSTRAINTS,
  EXPECTED_TRANSCRIPTION_INDEXES,
} = require('./bootstrap-transcription-preview');
const { RETIRED_MIGRATIONS } = require('./lib/fresh-database-bootstrap');
const { listMigrationFiles } = require('./apply-migrations');

const ROOT = path.resolve(__dirname, '..');
const TARGET_ENV_PATH = path.join(ROOT, '.env.transcription-preview.local');
const PRODUCTION_ENV_PATH = path.join(ROOT, '.env.local');
const APPLY_MIGRATIONS_PATH = path.join(__dirname, 'apply-migrations.js');
const EXPECTED_HOST = 'ep-gentle-smoke-b77a6d90-pooler.c-13.us-east-1.aws.neon.tech';
const EXPECTED_DATABASE = 'neondb';
const BASE_MIGRATION = '060_transcription_jobs.sql';
const TARGET_MIGRATION = '061_transcription_workflow_dispatches.sql';
const OUTBOX_COLUMNS = [
  'job_id', 'state', 'attempt_no', 'dispatch_token', 'lease_expires_at',
  'workflow_run_id', 'next_attempt_at', 'last_error_code', 'created_at', 'updated_at',
];
const OUTBOX_CONSTRAINTS = [
  'transcription_workflow_dispatches_pkey',
  'transcription_workflow_dispatches_job_id_fkey',
  'transcription_workflow_dispatches_state_check',
  'transcription_workflow_dispatches_attempt_no_check',
  'transcription_workflow_dispatches_last_error_code_check',
  'transcription_workflow_dispatch_lease_shape',
  'transcription_workflow_dispatch_run_shape',
];
const OUTBOX_INDEXES = ['transcription_workflow_dispatches_pkey', 'idx_transcription_workflow_dispatch_due'];

function assertDedicatedTarget(targetUrl) {
  if (targetUrl.hostname.toLowerCase() !== EXPECTED_HOST) throw new Error('target_host_mismatch');
  if (targetUrl.pathname !== `/${EXPECTED_DATABASE}` || (targetUrl.port && targetUrl.port !== '5432')) {
    throw new Error('target_database_shape_invalid');
  }
  const queryKeys = [...targetUrl.searchParams.keys()];
  if (queryKeys.some((key) => !['sslmode', 'channel_binding'].includes(key))) throw new Error('target_url_override_rejected');
  const channelBinding = targetUrl.searchParams.getAll('channel_binding');
  if (channelBinding.length > 1 || (channelBinding.length === 1 && channelBinding[0] !== 'require')) {
    throw new Error('target_url_override_rejected');
  }
  const sslModes = targetUrl.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || !['require', 'verify-ca', 'verify-full'].includes(sslModes[0].toLowerCase())) {
    throw new Error('target_tls_required');
  }
  if (!targetUrl.username || !targetUrl.password) throw new Error('target_credentials_missing');
  return targetUrl;
}

function readTargetUrl({ targetText, productionText }) {
  if (typeof targetText !== 'string' || typeof productionText !== 'string') throw new Error('environment_file_missing');
  return assertDedicatedTarget(validateTarget(targetText, productionText));
}

function createTargetClient(targetUrl) {
  return new Client({
    host: targetUrl.hostname,
    port: Number(targetUrl.port || 5432),
    user: decodeURIComponent(targetUrl.username),
    password: decodeURIComponent(targetUrl.password),
    database: EXPECTED_DATABASE,
    ssl: { rejectUnauthorized: true, servername: EXPECTED_HOST },
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    application_name: 'transcription-preview-migration-operator',
  });
}

function compareMigrationTracker(migrationFiles, trackedNames) {
  const files = [...migrationFiles].sort();
  const trackedRows = trackedNames.map((item) => (typeof item === 'string' ? { name: item } : item));
  const tracked = trackedRows.map((row) => row.name).sort();
  const retiredNames = Object.keys(RETIRED_MIGRATIONS).sort();
  if (new Set(files).size !== files.length || new Set(tracked).size !== tracked.length) {
    throw new Error('migration_tracker_duplicates');
  }
  if (!files.includes(BASE_MIGRATION) || !files.includes(TARGET_MIGRATION)) {
    throw new Error('migration_source_missing');
  }
  if (tracked.some((name) => !files.includes(name) && !retiredNames.includes(name))) {
    throw new Error('tracker_has_unknown_migration');
  }
  const retiredProvenance = 'setup-database.js (retired targets verified absent)';
  if (trackedRows.some((row) => retiredNames.includes(row.name) && row.applied_by !== retiredProvenance)) {
    throw new Error('retired_migration_provenance_mismatch');
  }
  if (retiredNames.some((name) => !tracked.includes(name))) throw new Error('retired_migration_untracked');
  const pending = files.filter((name) => !tracked.includes(name));
  if (pending.length === 1 && pending[0] === TARGET_MIGRATION) {
    if (!tracked.includes(BASE_MIGRATION)) throw new Error('base_migration_untracked');
    return { pendingMigrationFiles: pending, targetMigrationApplied: false };
  }
  if (pending.length === 0 && tracked.includes(TARGET_MIGRATION)) {
    return { pendingMigrationFiles: [], targetMigrationApplied: true };
  }
  throw new Error('migration_drift_or_other_pending_migrations');
}

function requireNames(required, rows, field) {
  const available = new Set(rows.map((row) => row[field]));
  if (required.some((name) => !available.has(name))) throw new Error('schema_readback_mismatch');
}

async function verifyJobsSchema(client) {
  const table = await client.query("SELECT to_regclass('public.transcription_jobs') AS table_name");
  if (!table.rows[0]?.table_name) throw new Error('base_schema_missing');
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transcription_jobs'
  `);
  requireNames(EXPECTED_TRANSCRIPTION_COLUMNS, columns.rows, 'column_name');
  const constraints = await client.query(`
    SELECT conname FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.transcription_jobs'::regclass
  `);
  requireNames(EXPECTED_TRANSCRIPTION_CONSTRAINTS, constraints.rows, 'conname');
  const indexes = await client.query(`
    SELECT indexname FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND tablename = 'transcription_jobs'
  `);
  requireNames(EXPECTED_TRANSCRIPTION_INDEXES, indexes.rows, 'indexname');
}

async function verifyOutboxSchema(client) {
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transcription_workflow_dispatches'
  `);
  const names = columns.rows.map((row) => row.column_name).sort();
  if (names.length !== OUTBOX_COLUMNS.length || OUTBOX_COLUMNS.some((name) => !names.includes(name))) {
    throw new Error('outbox_columns_mismatch');
  }
  const constraints = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.transcription_workflow_dispatches'::regclass
      AND contype <> 'n'
  `);
  if (constraints.rows.length !== OUTBOX_CONSTRAINTS.length) throw new Error('outbox_constraints_mismatch');
  requireNames(OUTBOX_CONSTRAINTS, constraints.rows, 'conname');
  const definitions = new Map(constraints.rows.map((row) => [row.conname, String(row.definition).toLowerCase()]));
  const stateCheck = definitions.get('transcription_workflow_dispatches_state_check') || '';
  const attemptCheck = definitions.get('transcription_workflow_dispatches_attempt_no_check') || '';
  const errorCheck = definitions.get('transcription_workflow_dispatches_last_error_code_check') || '';
  const leaseCheck = definitions.get('transcription_workflow_dispatch_lease_shape') || '';
  const runCheck = definitions.get('transcription_workflow_dispatch_run_shape') || '';
  const foreignKey = definitions.get('transcription_workflow_dispatches_job_id_fkey') || '';
  if (!foreignKey.includes('references transcription_jobs(id)') || !foreignKey.includes('on delete cascade')
    || !['pending', 'dispatching', 'running', 'completed'].every((state) => stateCheck.includes(`'${state}'`))
    || !/attempt_no\s*>=\s*0/.test(attemptCheck)
    || !errorCheck.includes("'^[a-z0-9_]{1,64}$'")
    || !/state\s*=\s*'dispatching'/.test(leaseCheck)
    || !/state\s*<>\s*'dispatching'/.test(leaseCheck)
    || !leaseCheck.includes('dispatch_token') || !leaseCheck.includes('lease_expires_at')
    || !/state\s*<>\s*'running'/.test(runCheck) || !runCheck.includes('workflow_run_id')) {
    throw new Error('outbox_constraints_mismatch');
  }
  const indexes = await client.query(`
    SELECT indexname, indexdef FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND tablename = 'transcription_workflow_dispatches'
  `);
  if (indexes.rows.length !== OUTBOX_INDEXES.length) throw new Error('outbox_indexes_mismatch');
  requireNames(OUTBOX_INDEXES, indexes.rows, 'indexname');
  const dueIndex = indexes.rows.find((row) => row.indexname === 'idx_transcription_workflow_dispatch_due');
  const indexDefinition = String(dueIndex?.indexdef || '').toLowerCase();
  if (!indexDefinition.includes('(next_attempt_at, created_at, job_id)')
      || !/where\s+\(*\s*state\s*=\s*any\s*\(array\[\s*'pending'::text\s*,\s*'dispatching'::text\s*\]\)\s*\)*$/.test(indexDefinition)) {
    throw new Error('outbox_indexes_mismatch');
  }
}

async function inspectPreviewTarget({ client, migrationFiles = listMigrationFiles() }) {
  await client.query('BEGIN READ ONLY');
  try {
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') throw new Error('readonly_transaction_not_confirmed');
    const identity = await client.query('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== EXPECTED_DATABASE) throw new Error('target_database_mismatch');
    const schema = await client.query(`
      SELECT to_regclass('public.schema_migrations') AS tracker,
             to_regclass('public.transcription_workflow_dispatches') AS outbox
    `);
    if (!schema.rows[0]?.tracker) throw new Error('migration_tracker_missing');
    await verifyJobsSchema(client);
    const retiredTargets = [...new Set(Object.values(RETIRED_MIGRATIONS).flat())];
    const retiredRelations = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [retiredTargets]);
    if (retiredRelations.rows.length) throw new Error('retired_migration_target_present');
    await client.query('SET LOCAL row_security = off');
    const jobs = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_jobs');
    if (jobs.rows[0]?.count !== '0') throw new Error('transcription_jobs_not_empty');
    const tracked = await client.query('SELECT name, applied_by FROM public.schema_migrations ORDER BY name');
    const reconciliation = compareMigrationTracker(migrationFiles, tracked.rows);
    const outboxExists = Boolean(schema.rows[0]?.outbox);
    if (reconciliation.targetMigrationApplied) {
      if (!outboxExists) throw new Error('tracked_outbox_missing');
      await verifyOutboxSchema(client);
      const outboxRows = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_workflow_dispatches');
      if (outboxRows.rows[0]?.count !== '0') throw new Error('outbox_not_empty');
    } else if (outboxExists) {
      throw new Error('untracked_outbox_exists');
    }
    await client.query('COMMIT');
    return {
      database: EXPECTED_DATABASE,
      readOnlyVerified: true,
      transcriptionJobs: 0,
      migrationTrackerMatchesDisk: true,
      pendingMigrationFiles: reconciliation.pendingMigrationFiles,
      targetMigrationApplied: reconciliation.targetMigrationApplied,
      outboxExists,
      outboxSchemaVerified: reconciliation.targetMigrationApplied,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

function executeCanonicalApply(connectionString, { spawn = spawnSync, tempRoot = os.tmpdir() } = {}) {
  const workingDirectory = fs.mkdtempSync(path.join(tempRoot, 'transcription-preview-migration-'));
  try {
    const result = spawn(process.execPath, [APPLY_MIGRATIONS_PATH], {
      cwd: workingDirectory,
      env: { POSTGRES_URL: connectionString, DATABASE_URL: connectionString },
      stdio: 'ignore',
      timeout: 180_000,
      windowsHide: true,
    });
    return { exitAcknowledged: !result.error && result.status === 0 };
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
}

function getTargetUrlFromFiles() {
  let targetText;
  let productionText;
  try {
    targetText = fs.readFileSync(TARGET_ENV_PATH, 'utf8');
    productionText = fs.readFileSync(PRODUCTION_ENV_PATH, 'utf8');
  } catch {
    throw new Error('environment_file_missing');
  }
  return readTargetUrl({ targetText, productionText });
}

function connectionStringForRunner(targetUrl) {
  const runnerUrl = new URL(targetUrl.toString());
  for (const key of [...runnerUrl.searchParams.keys()]) {
    if (key.toLowerCase() !== 'sslmode') runnerUrl.searchParams.delete(key);
  }
  // The canonical runner accepts a connection string; pin certificate and
  // hostname verification there because it does not take a pg.Client config.
  runnerUrl.searchParams.set('sslmode', 'verify-full');
  return runnerUrl.toString();
}

async function inspectWithFreshClient(targetUrl) {
  const client = createTargetClient(targetUrl);
  try {
    await client.connect();
    return await inspectPreviewTarget({ client });
  } catch (error) {
    if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) throw error;
    throw new Error('database_probe_failed');
  } finally {
    await client.end().catch(() => {});
  }
}

async function runOperator({ mode = 'probe', targetUrl, apply = executeCanonicalApply } = {}) {
  if (!['probe', 'apply', 'verify-only'].includes(mode)) throw new Error('mode_invalid');
  const initial = await inspectWithFreshClient(targetUrl);
  if (mode === 'verify-only') {
    if (!initial.targetMigrationApplied) throw new Error('target_migration_not_applied');
    return { mode, ...initial, appliedMigrationFile: TARGET_MIGRATION, verifiedOnly: true };
  }
  if (mode === 'probe') return { mode, ...initial, readyToApply: !initial.targetMigrationApplied };
  if (initial.targetMigrationApplied) throw new Error('already_applied_use_verify_only');
  if (initial.pendingMigrationFiles.length !== 1 || initial.pendingMigrationFiles[0] !== TARGET_MIGRATION) {
    throw new Error('apply_preflight_not_isolated');
  }

  // One invocation only. Regardless of its exit status, reconcile via a new
  // read-only connection; never retry after an ambiguous child-process result.
  let applyReceipt = { exitAcknowledged: false };
  try {
    applyReceipt = apply(connectionStringForRunner(targetUrl));
  } catch {
    // The child may have committed before its result became unavailable.
    // Continue only with read-only reconciliation; never invoke it again here.
  }
  const verification = await inspectWithFreshClient(targetUrl);
  if (!verification.targetMigrationApplied) {
    return {
      mode,
      applyAttempted: true,
      applyExitAcknowledged: applyReceipt.exitAcknowledged,
      readOnlyVerified: verification.readOnlyVerified,
      targetMigrationApplied: false,
      pendingMigrationFiles: verification.pendingMigrationFiles,
      automaticRetry: false,
    };
  }
  return {
    mode,
    applyAttempted: true,
    applyExitAcknowledged: applyReceipt.exitAcknowledged,
    ...verification,
    appliedMigrationFile: TARGET_MIGRATION,
    automaticRetry: false,
  };
}

async function main() {
  const arg = process.argv[2];
  const mode = arg === undefined ? 'probe'
    : arg === '--apply' ? 'apply'
      : arg === '--verify-only' ? 'verify-only' : null;
  if (!mode || process.argv.length > 3) throw new Error('mode_invalid');
  const targetUrl = getTargetUrlFromFiles();
  const result = await runOperator({ mode, targetUrl });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (mode === 'apply' && result.targetMigrationApplied !== true) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('transcription_preview_migration_failed\n');
    process.exitCode = 1;
  });
}

module.exports = {
  BASE_MIGRATION,
  EXPECTED_DATABASE,
  EXPECTED_HOST,
  OUTBOX_COLUMNS,
  OUTBOX_CONSTRAINTS,
  OUTBOX_INDEXES,
  TARGET_MIGRATION,
  assertDedicatedTarget,
  compareMigrationTracker,
  connectionStringForRunner,
  createTargetClient,
  executeCanonicalApply,
  inspectPreviewTarget,
  readTargetUrl,
  runOperator,
  verifyOutboxSchema,
};
