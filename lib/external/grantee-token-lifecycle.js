/**
 * Grantee deliverables portal — token lifecycle (stateless).
 *
 * Parallel grantee variant of `lib/external/token-lifecycle.js`. Deliberately
 * NOT reusing the reviewer lifecycle, which is hardcoded to
 * `wmkf_appreviewersuggestions`, `wmkf_external*` token-state fields, and
 * `/external/review/` URLs.
 *
 * Design (docs/GRANTEE_PORTAL_BUILD_PLAN.md chunk 1, owner + Codex pre-impl):
 * grantee tokens are STATELESS — a signed, audience-scoped JWT with a 30-day
 * expiry and NO stored hash / revocation. There is one deliverable package per
 * `akoya_request`, stored inline on the request, so the token's `sub` IS the
 * akoya_request GUID (there is no per-grantee child row). The compensating
 * guard for "no revocation" lives on the submit route (chunk 5): it refuses to
 * write once `wmkf_granteedeliverablestatus` is Complete, so a leaked or stale
 * link cannot overwrite a finalized package.
 *
 * The `aud:'grantee'` claim is what prevents a reviewer token (which carries no
 * `aud`) from being replayed on the grantee surface — verify-grantee-token.js
 * enforces it.
 */

import { mintScopedToken } from '../services/external-token';

export const GRANTEE_AUDIENCE = 'grantee';
export const DEFAULT_TTL_DAYS = 30;
// Decorative in chunk 1 (the route + status allowlist are the real authz); kept
// for primitive compatibility and future per-op enforcement.
export const GRANTEE_OPS = ['edit_abstract', 'upload_image'];

/**
 * Public grantee-portal base URL. Independent of the reviewer branded domain
 * (REVIEWER_PORTAL_BASE_URL): grantee links use GRANTEE_PORTAL_BASE_URL when
 * set, else fall back to NEXTAUTH_URL for existing environments.
 */
export function getGranteePortalBaseUrl() {
  return (process.env.GRANTEE_PORTAL_BASE_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

/** Build the public landing-page URL for a minted grantee JWT. */
export function buildGranteeUrl(jwt) {
  return `${getGranteePortalBaseUrl()}/external/grantee/${jwt}`;
}

/**
 * Mint a stateless grantee deliverables token for an akoya_request.
 *
 * @param {Object} args
 * @param {string} args.requestId - akoya_request GUID (becomes the `sub` claim)
 * @param {Date} [args.expiresAt] - hard expiry; defaults to now + DEFAULT_TTL_DAYS
 * @param {string[]} [args.ops] - operations granted; defaults to GRANTEE_OPS
 * @returns {Promise<{ jwt: string, jti: string, expiresAt: Date, url: string }>}
 */
export async function mintForRequest({ requestId, expiresAt, ops } = {}) {
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('mintForRequest: requestId required');
  }
  const exp = expiresAt instanceof Date
    ? expiresAt
    : new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { jwt, jti } = await mintScopedToken({
    subject: requestId,
    audience: GRANTEE_AUDIENCE,
    ops: Array.isArray(ops) && ops.length > 0 ? ops : GRANTEE_OPS,
    expiresAt: exp,
  });

  return { jwt, jti, expiresAt: exp, url: buildGranteeUrl(jwt) };
}
