/** Resource pins for the one-off no-CRM speaker rehearsal. */
export const REHEARSAL_NEON_PROJECT_ID = 'dawn-paper-09421078';
export const REHEARSAL_NEON_HOST = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
export const REHEARSAL_NEON_DATABASE = 'neondb';
export const REHEARSAL_BLOB_STORE_ID = 'store_G5ZrBn1kcxzaBkyI';
export const REHEARSAL_BLOB_TOKEN_PREFIX = 'vercel_blob_rw_G5ZrBn1kcxzaBkyI_';

function parsePinnedDatabaseUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    const sslMode = (url.searchParams.get('sslmode') || '').toLowerCase();
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
        || url.hostname.toLowerCase() !== REHEARSAL_NEON_HOST
        || url.pathname !== `/${REHEARSAL_NEON_DATABASE}`
        || !url.username || !url.password
        || (url.port && url.port !== '5432')
        || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) return null;
    return url;
  } catch {
    return null;
  }
}

/** Validate the actual @vercel/postgres target plus any alternate DB URL and private Blob capability. */
export function validateMeetingTranscriptionRehearsalResources(env = process.env) {
  const primary = parsePinnedDatabaseUrl(env.POSTGRES_URL);
  const alternate = env.DATABASE_URL ? parsePinnedDatabaseUrl(env.DATABASE_URL) : null;
  const databaseReady = env.NEON_PROJECT_ID === REHEARSAL_NEON_PROJECT_ID
    && Boolean(primary)
    && (!env.DATABASE_URL || Boolean(alternate));
  const token = env.UPLOADS_BLOB_RW_TOKEN;
  const blobReady = typeof token === 'string' && token.startsWith(REHEARSAL_BLOB_TOKEN_PREFIX)
    && token.length > REHEARSAL_BLOB_TOKEN_PREFIX.length;
  return Object.freeze({
    ready: databaseReady && blobReady,
    databaseReady,
    blobReady,
    databaseHost: databaseReady ? REHEARSAL_NEON_HOST : null,
    database: databaseReady ? REHEARSAL_NEON_DATABASE : null,
    neonProjectId: databaseReady ? REHEARSAL_NEON_PROJECT_ID : null,
    blobStoreId: blobReady ? REHEARSAL_BLOB_STORE_ID : null,
  });
}
