/**
 * Deliberation briefing link lifecycle
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2, owner decisions D15–D17).
 *
 * One live link per request. `ensureLiveBriefingLink` is what Share calls
 * from the exact-preview path; `reissueBriefingLink` is the staff "Issue new
 * link" action. Tokens are audience-scoped JWTs from the shared external-token
 * primitive; the row stores the SHA-256 digest (verified on every external
 * request) and the token sealed with lib/utils/encryption.js so the same link
 * can be carried again. The raw token never reaches a log or a stored column.
 *
 * Every newly minted link expires exactly 60 days after issuance. Existing
 * live links retain the expiry embedded in their JWT until staff reissue them.
 */
import crypto from 'node:crypto';
import { mintScopedToken, hashToken } from '../external-token';
import { encrypt, decrypt } from '../../utils/encryption';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid.js';
import { isDeliberationBriefingSchemaReady } from '../../utils/deliberation-briefing-readiness.js';
import * as store from './briefing-link-store';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';

export const BRIEFING_AUDIENCE = 'briefing';
export const BRIEFING_OPS = Object.freeze(['view_briefing']);

const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEFING_LINK_DAYS = 60;

const REQUEST_SELECT = ['akoya_requestid'];

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isDeliberationBriefingSchemaReady,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  getLiveLink: store.getLiveLinkForRequest,
  insertLink: store.insertLink,
  replaceLiveLink: store.replaceLiveLink,
  mint: mintScopedToken,
  seal: encrypt,
  unseal: decrypt,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
});

function briefingError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}

