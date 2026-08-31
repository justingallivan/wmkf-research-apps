/**
 * Thin wrapper over the system-settings storage backend.
 *
 * Routes unconditionally to Dataverse. The Postgres `system_settings` table
 * was dropped 2026-05-12 (Wave 1 closeout). `WAVE1_BACKEND_SETTINGS=postgres`
 * is no longer a supported opt-out — `assertWave1SettingsBackend()` throws
 * at module load if the env var is set (matches the
 * lib/services/grant-cycles-dataverse.js W3 guard pattern). The dead Postgres
 * branches that previously sat behind a `useDataverse()` dispatch have been
 * deleted.
 *
 * Consolidates the surface formerly scattered across:
 *   shared/config/baseConfig.js                — loadModelOverrides (prefix scan)
 *   lib/services/maintenance-service.js        — retention config read
 *   pages/api/admin/models.js                  — admin model-override CRUD
 *   pages/api/admin/secrets.js                 — secret-rotation CRUD (needs updatedAt)
 *   pages/api/cron/secret-check.js             — secret-check cron (prefix scan)
 *
 * Surface:
 *   getSetting(key)                            → string | null
 *   listSettings(prefix)                       → { [key]: value }
 *   listSettingsWithMeta(prefix)               → { [key]: { value, updatedAt } }
 *   listSettingsWithMetaStrict(prefix)         → same, but throws on backend failure
 *   createSettingStrict(key, value, profileId) → create-only; throws on duplicate/failure
 *   setSetting(key, value, updatedByProfileId) → bool
 *   setSettingIfUnchanged(key, value, revision, updatedByProfileId) → strict optimistic upsert
 *   deleteSetting(key)                         → bool (idempotent)
 */

// Load the Dataverse service via a require() whose path is built from a
// variable so the bundler can't statically trace it. This keeps the
// fs/path-using Dataverse client out of client bundles when settings-service
// is reached from client-adjacent code like shared/config/baseConfig.js.
// These dispatch helpers only ever run server-side.
let _dataverse;
function getDataverse() {
  if (_dataverse) return _dataverse;
  const modName = './dataverse-settings-service';
  _dataverse = require(modName);
  return _dataverse;
}

function assertWave1SettingsBackend() {
  if (process.env.WAVE1_BACKEND_SETTINGS === 'postgres') {
    throw new Error(
      'WAVE1_BACKEND_SETTINGS=postgres is no longer supported. ' +
        'system_settings was dropped 2026-05-12 (Wave 1 closeout). ' +
        'Remove the env var or set it to "dataverse" (the default).',
    );
  }
}
assertWave1SettingsBackend();

async function getSetting(key) {
  return getDataverse().getSetting(key);
}

// Throwing variant — distinguishes absent key from fetch failure. See
// dataverse-settings-service.getSettingStrict.
async function getSettingStrict(key) {
  return getDataverse().getSettingStrict(key);
}

async function listSettings(keyPrefix = '') {
  return getDataverse().listSettings(keyPrefix);
}

async function listSettingsWithMeta(keyPrefix = '') {
  return getDataverse().listSettingsWithMeta(keyPrefix);
}

async function listSettingsWithMetaStrict(keyPrefix = '') {
  return getDataverse().listSettingsWithMetaStrict(keyPrefix);
}

async function createSettingStrict(key, value, updatedByProfileId = null) {
  return getDataverse().createSettingStrict(key, value, updatedByProfileId);
}

async function setSetting(key, value, updatedByProfileId = null) {
  return getDataverse().setSetting(key, value, updatedByProfileId);
}

async function setSettingIfUnchanged(key, value, expectedRevision, updatedByProfileId = null) {
  return getDataverse().setSettingIfUnchanged(
    key,
    value,
    expectedRevision,
    updatedByProfileId,
  );
}

async function deleteSetting(key) {
  return getDataverse().deleteSetting(key);
}

module.exports = {
  getSetting,
  getSettingStrict,
  listSettings,
  listSettingsWithMeta,
  listSettingsWithMetaStrict,
  createSettingStrict,
  setSetting,
  setSettingIfUnchanged,
  deleteSetting,
};
