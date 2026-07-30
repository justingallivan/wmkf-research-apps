/**
 * Program Director resolver: bridges authenticated user → Dynamics systemuser.
 *
 * The authenticated user's azure email (from NextAuth session / user_profiles)
 * maps to a Dynamics `systemuser.systemuserid`. That GUID is the value we
 * filter on for `wmkf_programdirector` to find "my proposals" — see
 * memory `project_akoya_request_pd_fields.md` for why ownerid is the wrong
 * field.
 *
 * Cached per-process for 10 minutes; misses are also cached briefly to avoid
 * thrashing on user emails that aren't in Dynamics yet.
 */

import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import * as systemUserAdapter from '../dataverse/adapters/system-user.js';
import * as odata from '../dataverse/core/odata.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

const cache = new Map(); // email (lowercased) → { systemuserid, fullName, expiresAt }
const requestEmailCache = new Map(); // requestId → { email, expiresAt }

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

/**
 * Resolve an azure email to a Dynamics systemuser.
 * Returns { systemuserid, fullName } or null if no match.
 *
 * Caller is responsible for ensuring a Dynamics context is active (e.g.
 * via withDynamicsContext / bypassDynamicsRestrictions) before calling.
 */
export async function resolveByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) return null;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const escaped = odata.escape(key);
  const { records } = await systemUserAdapter.queryUsers({
    select: 'systemuserid,fullname,internalemailaddress,isdisabled',
    filter: `internalemailaddress eq '${escaped}' and isdisabled eq false`,
    top: 1,
  });

  const value = records.length > 0
    ? { systemuserid: records[0].systemuserid, fullName: records[0].fullname }
    : null;

  cache.set(key, {
    value,
    expiresAt: now + (value ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
  });

  return value;
}

export function clearResolverCache() {
  cache.clear();
  requestEmailCache.clear();
}

/**
 * Resolve the program director email for an akoya_request.
 *
 * Used by detection-alert paths (virus scanner, etc.) to route per-event
 * notifications to the PD who owns the related grant request.
 *
 * Returns the PD's `internalemailaddress` (lowercased) or null if the
 * request has no PD assigned, the PD is disabled, or any lookup step
 * fails. Caller treats a null return as "fall back to category routing."
 *
 * Caller is responsible for ensuring a Dynamics context is active.
 *
 * `skipCache` re-reads the assignment even when a warm entry exists (the entry is
 * still refreshed for later callers). Pass it when the answer decides a RECIPIENT
 * at the moment of a durable event rather than annotating an alert: within the
 * 10-minute TTL a reassignment or a disabled account would otherwise route the
 * notification to the former PD. Detection-alert callers can keep the cache.
 *
 * @param {string} requestId
 * @param {{ skipCache?: boolean }} [opts]
 */
export async function resolveProgramDirectorEmailForRequest(requestId, { skipCache = false } = {}) {
  if (!requestId || typeof requestId !== 'string') return null;
  const key = requestId.toLowerCase();

  const now = Date.now();
  const cached = requestEmailCache.get(key);
  if (!skipCache && cached && cached.expiresAt > now) {
    return cached.email;
  }

  let email = null;
  try {
    const request = await grantRequestAdapter.getById(requestId, {
      select: '_wmkf_programdirector_value',
    });
    const pdGuid = request?._wmkf_programdirector_value;
    if (pdGuid) {
      const pd = await systemUserAdapter.getByIdWithSelect(pdGuid, 'internalemailaddress,isdisabled');
      if (pd && pd.isdisabled === false && pd.internalemailaddress) {
        email = String(pd.internalemailaddress).trim().toLowerCase() || null;
      }
    }
  } catch (e) {
    // Swallow — null return signals the caller to use category fallback.
    // Logged at warn since this only fires on the rare detection path.
    console.warn(`[program-director-resolver] PD email lookup failed for request ${requestId}: ${e.message}`);
  }

  requestEmailCache.set(key, {
    email,
    expiresAt: now + (email ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return email;
}
