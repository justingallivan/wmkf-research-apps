/** Explicit target checks for the materials upload operator CLI. */
import { isIP } from 'node:net';
const VERIFIED_SSLMODES = new Set(['require', 'verify-ca', 'verify-full']);

function normalizedHost(value) {
  return String(value || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/**
 * Resolve a production Postgres URL without returning or logging credentials.
 * The caller must separately assert the connected database identity before
 * issuing any materials-job query.
 */
export function productionMaterialsDatabaseConfig({
  env = process.env,
  expectedHost,
  expectedDatabase,
} = {}) {
  const connectionString = env.MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL;
  if (typeof connectionString !== 'string' || !connectionString.trim()) fail('production_database_url_missing');
  if (!expectedHost || !expectedDatabase) fail('production_target_confirmation_required');
  if (env.PGOPTIONS) fail('postgres_options_environment_refused');

  let parsedUrl;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    fail('production_database_url_invalid');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) fail('production_database_protocol_refused');
  const queryKeys = [...parsedUrl.searchParams.keys()].map((key) => key.toLowerCase());
  if (queryKeys.some((key) => key !== 'sslmode') || queryKeys.filter((key) => key === 'sslmode').length !== 1) {
    fail('production_database_url_override_refused');
  }

  const host = normalizedHost(parsedUrl.hostname);
  const path = parsedUrl.pathname.startsWith('/') ? parsedUrl.pathname.slice(1) : '';
  let database = '';
  let user = '';
  let password = '';
  try {
    database = decodeURIComponent(path);
    user = decodeURIComponent(parsedUrl.username);
    password = decodeURIComponent(parsedUrl.password);
  } catch {
    fail('production_database_url_invalid');
  }
  const port = String(parsedUrl.port || '');
  const sslmode = String(parsedUrl.searchParams.get('sslmode') || '').toLowerCase();
  const dnsHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host);
  if (!dnsHost || isIP(host) || !database || database.includes('/') || !user || !password
    || !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    fail('production_database_url_incomplete');
  }
  if (host !== normalizedHost(expectedHost) || database !== expectedDatabase) {
    fail('production_target_mismatch');
  }
  if (!VERIFIED_SSLMODES.has(sslmode)) fail('production_tls_verification_required');

  return {
    clientConfig: {
      host,
      port: Number(port),
      database,
      user,
      password,
      ssl: { rejectUnauthorized: true },
      // An explicit value prevents node-postgres from inheriting PGOPTIONS.
      options: '',
    },
    expectedDatabase: database,
  };
}

export async function assertMaterialsOperatorDatabaseIdentity(client, expectedDatabase) {
  const result = await client.query('SELECT current_database() AS database, current_schema() AS schema');
  if (result.rows?.[0]?.database !== expectedDatabase || result.rows?.[0]?.schema !== 'public') {
    fail('production_connected_identity_mismatch');
  }
}

export function productionMutationConfirmed({ jobId, action, confirmJob, confirmAction }) {
  return Boolean(confirmJob && confirmAction)
    && String(confirmJob).toLowerCase() === String(jobId).toLowerCase()
    && confirmAction === action;
}
