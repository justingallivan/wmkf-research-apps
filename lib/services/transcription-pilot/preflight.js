/** Read-only Preview readiness probe. This module never calls the worker or Blob. */
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
  return { checks, databaseUrl: checks.dedicatedDatabase ? primary : null };
}

export async function runTranscriptionPreflight({ env = process.env, createClient } = {}) {
  const { checks, databaseUrl } = validateTranscriptionPreflightEnv(env);
  const result = { ok: false, checks: { ...checks, readOnlyDatabase: false, expectedDatabase: false, zeroJobs: false }, jobs: null };
  if (!checks.previewDeployment || !checks.disabledFlags || !checks.dedicatedDatabase || !checks.dedicatedBlobStore
      || !checks.safeDataverseControls || !checks.dedicatedAuthOrigin || !checks.applicationSecretsPresent) return result;

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
    const count = await client.query('SELECT COUNT(*)::text AS count FROM public.transcription_jobs');
    result.checks.zeroJobs = count.rows[0]?.count === '0';
    if (!result.checks.zeroJobs) throw new Error('preflight_jobs_not_empty');
    await client.query('COMMIT');
    transactionOpen = false;
    result.ok = true;
    result.jobs = 0;
  } catch {
    result.ok = false;
    result.jobs = null;
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    if (client) await client.end().catch(() => {});
  }
  return result;
}
