/**
 * Dataverse-backed implementation of the user-preferences API.
 *
 * Source of truth for user preferences since the W3-W6 cutover (2026-05-12);
 * the Postgres `user_preferences` table was dropped that day. database-service.js
 * dispatches all user-preference operations here by default
 * (`useDataversePrefs()` returns true unless `WAVE1_BACKEND_PREFS=postgres`).
 *
 * KNOWN HAZARD: setting `WAVE1_BACKEND_PREFS=postgres` does NOT fail loudly
 * today — `database-service.js`'s Postgres branch catches the dropped-table
 * SQL error and returns `{}`/false (see lib/services/database-service.js
 * lines 474-476, 511-513, 534-536, 556-558, 586-588, 611-613). The dispatch
 * comment at :43-47 says "fails loudly" but the catch blocks swallow the
 * error. So the opt-out silently returns empty preferences instead of
 * throwing. Real fail-loud behavior requires either removing the catches in
 * the dead Postgres branches or deleting them entirely.
 *
 * Method shapes and encryption semantics mirror what the dropped Postgres
 * implementation used to expose (getUserPreferences, setUserPreference,
 * setUserPreferences, deleteUserPreference, getDecryptedApiKey, hasPreference).
 * The only difference is the underlying storage entity — Dataverse
 * wmkf_appuserpreferences via DataverseClient.
 *
 * Failure mode: functions log and return falsy/empty on error, matching the
 * historical Postgres behavior — callers already handle that.
 */

const { getAccessToken, createClient } = require('../dataverse/client');
const { encrypt, decrypt, maskValue } = require('../utils/encryption');
const { resolveProfileToSystemUser } = require('./dataverse-identity-map');

const ENCRYPTED_PREFERENCE_KEYS = [
  'api_key_claude',
  'api_key_orcid_client_id',
  'api_key_orcid_client_secret',
  'api_key_ncbi',
  'api_key_serp',
];

async function getClient() {
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function findRow(client, systemuserid, key) {
  const filter = `_ownerid_value eq ${systemuserid} and wmkf_preferencekey eq '${key.replace(/'/g, "''")}'`;
  const r = await client.get(
    `/wmkf_appuserpreferences?$filter=${encodeURIComponent(filter)}&$select=wmkf_appuserpreferenceid,wmkf_preferencevalue,wmkf_isencrypted&$top=1`,
  );
  if (!r.ok) throw new Error(`find pref failed: ${r.status} ${r.text?.slice(0, 200)}`);
  return r.body?.value?.[0] || null;
}

async function getUserPreferences(profileId, includeDecrypted = false) {
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return {};
    const client = await getClient();
    const filter = `_ownerid_value eq ${user.systemuserid}`;
    const r = await client.get(
      `/wmkf_appuserpreferences?$filter=${encodeURIComponent(filter)}&$select=wmkf_preferencekey,wmkf_preferencevalue,wmkf_isencrypted`,
    );
    if (!r.ok) throw new Error(`list prefs failed: ${r.status}`);
    const out = {};
    for (const row of r.body?.value || []) {
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

    const client = await getClient();
    const existing = await findRow(client, user.systemuserid, key);

    const body = {
      wmkf_preferencevalue: storedValue,
      wmkf_isencrypted: !!isEncrypted,
    };

    if (existing) {
      const r = await client.patch(
        `/wmkf_appuserpreferences(${existing.wmkf_appuserpreferenceid})`,
        body,
      );
      if (!r.ok) throw new Error(`patch pref failed: ${r.status} ${r.text?.slice(0, 200)}`);
    } else {
      const r = await client.post('/wmkf_appuserpreferences', {
        wmkf_preferencekey: key,
        ...body,
        'ownerid@odata.bind': `/systemusers(${user.systemuserid})`,
      });
      if (!r.ok) throw new Error(`create pref failed: ${r.status} ${r.text?.slice(0, 200)}`);
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
    const client = await getClient();
    const existing = await findRow(client, user.systemuserid, key);
    if (!existing) return true; // already absent
    const r = await client.delete_(
      `/wmkf_appuserpreferences(${existing.wmkf_appuserpreferenceid})`,
    );
    if (!r.ok) throw new Error(`delete pref failed: ${r.status}`);
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
    const client = await getClient();
    const row = await findRow(client, user.systemuserid, key);
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
    const client = await getClient();
    const row = await findRow(client, user.systemuserid, key);
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
