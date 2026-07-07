/**
 * Dataverse-backed implementation of the user-app-access table.
 *
 * Mirrors the current Postgres reads/writes scattered across:
 *   lib/utils/auth.js             — hot path, list keys for profileId
 *   pages/api/app-access.js       — admin CRUD + per-user GET
 *   pages/api/auth/[...nextauth]  — default grants on first login
 *
 * Four exported functions cover that surface:
 *   listAppKeysForUser(profileId)         → string[]
 *   listAllGrantsForAdmin()               → [{ userProfileId, userName, azureEmail, apps: string[] }]
 *   grantApps(profileId, appKeys, grantedBy)
 *   revokeApps(profileId, appKeys)
 *
 * The admin view crosses the Postgres-Dataverse boundary: user identity +
 * name + email still live in Postgres user_profiles (Wave 3+), so we read
 * that list and match each to Dataverse grants via the identity map.
 */

const { sql } = require('@vercel/postgres');
const { getAccessToken, createClient } = require('../dataverse/client');
const { resolveProfileToSystemUser, resolveSystemUserToProfile } = require('./dataverse-identity-map');
const odata = require('../dataverse/core/odata.js');
const { assertDataverseAccess } = require('./dynamics-context.js');

async function getClient() {
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function findRow(client, systemuserid, appKey) {
  // Guarded swap (OData Escape Consolidation Plan, owner ruling S331): reject a
  // non-string appKey BEFORE the escape to preserve the fail-closed throw the
  // hand-rolled `.replace` produced, rather than let odata.escape silently
  // coerce it via String().
  if (typeof appKey !== 'string') throw new TypeError('appKey must be a string');
  const filter = `_wmkf_user_value eq ${systemuserid} and wmkf_appkey eq '${odata.escape(appKey)}'`;
  const r = await client.get(
    `/wmkf_appuserappaccesses?$filter=${encodeURIComponent(filter)}&$select=wmkf_appuserappaccessid&$top=1`,
  );
  if (!r.ok) throw new Error(`find grant failed: ${r.status} ${r.text?.slice(0, 200)}`);
  return r.body?.value?.[0] || null;
}

async function listAppKeysForUser(profileId, { throwOnError = false } = {}) {
  try {
    assertDataverseAccess('app-access:read');
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return [];
    const client = await getClient();
    const filter = `_wmkf_user_value eq ${user.systemuserid}`;
    const r = await client.get(
      `/wmkf_appuserappaccesses?$filter=${encodeURIComponent(filter)}&$select=wmkf_appkey`,
    );
    if (!r.ok) throw new Error(`list grants failed: ${r.status}`);
    return (r.body?.value || []).map((row) => row.wmkf_appkey).sort();
  } catch (error) {
    console.error('[dataverse-app-access] listAppKeysForUser error:', error.message);
    // Callers that gate access (requireAppAccess) MUST distinguish "no grants"
    // from "lookup failed" so a transient error is never cached as an empty
    // grant set. Callers that only display grants keep the graceful [] default.
    if (throwOnError) throw error;
    return [];
  }
}

async function listAllGrantsForAdmin() {
  try {
    assertDataverseAccess('app-access:read');
    // user_profiles stays in Postgres for now.
    const profiles = (await sql`
      SELECT id, name, azure_email FROM user_profiles WHERE is_active = true ORDER BY name
    `).rows;

    const client = await getClient();
    // One pull of all grants — avoids N queries
    const r = await client.get(
      `/wmkf_appuserappaccesses?$select=wmkf_appkey,_wmkf_user_value&$top=5000`,
    );
    if (!r.ok) throw new Error(`list all grants failed: ${r.status}`);

    const appsByUserId = new Map();
    for (const row of r.body?.value || []) {
      const sid = row._wmkf_user_value;
      if (!sid) continue;
      const profileId = await resolveSystemUserToProfile(sid);
      if (profileId == null) continue;
      if (!appsByUserId.has(profileId)) appsByUserId.set(profileId, []);
      appsByUserId.get(profileId).push(row.wmkf_appkey);
    }

    return profiles.map((p) => ({
      user_profile_id: p.id,
      user_name: p.name,
      azure_email: p.azure_email,
      apps: (appsByUserId.get(p.id) || []).sort(),
    }));
  } catch (error) {
    console.error('[dataverse-app-access] listAllGrantsForAdmin error:', error.message);
    return [];
  }
}

async function grantApps(profileId, appKeys, grantedByProfileId) {
  assertDataverseAccess('app-access:write');
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return { granted: [], error: 'unmapped profile' };
    const grantedBy = grantedByProfileId != null
      ? await resolveProfileToSystemUser(grantedByProfileId)
      : null;

    const client = await getClient();
    const granted = [];

    for (const appKey of appKeys) {
      const existing = await findRow(client, user.systemuserid, appKey);
      if (existing) continue;
      const body = {
        wmkf_appkey: appKey,
        'wmkf_User@odata.bind': `/systemusers(${user.systemuserid})`,
      };
      if (grantedBy) body['wmkf_GrantedBy@odata.bind'] = `/systemusers(${grantedBy.systemuserid})`;
      const r = await client.post('/wmkf_appuserappaccesses', body);
      if (!r.ok) throw new Error(`grant failed (${appKey}): ${r.status} ${r.text?.slice(0, 200)}`);
      granted.push(appKey);
    }
    return { granted };
  } catch (error) {
    console.error('[dataverse-app-access] grantApps error:', error.message);
    return { granted: [], error: error.message };
  }
}

async function revokeApps(profileId, appKeys) {
  assertDataverseAccess('app-access:write');
  try {
    const user = await resolveProfileToSystemUser(profileId);
    if (!user) return { revoked: [], error: 'unmapped profile' };

    const client = await getClient();
    const revoked = [];

    for (const appKey of appKeys) {
      const existing = await findRow(client, user.systemuserid, appKey);
      if (!existing) continue;
      const r = await client.delete_(
        `/wmkf_appuserappaccesses(${existing.wmkf_appuserappaccessid})`,
      );
      if (!r.ok) throw new Error(`revoke failed (${appKey}): ${r.status}`);
      revoked.push(appKey);
    }
    return { revoked };
  } catch (error) {
    console.error('[dataverse-app-access] revokeApps error:', error.message);
    return { revoked: [], error: error.message };
  }
}

module.exports = {
  listAppKeysForUser,
  listAllGrantsForAdmin,
  grantApps,
  revokeApps,
  // exposed for tests (OData Escape Consolidation Plan guarded-swap pin)
  findRow,
};
