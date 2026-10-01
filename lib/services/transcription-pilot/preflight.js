/** Read-only isolated Preview/dedicated-project readiness probe; no worker or Blob calls. */
import {
  getTranscriptionPilotDeploymentProfile,
  isDedicatedTranscriptionAuthConfigured,
  TRANSCRIPTION_PILOT_PROFILE_VALUE,
  TRANSCRIPTION_PILOT_PROFILE_ENV,
} from './deployment-policy';

const EXPECTED_ENDPOINT_LABEL = 'ep-gentle-smoke-b77a6d90-pooler';
const EXPECTED_DATABASE_HOST = 'ep-gentle-smoke-b77a6d90-pooler.c-13.us-east-1.aws.neon.tech';
const EXPECTED_DATABASE = 'neondb';
const EXPECTED_BLOB_TOKEN_PREFIX = 'vercel_blob_rw_Qri02A1kj96tQYR9_';
const EXPECTED_PREVIEW_ORIGIN = 'https://wmkf-transcription-pilot.vercel.app';

function parseDedicatedDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    if (url.hostname !== EXPECTED_DATABASE_HOST || url.hostname.split('.')[0] !== EXPECTED_ENDPOINT_LABEL) return null;
    if (url.pathname !== `/${EXPECTED_DATABASE}` || !url.username || !url.password) return null;
    if (!['require', 'verify-ca', 'verify-full'].includes((url.searchParams.get('sslmode') || '').toLowerCase())) return null;
    if (url.port && url.port !== '5432') return null;
    return url;
  } catch {
    return null;
  }
}

export function validateTranscriptionPreflightEnv(env = process.env) {
  const profile = getTranscriptionPilotDeploymentProfile(env);
  if (profile.dedicated) return validateDedicatedProjectPreflightEnv(env, profile);

  const checks = {
    previewDeployment: env.VERCEL_ENV === 'preview',
    disabledFlags: env.TRANSCRIPTION_PILOT_ENABLED === 'false' && env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'false',
    dedicatedDatabase: false,
    dedicatedBlobStore: typeof env.UPLOADS_BLOB_RW_TOKEN === 'string'
      && env.UPLOADS_BLOB_RW_TOKEN.startsWith(EXPECTED_BLOB_TOKEN_PREFIX),
    safeDataverseControls: env.DATAVERSE_TARGET_INTERLOCK === 'on'
      && env.DATAVERSE_ALLOW_PROD_READS === 'no'
      && env.DATAVERSE_DAL_ENFORCEMENT === 'on',
    dedicatedAuthOrigin: env.NEXTAUTH_URL === EXPECTED_PREVIEW_ORIGIN,
    applicationSecretsPresent: typeof env.ASSEMBLYAI_API_KEY === 'string' && env.ASSEMBLYAI_API_KEY.trim().length > 0
      && typeof env.ASSEMBLYAI_WEBHOOK_SECRET === 'string' && Buffer.byteLength(env.ASSEMBLYAI_WEBHOOK_SECRET, 'utf8') >= 32
      && typeof env.TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY === 'string'
      && Buffer.byteLength(env.TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY, 'utf8') >= 32,
  };
  const primary = parseDedicatedDatabaseUrl(env.POSTGRES_URL);
  const alias = parseDedicatedDatabaseUrl(env.DATABASE_URL);
  checks.dedicatedDatabase = Boolean(primary && alias
    && primary.hostname === alias.hostname
    && primary.pathname === alias.pathname);
  return { checks, databaseUrl: checks.dedicatedDatabase ? primary : null, mode: 'preview' };
}

function validateDedicatedProjectPreflightEnv(env, profile) {
  const registeredProject = profile.registeredProject;
  const checks = {
    productionDeployment: env.VERCEL_ENV === 'production',
    dedicatedProjectProfile: env[TRANSCRIPTION_PILOT_PROFILE_ENV] === TRANSCRIPTION_PILOT_PROFILE_VALUE,
    dedicatedProjectIdentity: profile.identityVerified,
    disabledFlags: env.TRANSCRIPTION_PILOT_ENABLED === 'false' && env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'false',
    dedicatedDatabase: false,
    dedicatedBlobStore: typeof env.UPLOADS_BLOB_RW_TOKEN === 'string'
      && env.UPLOADS_BLOB_RW_TOKEN.startsWith(EXPECTED_BLOB_TOKEN_PREFIX),
    safeDataverseControls: env.DATAVERSE_TARGET_INTERLOCK === 'on'
      && env.DATAVERSE_ALLOW_PROD_READS === 'no'
      && env.DATAVERSE_DAL_ENFORCEMENT === 'on',
    dedicatedAuthOrigin: typeof registeredProject?.authOrigin === 'string'
      && env.NEXTAUTH_URL === registeredProject.authOrigin,
    safeAuthentication: isDedicatedTranscriptionAuthConfigured(env),
    applicationSecretsPresent: typeof env.ASSEMBLYAI_API_KEY === 'string' && env.ASSEMBLYAI_API_KEY.trim().length > 0
      && typeof env.ASSEMBLYAI_WEBHOOK_SECRET === 'string' && Buffer.byteLength(env.ASSEMBLYAI_WEBHOOK_SECRET, 'utf8') >= 32
      && typeof env.TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY === 'string'
      && Buffer.byteLength(env.TRANSCRIPTION_REFERENCE_ENCRYPTION_KEY, 'utf8') >= 32,
  };
  const primary = parseDedicatedDatabaseUrl(env.POSTGRES_URL);
  const alias = parseDedicatedDatabaseUrl(env.DATABASE_URL);
  checks.dedicatedDatabase = Boolean(primary && alias
    && primary.hostname === alias.hostname
    && primary.pathname === alias.pathname);
  return {
    checks,
    databaseUrl: checks.dedicatedDatabase ? primary : null,
    mode: 'dedicated-project',
  };
}