export function getBriefingBaseUrl() {
  return String(process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

export function buildBriefingUrl(jwt) {
  return `${getBriefingBaseUrl()}/external/briefing/${jwt}`;
}

/**
 * Newly minted and deliberately reissued links are valid for exactly 60 days
 * from issuance. The value is fixed in both the JWT and the persisted row.
 */
export function computeBriefingExpiry({ now }) {
  const base = now instanceof Date ? now : new Date();
  return new Date(base.getTime() + BRIEFING_LINK_DAYS * DAY_MS);
}

/** Staff-facing projection: never includes the digest or ciphertext. */
export function projectBriefingLink(row, { url, unreadable = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    url: url || null,
    unreadable: unreadable === true,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by,
  };
}

function rowIsLive(row, now) {
  return Boolean(row) && !row.revoked_at && new Date(row.expires_at).getTime() > now.getTime();
}

/**
 * The sealed token, or null when it cannot be unsealed or no longer matches
 * the digest (encryption-key rotation, corrupted ciphertext). Callers treat
 * null as "replace this row"; it is never served.
 */
function tryUnsealUrl(row, dependencies) {
  let jwt = null;
  try {
    jwt = dependencies.unseal(row.token_ciphertext);
  } catch {
    jwt = null;
  }
  if (!jwt || hashToken(jwt) !== row.token_digest) return null;
  return buildBriefingUrl(jwt);
}

async function mintReplacement(requestId, actorId, dependencies) {
  const request = await dependencies.getRequest(requestId);
  if (!request || String(request.akoya_requestid).toLowerCase() !== requestId.toLowerCase()) {
    throw briefingError('The request could not be resolved.', 'briefing_request_not_found', 404);
  }
  const expiresAt = computeBriefingExpiry({ now: dependencies.now() });
  const { jwt, jti, hash } = await dependencies.mint({
    subject: requestId,
    audience: BRIEFING_AUDIENCE,
    ops: [...BRIEFING_OPS],
    expiresAt,
  });
  return {
    replacement: {
      id: dependencies.randomUUID(),
      jti,
      tokenDigest: hash,
      tokenCiphertext: dependencies.seal(jwt),
      expiresAt,
      createdBy: actorId,
    },
    url: buildBriefingUrl(jwt),
  };
}

function assertInputs(requestId, actorId, dependencies) {
  if (!dependencies.schemaReady()) {
    throw briefingError('The briefing page is not enabled in this environment.', 'briefing_schema_not_ready', 503);
  }
  if (!isGuid(requestId)) throw briefingError('requestId must be a GUID.', 'briefing_request_invalid', 400);
  if (!isGuid(actorId)) {
    throw briefingError('Your staff account is not linked to a Dynamics identity.', 'briefing_actor_required', 403);
  }
}

/**
 * Return the live link for a request, minting one when none is live. An
 * expired or unreadable live row is replaced in the same call. Idempotent for
 * a readable live row: the second call returns the same id and URL (the row
 * is read, not written).
 */
export async function ensureLiveBriefingLink({ requestId, actorId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertInputs(requestId, actorId, dependencies);
  const now = dependencies.now();
  const existing = await dependencies.getLiveLink(requestId);
  if (rowIsLive(existing, now)) {
    const url = tryUnsealUrl(existing, dependencies);
    if (url) return { link: projectBriefingLink(existing, { url }), reused: true };
    // Unreadable (key rotated or ciphertext damaged): it cannot be carried in
    // an email, so it is revoked and replaced rather than surfaced as an error.
  }
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  if (existing) {
    try {
      const row = await dependencies.replaceLiveLink(requestId, replacement, { revokedBy: actorId, expectedLiveId: existing.id });
      return { link: projectBriefingLink(row, { url }), reused: false };
    } catch (error) {
      // Another caller already replaced the expired/unreadable row: adopt its
      // live replacement instead of revoking it.
      if (error?.code !== 'briefing_link_superseded') throw error;
      const current = await dependencies.getLiveLink(requestId);
      const currentUrl = rowIsLive(current, dependencies.now()) ? tryUnsealUrl(current, dependencies) : null;
      if (!currentUrl) throw error;
      return { link: projectBriefingLink(current, { url: currentUrl }), reused: true };
    }
  }
  try {
    const row = await dependencies.insertLink({ ...replacement, requestId });
    return { link: projectBriefingLink(row, { url }), reused: false };
  } catch (error) {
    // Two first previews racing on the same request: the partial unique index
    // admits one; the loser adopts the winner's live row instead of failing.
    if (error?.code !== '23505') throw error;
    const winner = await dependencies.getLiveLink(requestId);
    if (!rowIsLive(winner, dependencies.now())) throw error;
    const winnerUrl = tryUnsealUrl(winner, dependencies);
    if (!winnerUrl) throw error;
    return { link: projectBriefingLink(winner, { url: winnerUrl }), reused: true };
  }
}

/**
 * D16: revoke the live link and issue a new one in one transaction. The
 * replacement always targets the row staff were looking at (`expectedLinkId`
 * is required, so a stale client cannot revoke a newer link); if another
 * action replaced it first the call returns 409 `briefing_link_superseded`
 * and the tab refreshes rather than revoking the newer link.
 */
export async function reissueBriefingLink({ requestId, actorId, expectedLinkId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertInputs(requestId, actorId, dependencies);
  if (!isGuid(expectedLinkId)) {
    throw briefingError('expectedLinkId must name the link being replaced.', 'briefing_expected_link_required', 400);
  }
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  const row = await dependencies.replaceLiveLink(requestId, replacement, { revokedBy: actorId, expectedLiveId: expectedLinkId });
  return { link: projectBriefingLink(row, { url }), reused: false };
}

/**
 * Staff read: the live link with its URL, or null. Flag off → null. A live
 * row whose sealed token cannot be read comes back with `url: null,
 * unreadable: true` so the tab can still offer "Issue new link".
 */
export async function getLiveBriefingLink({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) return null;
  if (!isGuid(requestId)) throw briefingError('requestId must be a GUID.', 'briefing_request_invalid', 400);
  const row = await dependencies.getLiveLink(requestId);
  if (!rowIsLive(row, dependencies.now())) return null;
  const url = tryUnsealUrl(row, dependencies);
  return projectBriefingLink(row, { url, unreadable: !url });
}

/**
 * Distribution-side liveness check: the attempt carried `briefingLinkId` at
 * preview; send refuses when that exact row is no longer the live link.
 */
export async function isBriefingLinkLive({ requestId, briefingLinkId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) return false;
  const row = await dependencies.getLiveLink(requestId);
  return rowIsLive(row, dependencies.now()) && String(row.id).toLowerCase() === String(briefingLinkId).toLowerCase();
}
