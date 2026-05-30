/**
 * Dataverse-backed implementation of the system-settings table.
 *
 * Mirrors current Postgres reads/writes in:
 *   shared/config/baseConfig.js                  — loadModelOverrides (prefix scan)
 *   lib/services/maintenance-service.js          — retention config read
 *   pages/api/admin/models.js                    — admin model-override CRUD
 *   pages/api/admin/secrets.js                   — secret-rotation CRUD
 *   pages/api/cron/secret-check.js               — secret-check cron (prefix scan)
 *
 * Exposed:
 *   getSetting(key)                      → string | null
 *   listSettings(keyPrefix)              → { [key]: value }
 *   setSetting(key, value, updatedBy)    → upsert (accepts profileId; resolves via identity map)
 *   deleteSetting(key)                   → idempotent
 *
 * updated_by is informational. We accept a Postgres profileId and resolve
 * to systemuser internally; null/unresolvable → lookup omitted (matches
 * Postgres behavior where it's nullable).
 */

const { getAccessToken, createClient } = require('../dataverse/client');
const { resolveProfileToSystemUser } = require('./dataverse-identity-map');

async function getClient() {
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function findRow(client, key) {
  const filter = `wmkf_settingkey eq '${key.replace(/'/g, "''")}'`;
  const r = await client.get(
    `/wmkf_appsystemsettings?$filter=${encodeURIComponent(filter)}&$select=wmkf_appsystemsettingid,wmkf_settingvalue&$top=1`,
  );
  if (!r.ok) throw new Error(`find setting failed: ${r.status} ${r.text?.slice(0, 200)}`);
  return r.body?.value?.[0] || null;
}

async function getSetting(key) {
  try {
    const client = await getClient();
    const row = await findRow(client, key);
    return row ? row.wmkf_settingvalue : null;
  } catch (error) {
    console.error('[dataverse-settings] getSetting error:', error.message);
    return null;
  }
}

/**
 * Like getSetting but DOES NOT swallow fetch failures. Returns
 * { found, value } so callers can distinguish "key absent" (found: false)
 * from a Dynamics outage/auth failure (this throws). Money-adjacent reads
 * (e.g. the honorarium default amount) need this distinction so a transient
 * settings-service fault never silently looks like an absent key → a wrong
 * default. See docs/BILL_CHUNK_4_DESIGN.md (Codex pre-impl P1).
 */
async function getSettingStrict(key) {
  const client = await getClient();        // throws if env unset
  const row = await findRow(client, key);  // throws on HTTP failure
  return { found: row != null, value: row ? row.wmkf_settingvalue : null };
}

async function listSettings(keyPrefix = '') {
  try {
    const client = await getClient();
    const filter = keyPrefix
      ? `startswith(wmkf_settingkey,'${keyPrefix.replace(/'/g, "''")}')`
      : '';
    const path = `/wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue&$top=5000${filter ? `&$filter=${encodeURIComponent(filter)}` : ''}`;
    const r = await client.get(path);
    if (!r.ok) throw new Error(`list settings failed: ${r.status}`);
    const out = {};
    for (const row of r.body?.value || []) out[row.wmkf_settingkey] = row.wmkf_settingvalue;
    return out;
  } catch (error) {
    console.error('[dataverse-settings] listSettings error:', error.message);
    return {};
  }
}

async function listSettingsWithMeta(keyPrefix = '') {
  try {
    const client = await getClient();
    const filter = keyPrefix
      ? `startswith(wmkf_settingkey,'${keyPrefix.replace(/'/g, "''")}')`
      : '';
    const path = `/wmkf_appsystemsettings?$select=wmkf_settingkey,wmkf_settingvalue,modifiedon&$top=5000${filter ? `&$filter=${encodeURIComponent(filter)}` : ''}`;
    const r = await client.get(path);
    if (!r.ok) throw new Error(`list settings with meta failed: ${r.status}`);
    const out = {};
    for (const row of r.body?.value || []) {
      out[row.wmkf_settingkey] = {
        value: row.wmkf_settingvalue,
        updatedAt: row.modifiedon,
      };
    }
    return out;
  } catch (error) {
    console.error('[dataverse-settings] listSettingsWithMeta error:', error.message);
    return {};
  }
}

async function setSetting(key, value, updatedByProfileId = null) {
  try {
    const client = await getClient();
    const existing = await findRow(client, key);
    const updatedBy = updatedByProfileId != null
      ? await resolveProfileToSystemUser(updatedByProfileId)
      : null;

    const body = { wmkf_settingvalue: value };
    if (updatedBy) body['wmkf_UpdatedBy@odata.bind'] = `/systemusers(${updatedBy.systemuserid})`;

    if (existing) {
      const r = await client.patch(
        `/wmkf_appsystemsettings(${existing.wmkf_appsystemsettingid})`,
        body,
      );
      if (!r.ok) throw new Error(`patch setting failed: ${r.status} ${r.text?.slice(0, 200)}`);
    } else {
      const r = await client.post('/wmkf_appsystemsettings', {
        wmkf_settingkey: key,
        ...body,
      });
      if (!r.ok) throw new Error(`create setting failed: ${r.status} ${r.text?.slice(0, 200)}`);
    }
    return true;
  } catch (error) {
    console.error('[dataverse-settings] setSetting error:', error.message);
    return false;
  }
}

async function deleteSetting(key) {
  try {
    const client = await getClient();
    const existing = await findRow(client, key);
    if (!existing) return true;
    const r = await client.delete_(
      `/wmkf_appsystemsettings(${existing.wmkf_appsystemsettingid})`,
    );
    if (!r.ok) throw new Error(`delete setting failed: ${r.status}`);
    return true;
  } catch (error) {
    console.error('[dataverse-settings] deleteSetting error:', error.message);
    return false;
  }
}

module.exports = {
  getSetting,
  getSettingStrict,
  listSettings,
  listSettingsWithMeta,
  setSetting,
  deleteSetting,
};
