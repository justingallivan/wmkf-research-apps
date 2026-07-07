/**
 * Bridges Postgres user_profile_id ↔ Dataverse systemuserid.
 *
 * Matches on user_profiles.azure_email eq systemuser.internalemailaddress.
 * Results are cached in-process for a short TTL; call clearCache() after an
 * admin op that would shift mappings (profile email change, user disable).
 *
 * Handles the Tom → Beth remap identically to the sync script so the two
 * stay in lockstep.
 */

const { sql } = require('@vercel/postgres');
const { getAccessToken, createClient } = require('../dataverse/client');
const odata = require('../dataverse/core/odata.js');

const TTL_MS = 5 * 60 * 1000;

const USER_ID_OVERRIDES = {
  1: { action: 'skip', reason: 'Test User' },
  6: { action: 'remap', toId: 5, reason: 'Tom Rieker → Beth Pruitt' },
};

let cache = null;
let cacheAt = 0;

async function getClient() {
  const url = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
  if (!url) throw new Error('DYNAMICS_SANDBOX_URL / DYNAMICS_URL not set');
  const token = await getAccessToken(url);
  return createClient({ resourceUrl: url, token });
}

async function buildMap() {
  const client = await getClient();
  const profiles = (await sql`
    SELECT id, azure_email, is_active
    FROM user_profiles
    ORDER BY
      CASE WHEN is_active = true THEN 0 ELSE 1 END,
      id
  `).rows;
  const byProfile = new Map();
  const byUser = new Map();

  for (const p of profiles) {
    const override = USER_ID_OVERRIDES[p.id];
    if (override?.action === 'skip') {
      byProfile.set(p.id, { skip: true, reason: override.reason });
      continue;
    }
    const sourceProfile = override?.action === 'remap'
      ? profiles.find((x) => x.id === override.toId)
      : p;
    if (!sourceProfile?.azure_email) continue;
    const r = await client.get(
      `/systemusers?$filter=internalemailaddress eq '${odata.escape(sourceProfile.azure_email)}'&$select=systemuserid,fullname`,
    );
    if (!r?.ok) {
      throw new Error(`Dataverse systemusers lookup failed with status ${r?.status || 'unknown'}`);
    }
    const u = r.body?.value?.[0];
    if (!u) continue;
    byProfile.set(p.id, {
      systemuserid: u.systemuserid,
      fullname: u.fullname,
      remappedFromId: override?.action === 'remap' ? p.id : null,
    });
    if (!byUser.has(u.systemuserid)) byUser.set(u.systemuserid, p.id);
  }
  return { byProfile, byUser };
}

async function ensureCache() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  cache = await buildMap();
  cacheAt = Date.now();
  return cache;
}

async function resolveProfileToSystemUser(profileId) {
  const { byProfile } = await ensureCache();
  const entry = byProfile.get(profileId);
  if (!entry || entry.skip) return null;
  return entry;
}

async function resolveSystemUserToProfile(systemuserid) {
  const { byUser } = await ensureCache();
  return byUser.get(systemuserid) || null;
}

function clearCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = {
  resolveProfileToSystemUser,
  resolveSystemUserToProfile,
  clearCache,
};
