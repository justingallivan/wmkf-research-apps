/**
 * Deliberation briefing link lifecycle
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2, owner decisions D15/D16).
 *
 * One live link per request. `ensureLiveBriefingLink` is what Share calls
 * from the exact-preview path; `reissueBriefingLink` is the staff "Issue new
 * link" action. Tokens are audience-scoped JWTs from the shared external-token
 * primitive; the row stores the SHA-256 digest (verified on every external
 * request) and the token sealed with lib/utils/encryption.js so the same link
 * can be carried again. The raw token never reaches a log or a stored column.
 *
 * Expiry [ASSUMED default, plan §2.2]: active site visit end + 7 days when a
 * visit exists; else wmkf_meetingdate + 7 days; else mint + 60 days.
 */
import crypto from 'node:crypto';
import { mintScopedToken, hashToken } from '../external-token';
import { encrypt, decrypt } from '../../utils/encryption';
import { ServiceHttpError } from '../service-http-error';
import { isGuid } from '../../utils/guid.js';
import { isDeliberationBriefingSchemaReady } from '../../utils/deliberation-briefing-readiness.js';
import * as store from './briefing-link-store';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';

export const BRIEFING_AUDIENCE = 'briefing';
export const BRIEFING_OPS = Object.freeze(['view_briefing']);

const DAY_MS = 24 * 60 * 60 * 1000;
const AFTER_VISIT_DAYS = 7;
const AFTER_MEETING_DAYS = 7;
const FALLBACK_DAYS = 60;
const MIN_TTL_MS = 60 * 60 * 1000;

const REQUEST_SELECT = ['akoya_requestid', 'wmkf_meetingdate'];

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isDeliberationBriefingSchemaReady,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT }),
  findActiveSiteVisit: async (requestId) => {
    const { records } = await siteVisitAdapter.findActiveByRequest(requestId);
    return (records || [])[0] || null;
  },
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

/** Expiry rule from plan §2.2. Pure so the tests can pin it. */
export function computeBriefingExpiry({ siteVisitEnd, meetingDate, now }) {
  const base = now instanceof Date ? now : new Date();
  const candidates = [];
  const visitEnd = siteVisitEnd ? new Date(siteVisitEnd) : null;
  if (visitEnd && !Number.isNaN(visitEnd.getTime())) {
    candidates.push(new Date(visitEnd.getTime() + AFTER_VISIT_DAYS * DAY_MS));
  } else {
    const meeting = meetingDate ? new Date(meetingDate) : null;
    if (meeting && !Number.isNaN(meeting.getTime())) {
      candidates.push(new Date(meeting.getTime() + AFTER_MEETING_DAYS * DAY_MS));
    }
  }
  let expiry = candidates[0] || new Date(base.getTime() + FALLBACK_DAYS * DAY_MS);
  if (expiry.getTime() - base.getTime() < MIN_TTL_MS) {
    // A visit or meeting already in the past still needs a usable link for
    // the session that is happening now; fall back to the default window.
    expiry = new Date(base.getTime() + FALLBACK_DAYS * DAY_MS);
  }
  return expiry;
}

/** Staff-facing projection: never includes the digest or ciphertext. */
export function projectBriefingLink(row, { url } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    url: url || null,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by,
  };
}

function rowIsLive(row, now) {
  return Boolean(row) && !row.revoked_at && new Date(row.expires_at).getTime() > now.getTime();
}

function unsealUrl(row, dependencies) {
  const jwt = dependencies.unseal(row.token_ciphertext);
  if (!jwt || hashToken(jwt) !== row.token_digest) {
    throw briefingError('The stored briefing link could not be read. Issue a new link.', 'briefing_link_unreadable', 500);
  }
  return buildBriefingUrl(jwt);
}

async function mintReplacement(requestId, actorId, dependencies) {
  const [request, siteVisit] = await Promise.all([
    dependencies.getRequest(requestId),
    dependencies.findActiveSiteVisit(requestId).catch(() => null),
  ]);
  if (!request || String(request.akoya_requestid).toLowerCase() !== requestId.toLowerCase()) {
    throw briefingError('The request could not be resolved.', 'briefing_request_not_found', 404);
  }
  const expiresAt = computeBriefingExpiry({
    siteVisitEnd: siteVisit?.scheduledend || siteVisit?.scheduledstart || null,
    meetingDate: request.wmkf_meetingdate || null,
    now: dependencies.now(),
  });
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
 * expired live row is replaced in the same call. Idempotent for a live row:
 * the second call returns the same id and URL (the row is read, not written).
 */
export async function ensureLiveBriefingLink({ requestId, actorId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertInputs(requestId, actorId, dependencies);
  const now = dependencies.now();
  const existing = await dependencies.getLiveLink(requestId);
  if (rowIsLive(existing, now)) {
    return { link: projectBriefingLink(existing, { url: unsealUrl(existing, dependencies) }), reused: true };
  }
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  if (existing) {
    const row = await dependencies.replaceLiveLink(requestId, replacement, { revokedBy: actorId });
    return { link: projectBriefingLink(row, { url }), reused: false };
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
    return { link: projectBriefingLink(winner, { url: unsealUrl(winner, dependencies) }), reused: true };
  }
}

/** D16: revoke the live link and issue a new one in one transaction. */
export async function reissueBriefingLink({ requestId, actorId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertInputs(requestId, actorId, dependencies);
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  const row = await dependencies.replaceLiveLink(requestId, replacement, { revokedBy: actorId });
  return { link: projectBriefingLink(row, { url }), reused: false };
}

/** Staff read: the live link with its URL, or null. Flag off → null. */
export async function getLiveBriefingLink({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady()) return null;
  if (!isGuid(requestId)) throw briefingError('requestId must be a GUID.', 'briefing_request_invalid', 400);
  const row = await dependencies.getLiveLink(requestId);
  if (!rowIsLive(row, dependencies.now())) return null;
  return projectBriefingLink(row, { url: unsealUrl(row, dependencies) });
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
