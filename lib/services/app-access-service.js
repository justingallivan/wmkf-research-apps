/**
 * Thin wrapper over the user-app-access storage backend.
 *
 * Routes unconditionally to Dataverse. The Postgres `user_app_access` table
 * was dropped 2026-05-12 (Wave 1 closeout). `WAVE1_BACKEND_APP_ACCESS=postgres`
 * is no longer a supported opt-out — `assertWave1AppAccessBackend()` throws at
 * module load if the env var is set (matches the
 * lib/services/grant-cycles-dataverse.js W3 guard pattern). The dead Postgres
 * branches that previously sat behind a `useDataverse()` dispatch have been
 * deleted.
 *
 * Consolidates the surface formerly scattered across:
 *   lib/utils/auth.js             — listAppKeysForUser on the hot path
 *   pages/api/app-access.js       — admin CRUD + per-user GET
 *   pages/api/auth/[...nextauth]  — grantApps on first login (default grants)
 *
 * Surface kept minimal and matched to real call sites:
 *   listAppKeysForUser(profileId)                      → string[]
 *   listAllGrantsForAdmin()                            → [{ user_profile_id, user_name, azure_email, apps }]
 *   grantApps(profileId, appKeys, grantedByProfileId)  → { granted: string[], error? }
 *   revokeApps(profileId, appKeys)                     → { revoked: string[], error? }
 */

// Loaded via a variable-path require so the bundler can't statically trace
// it — keeps the Dataverse client out of client bundles when this wrapper
// is reached from client-adjacent code. Server-side only.
let _dataverse;
function getDataverse() {
  if (_dataverse) return _dataverse;
  const modName = './dataverse-app-access-service';
  // eslint-disable-next-line global-require, import/no-dynamic-require
  _dataverse = require(modName);
  return _dataverse;
}

function assertWave1AppAccessBackend() {
  if (process.env.WAVE1_BACKEND_APP_ACCESS === 'postgres') {
    throw new Error(
      'WAVE1_BACKEND_APP_ACCESS=postgres is no longer supported. ' +
        'user_app_access was dropped 2026-05-12 (Wave 1 closeout). ' +
        'Remove the env var or set it to "dataverse" (the default).',
    );
  }
}
assertWave1AppAccessBackend();

async function listAppKeysForUser(profileId) {
  return getDataverse().listAppKeysForUser(profileId);
}

async function listAllGrantsForAdmin() {
  return getDataverse().listAllGrantsForAdmin();
}

async function grantApps(profileId, appKeys, grantedByProfileId) {
  return getDataverse().grantApps(profileId, appKeys, grantedByProfileId);
}

async function revokeApps(profileId, appKeys) {
  return getDataverse().revokeApps(profileId, appKeys);
}

module.exports = {
  listAppKeysForUser,
  listAllGrantsForAdmin,
  grantApps,
  revokeApps,
};
