/**
 * Dataverse-backed implementation of the user-preferences API.
 *
 * Source of truth for user preferences since the W3-W6 cutover (2026-05-12);
 * the Postgres `user_preferences` table was dropped that day. database-service.js
 * delegates all six prefs methods here unconditionally. `WAVE1_BACKEND_PREFS=postgres`
 * is no longer a supported opt-out: `assertWave1PrefsBackend()` throws at
 * module load if the env var is set (matches the
 * lib/services/grant-cycles-dataverse.js W3 guard pattern). The legacy
 * Postgres branches that were retained as "dead code pending follow-up"
 * have been deleted.
 *
 * Method shapes and encryption semantics mirror what the dropped Postgres
 * implementation used to expose (getUserPreferences, setUserPreference,
 * setUserPreferences, deleteUserPreference, getDecryptedApiKey, hasPreference).
 * The only difference is the underlying storage entity — Dataverse
 * wmkf_appuserpreferences via a DynamicsService-routed adapter.
 *
 * Failure mode: functions log and return falsy/empty on error, matching the
 * historical Postgres behavior — callers already handle that.
 */

const { encrypt, decrypt, maskValue } = require('../utils/encryption');
const { resolveProfileToSystemUser } = require('./dataverse-identity-map');
const userPreferenceAdapter = require('../dataverse/adapters/user-preference.js');

const ENCRYPTED_PREFERENCE_KEYS = [
  'api_key_claude',
  'api_key_orcid_client_id',
  'api_key_orcid_client_secret',
  'api_key_ncbi',
  'api_key_serp',
];

async function getUserPreferences(profileId, includeDecrypted = false) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return {};
    const { records } = await userPreferenceAdapter.listByOwner(user.systemuserid);
    const out = {};
    for (const row of records || []) {
      if (row.wmkf_isencrypted) {
        const plain = decrypt(row.wmkf_preferencevalue);
        out[row.wmkf_preferencekey] = includeDecrypted ? plain : maskValue(plain);
      } else {
        out[row.wmkf_preferencekey] = row.wmkf_preferencevalue;
      }
    }
    return out;
  } catch (error) {
    console.error('[dataverse-prefs] getUserPreferences error:', error.message);
    return {};
  }
}

async function setUserPreference(profileId, key, value, isEncrypted = null) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return false;

    if (isEncrypted === null) {
      isEncrypted = ENCRYPTED_PREFERENCE_KEYS.includes(key);
    }
    const storedValue = isEncrypted && value ? encrypt(value) : value;

    const existing = await userPreferenceAdapter.findByOwnerAndKey(user.systemuserid, key);

    const body = {
      wmkf_preferencevalue: storedValue,
      wmkf_isencrypted: !!isEncrypted,
    };

    if (existing) {
      await userPreferenceAdapter.update(existing.wmkf_appuserpreferenceid, body);
    } else {
      await userPreferenceAdapter.create({
        wmkf_preferencekey: key,
        ...body,
        'ownerid@odata.bind': `/systemusers(${user.systemuserid})`,
      });
    }
    return true;
  } catch (error) {
    console.error('[dataverse-prefs] setUserPreference error:', error.message);
    return false;
  }
}

async function setUserPreferences(profileId, preferences) {
  try {
    for (const [key, value] of Object.entries(preferences)) {
      if (value !== undefined) {
        await setUserPreference(profileId, key, value);
      }
    }
    return true;
  } catch (error) {
    console.error('[dataverse-prefs] setUserPreferences error:', error.message);
    return false;
  }
}

async function deleteUserPreference(profileId, key) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return false;
    const existing = await userPreferenceAdapter.findByOwnerAndKey(user.systemuserid, key);
    if (!existing) return true; // already absent
    await userPreferenceAdapter.remove(existing.wmkf_appuserpreferenceid);
    return true;
  } catch (error) {
    console.error('[dataverse-prefs] deleteUserPreference error:', error.message);
    return false;
  }
}

async function getDecryptedApiKey(profileId, key) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return null;
    const row = await userPreferenceAdapter.findByOwnerAndKey(user.systemuserid, key);
    if (!row) return null;
    return row.wmkf_isencrypted ? decrypt(row.wmkf_preferencevalue) : row.wmkf_preferencevalue;
  } catch (error) {
    console.error('[dataverse-prefs] getDecryptedApiKey error:', error.message);
    return null;
  }
}

async function hasPreference(profileId, key) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return false;
    const row = await userPreferenceAdapter.findByOwnerAndKey(user.systemuserid, key);
    return !!row && row.wmkf_preferencevalue != null && row.wmkf_preferencevalue !== '';
  } catch (error) {
    console.error('[dataverse-prefs] hasPreference error:', error.message);
    return false;
  }
}

module.exports = {
  ENCRYPTED_PREFERENCE_KEYS,
  getUserPreferences,
  setUserPreference,
  setUserPreferences,
  deleteUserPreference,
  getDecryptedApiKey,
  hasPreference,
};
