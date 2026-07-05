/**
 * PolicyFetcher — resolves a slot code (e.g., 'reviewer-coi') to its
 * currently-active wmkf_policyversion row.
 *
 * Pattern mirrors PromptResolver: 5-minute cache, single-flight via Map.
 * Unlike prompts, there is no bundled-fallback module — if Dynamics is
 * unreachable, callers should fail closed (a missed policy ack is a
 * compliance issue, not a UX inconvenience).
 *
 * Active-child sanity validation lives here so both /context (render-time)
 * and /respond (accept-time) share an identical contract:
 *   - Parent slot exists and is active
 *   - wmkf_activeversion lookup is non-null
 *   - The version row exists, belongs to the parent, and is itself active
 */

import { withDalContext } from '../dataverse/core/context.js';
import { queryActiveSlotByCode } from '../dataverse/adapters/policy.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // slotCode → { fetchedAt, policy }

/**
 * Resolve a single slot code to its active version.
 *
 * @param {string} slotCode - e.g., 'reviewer-coi'
 * @returns {Promise<{
 *   slotCode: string,
 *   parentId: string,
 *   parentDisplayName: string,
 *   activeVersionId: string,
 *   versionLabel: string,
 *   title: string,
 *   body: string,
 *   effectiveDate: string|null,
 *   fetchedAt: number,
 *   source: 'dynamics'|'cache',
 * }>}
 *
 * Throws on misconfiguration (no parent, no active version, mismatched parent,
 * inactive child). Callers should let these surface — see active-child sanity
 * rules in docs/REVIEWER_STAGE_2A_BUILD_PLAN.md §5.
 */
export async function getActivePolicy(slotCode) {
  if (!slotCode) throw new Error('PolicyFetcher.getActivePolicy: slotCode required');

  const cached = cache.get(slotCode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.policy, source: 'cache', fetchedAt: cached.fetchedAt };
  }

  const policy = await withDalContext('policy-fetcher', async () => {
    const { records: parents } = await queryActiveSlotByCode(slotCode);

    if (parents.length === 0) {
      throw new Error(`PolicyFetcher: slot '${slotCode}' not found or inactive`);
    }
    const parent = parents[0];
    const child = parent.wmkf_ActiveVersion;
    if (!child) {
      throw new Error(`PolicyFetcher: slot '${slotCode}' has no active version configured`);
    }
    if (child.statecode !== 0) {
      throw new Error(`PolicyFetcher: slot '${slotCode}' active version ${child.wmkf_policyversionid} is not in Active state`);
    }
    if (child._wmkf_policy_value !== parent.wmkf_policyid) {
      throw new Error(
        `PolicyFetcher: slot '${slotCode}' active-version ${child.wmkf_policyversionid} does not belong to its parent — ` +
        `child.wmkf_policy=${child._wmkf_policy_value}, expected ${parent.wmkf_policyid}`,
      );
    }

    return {
      slotCode,
      parentId: parent.wmkf_policyid,
      parentDisplayName: parent.wmkf_displayname,
      activeVersionId: child.wmkf_policyversionid,
      versionLabel: child.wmkf_versionlabel,
      title: child.wmkf_policytitle,
      body: child.wmkf_policybody,
      effectiveDate: child.wmkf_effectivedate || null,
    };
  });

  const fetchedAt = Date.now();
  cache.set(slotCode, { fetchedAt, policy });
  return { ...policy, source: 'dynamics', fetchedAt };
}

/**
 * Resolve multiple slots in parallel. Common case: render time on Stage 2a.
 *
 * Returns an object keyed by slotCode. If any slot fails, the error
 * surfaces — partial success is not allowed at render time because
 * the page would render acks for some policies and not others, which is
 * worse than failing closed.
 */
export async function getActivePolicies(slotCodes) {
  if (!Array.isArray(slotCodes) || slotCodes.length === 0) {
    throw new Error('PolicyFetcher.getActivePolicies: slotCodes array required');
  }
  const resolved = await Promise.all(slotCodes.map(getActivePolicy));
  const out = {};
  for (let i = 0; i < slotCodes.length; i++) {
    out[slotCodes[i]] = resolved[i];
  }
  return out;
}

/**
 * Clear the cache. Test hook + invalidation surface for staff edits in
 * future builds.
 */
export function invalidate(slotCode) {
  if (slotCode) cache.delete(slotCode);
  else cache.clear();
}