export async function runTranscriptionPreflight({ env = process.env, createClient } = {}) {
  const { checks, databaseUrl, mode } = validateTranscriptionPreflightEnv(env);
  const result = { ok: false, checks: {
    ...checks, readOnlyDatabase: false, expectedDatabase: false,
    workflowDispatchMigration: false, workflowDispatchShape: false,
    zeroJobs: false, zeroWorkflowDispatches: false,
  }, jobs: null, workflowDispatches: null };
  const nonDatabaseChecksPassed = mode === 'preview'
    ? checks.previewDeployment && checks.disabledFlags && checks.dedicatedDatabase && checks.dedicatedBlobStore
      && checks.safeDataverseControls && checks.dedicatedAuthOrigin && checks.applicationSecretsPresent
    : checks.productionDeployment && checks.dedicatedProjectProfile && checks.dedicatedProjectIdentity
      && checks.disabledFlags && checks.dedicatedDatabase && checks.dedicatedBlobStore
      && checks.safeDataverseControls && checks.dedicatedAuthOrigin && checks.safeAuthentication
      && checks.applicationSecretsPresent;
  if (!nonDatabaseChecksPassed) return result;

  let client;
  let transactionOpen = false;
  try {
    const makeClient = createClient || ((url) => {
      // Load the database driver only after all non-database safety checks pass.
      const { Client } = require('pg');
      return new Client({
        host: url.hostname,
        port: Number(url.port || 5432),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: EXPECTED_DATABASE,
        ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 10_000,
        query_timeout: 10_000,
        application_name: 'transcription-preview-readiness',
      });
    });
    client = makeClient(databaseUrl);
    await client.connect();
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    const readOnly = await client.query('SHOW transaction_read_only');
    result.checks.readOnlyDatabase = readOnly.rows[0]?.transaction_read_only === 'on';
    const identity = await client.query('SELECT current_database() AS database_name');
    result.checks.expectedDatabase = identity.rows[0]?.database_name === EXPECTED_DATABASE;
    if (!result.checks.readOnlyDatabase || !result.checks.expectedDatabase) throw new Error('preflight_database_guard_failed');
    await client.query('SET LOCAL row_security = off');
    const migration = await client.query(
      `SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name = $1) AS applied`,
      ['061_transcription_workflow_dispatches.sql']
    );
    result.checks.workflowDispatchMigration = migration.rows[0]?.applied === true;
    const shape = await client.query(`
      SELECT
        to_regclass('public.transcription_workflow_dispatches') IS NOT NULL AS table_present,
        (SELECT array_agg(column_name::text ORDER BY column_name::text COLLATE "C")
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transcription_workflow_dispatches')
          = ARRAY['attempt_no','created_at','dispatch_token','job_id','last_error_code','lease_expires_at','next_attempt_at','state','updated_at','workflow_run_id']::text[] AS columns_match,
        (SELECT array_agg(c.conname::text ORDER BY c.conname::text COLLATE "C") = ARRAY[
            'transcription_workflow_dispatch_lease_shape',
            'transcription_workflow_dispatch_run_shape',
            'transcription_workflow_dispatches_attempt_no_check',
            'transcription_workflow_dispatches_last_error_code_check',
            'transcription_workflow_dispatches_state_check'
          ]::text[] FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'transcription_workflow_dispatches'
            AND c.contype = 'c') AS constraints_match,
        EXISTS (SELECT 1 FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'transcription_workflow_dispatches'
            AND c.contype = 'p' AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (job_id)') AS primary_key_match,
        EXISTS (SELECT 1 FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'transcription_workflow_dispatches'
            AND c.contype = 'f' AND c.confrelid = to_regclass('public.transcription_jobs')
            AND c.confdeltype = 'c'
            AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attname = 'job_id' AND NOT a.attisdropped)]::smallint[]
            AND c.confkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = c.confrelid AND a.attname = 'id' AND NOT a.attisdropped)]::smallint[]) AS foreign_key_match,
        EXISTS (SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_transcription_workflow_dispatch_due'
            AND indexdef LIKE '%(next_attempt_at, created_at, job_id)%'
            AND indexdef LIKE '%WHERE%' AND indexdef LIKE '%pending%' AND indexdef LIKE '%dispatching%') AS due_index_present
    `);
    const shapeRow = shape.rows[0] || {};
    result.checks.workflowDispatchShape = shapeRow.table_present === true
      && shapeRow.columns_match === true && shapeRow.constraints_match === true
      && shapeRow.primary_key_match === true && shapeRow.foreign_key_match === true
      && shapeRow.due_index_present === true;
    if (!result.checks.workflowDispatchMigration || !result.checks.workflowDispatchShape) {
      throw new Error('preflight_workflow_dispatch_shape_failed');
    }
    const count = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_jobs');
    result.checks.zeroJobs = count.rows[0]?.count === '0';
    if (!result.checks.zeroJobs) throw new Error('preflight_jobs_not_empty');
    const dispatchCount = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_workflow_dispatches');
    result.checks.zeroWorkflowDispatches = dispatchCount.rows[0]?.count === '0';
    if (!result.checks.zeroWorkflowDispatches) throw new Error('preflight_workflow_dispatches_not_empty');
    await client.query('COMMIT');
    transactionOpen = false;
    result.ok = true;
    result.jobs = 0;
    result.workflowDispatches = 0;
  } catch {
    result.ok = false;
    result.jobs = null;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    if (client) await client.end().catch(() => {});
  }
  return result;
}
