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
const {
  getMeetingTranscriptionSupervisedTestPolicy,
  MEETING_TRANSCRIPTION_SUPERVISED_TEST_DYNAMICS_ORIGIN,
} = require('./meeting-tracker-transcription/test-deployment-policy.js');

const TTL_MS = 5 * 60 * 1000;

const USER_ID_OVERRIDES = {
  1: { action: 'skip', reason: 'Test User' },
  6: { action: 'remap', toId: 5, reason: 'Tom Rieker → Beth Pruitt' },
};
const SUPERVISED_TEST_PROFILE_ID = 1;
const SUPERVISED_TEST_AZURE_OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const SYSTEMUSER_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cache = null;
let cacheAt = 0;
let supervisedTestProfileCache = null;
let supervisedTestProfileCacheAt = 0;

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

/**
 * Resolve the isolated test profile only for its app-grant read. This is
 * deliberately separate from the normal bidirectional email map: profile 1
 * remains skipped everywhere else, and its actor is never added to byUser.
 */
async function resolveSupervisedTestProfileForRead() {
  try {
    // Pin the actual URL getClient() will use, not merely one of the configured
    // aliases. Do this before acquiring a token or making a Dataverse request.
    const resolvedUrl = process.env.DYNAMICS_SANDBOX_URL || process.env.DYNAMICS_URL;
    let resolvedOrigin;
    try {
      const parsed = new URL(resolvedUrl);
      if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
      if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;
      resolvedOrigin = parsed.origin;
    } catch {
      return null;
    }
    if (resolvedOrigin !== MEETING_TRANSCRIPTION_SUPERVISED_TEST_DYNAMICS_ORIGIN) return null;

    if (supervisedTestProfileCache
      && Date.now() - supervisedTestProfileCacheAt < TTL_MS) {
      return supervisedTestProfileCache;
    }

    const profileResult = await sql`
      SELECT id, azure_id, is_active, needs_linking, dynamics_systemuser_id
      FROM user_profiles
      WHERE id = ${SUPERVISED_TEST_PROFILE_ID}
        AND azure_id = ${SUPERVISED_TEST_AZURE_OID}
      LIMIT 1
    `;
    const profile = profileResult.rows?.[0];
    if (!profile
      || Number(profile.id) !== SUPERVISED_TEST_PROFILE_ID
      || profile.azure_id?.toLowerCase() !== SUPERVISED_TEST_AZURE_OID
      || profile.is_active !== true
      || profile.needs_linking !== false
      || typeof profile.dynamics_systemuser_id !== 'string'
      || !SYSTEMUSER_GUID_RE.test(profile.dynamics_systemuser_id)) return null;

    const storedActorId = profile.dynamics_systemuser_id.toLowerCase();
    const client = await getClient();
    const result = await client.get(
      `/systemusers(${storedActorId})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled`,
    );
    if (!result?.ok) return null;
    const actor = result.body;
    if (!actor
      || typeof actor.systemuserid !== 'string'
      || actor.systemuserid.toLowerCase() !== storedActorId
      || typeof actor.azureactivedirectoryobjectid !== 'string'
      || actor.azureactivedirectoryobjectid.toLowerCase() !== SUPERVISED_TEST_AZURE_OID
      || actor.isdisabled !== false) return null;

    supervisedTestProfileCache = {
      systemuserid: storedActorId,
      fullname: actor.fullname || null,
      remappedFromId: null,
      identitySource: 'supervised-test-profile-guid',
    };
    supervisedTestProfileCacheAt = Date.now();
    return supervisedTestProfileCache;
  } catch {
    // The opt-in read may fail closed for profile 1 without invalidating or
    // partially caching the ordinary map used by every other profile.
    return null;
  }
}

async function ensureCache() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  cache = await buildMap();
  cacheAt = Date.now();
  return cache;
}

async function resolveProfileToSystemUser(profileId, { allowSupervisedTestRead = false } = {}) {
  if (profileId === SUPERVISED_TEST_PROFILE_ID && allowSupervisedTestRead) {
    let supervisedPolicyEnabled = false;
    try {
      supervisedPolicyEnabled = getMeetingTranscriptionSupervisedTestPolicy(process.env).enabled;
    } catch {
      // Policy evaluation failure leaves the profile-1 legacy skip in force.
    }
    if (supervisedPolicyEnabled) return resolveSupervisedTestProfileForRead();
  }
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
  supervisedTestProfileCache = null;
  supervisedTestProfileCacheAt = 0;
}

module.exports = {
  resolveProfileToSystemUser,
  resolveSystemUserToProfile,
  clearCache,
};
