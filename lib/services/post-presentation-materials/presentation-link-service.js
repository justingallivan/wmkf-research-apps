/** Independent 60-day lifecycle for materials-only presentation links. */
import crypto from 'node:crypto';
import { decrypt, encrypt } from '../../utils/encryption.js';
import { isGuid } from '../../utils/guid.js';
import {
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { hashToken, mintScopedToken } from '../external-token.js';
import { ServiceHttpError } from '../service-http-error.js';
import * as store from './presentation-link-store.js';

export const PRESENTATION_AUDIENCE = 'presentation-materials';
export const PRESENTATION_OPS = Object.freeze(['view_presentation_materials']);
const LINK_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

const DEFAULT_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  requestAllowed: isPostPresentationMaterialsRequestAllowed,
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, { select: 'akoya_requestid' }),
  getLiveLink: store.getLiveLinkForRequest,
  insertLink: store.insertLink,
  replaceLiveLink: store.replaceLiveLink,
  mint: mintScopedToken,
  seal: encrypt,
  unseal: decrypt,
  now: () => new Date(),
  randomUUID: () => crypto.randomUUID(),
  publicBaseUrl: () => getPresentationBaseUrl(),
});

function linkError(message, code, httpStatus = 409) {
  return new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } });
}

function assertInputs(requestId, actorId, dependencies) {
  if (!dependencies.schemaReady()) {
    throw linkError('Presentation materials are not enabled for this environment.', 'post_presentation_schema_not_ready', 503);
  }
  if (!isGuid(requestId) || !dependencies.requestAllowed(requestId)) {
    throw linkError('Presentation materials are not available.', 'post_presentation_not_available', 404);
  }
  if (!isGuid(actorId)) {
    throw linkError('Your staff account is not linked to a Dynamics identity.', 'presentation_link_actor_required', 403);
  }
}

export function computePresentationLinkExpiry(now) {
  const date = now instanceof Date ? now : new Date(now);
  return new Date(date.getTime() + LINK_LIFETIME_MS);
}

export function getPresentationBaseUrl(env = process.env) {
  // The two Board-facing audiences share the approved public host, but retain
  // separate tokens, rows, verifiers, and reissue transactions.
  const configured = String(env?.DELIBERATION_BRIEFING_PUBLIC_BASE_URL || env?.NEXTAUTH_URL || '').trim();
  let parsed;
  try { parsed = new URL(configured); } catch { throw new Error('A public presentation-link origin is required.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new Error('The presentation-link origin must be an absolute origin without credentials, path, query, or fragment.');
  }
  if (env?.DELIBERATION_BRIEFING_PUBLIC_BASE_URL && parsed.protocol !== 'https:') {
    throw new Error('The public presentation-link override must use HTTPS.');
  }
  return parsed.origin;
}

export function buildPresentationUrl(jwt, baseUrl = getPresentationBaseUrl()) {
  return `${String(baseUrl).replace(/\/$/, '')}/external/presentation/${jwt}`;
}

export function projectPresentationLink(row, { url = null, unreadable = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    url,
    unreadable: unreadable === true,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdBy: row.created_by,
  };
}

function rowIsLive(row, now) {
  return Boolean(row) && !row.revoked_at && new Date(row.expires_at).getTime() > now.getTime();
}

function recoverUrl(row, dependencies) {
  let jwt = null;
  try { jwt = dependencies.unseal(row.token_ciphertext); } catch { jwt = null; }
  if (!jwt || hashToken(jwt) !== row.token_digest) return null;
  return buildPresentationUrl(jwt, dependencies.publicBaseUrl());
}

async function mintReplacement(requestId, actorId, dependencies) {
  const request = await dependencies.getRequest(requestId);
  if (!request || String(request.akoya_requestid).toLowerCase() !== requestId.toLowerCase()) {
    throw linkError('The request could not be resolved.', 'presentation_link_request_not_found', 404);
  }
  const expiresAt = computePresentationLinkExpiry(dependencies.now());
  const { jwt, jti, hash } = await dependencies.mint({
    subject: requestId,
    audience: PRESENTATION_AUDIENCE,
    ops: [...PRESENTATION_OPS],
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
    url: buildPresentationUrl(jwt, dependencies.publicBaseUrl()),
  };
}

export async function ensureLivePresentationLink({ requestId, actorId }, dependencies = DEFAULT_DEPENDENCIES) {
  assertInputs(requestId, actorId, dependencies);
  const existing = await dependencies.getLiveLink(requestId);
  if (rowIsLive(existing, dependencies.now())) {
    const url = recoverUrl(existing, dependencies);
    if (url) return { link: projectPresentationLink(existing, { url }), reused: true };
  }
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  if (existing) {
    try {
      const row = await dependencies.replaceLiveLink(requestId, replacement, {
        revokedBy: actorId,
        expectedLiveId: existing.id,
      });
      return { link: projectPresentationLink(row, { url }), reused: false };
    } catch (error) {
      if (error?.code !== 'presentation_link_superseded') throw error;
      const winner = await dependencies.getLiveLink(requestId);
      const winnerUrl = rowIsLive(winner, dependencies.now()) ? recoverUrl(winner, dependencies) : null;
      if (!winnerUrl) throw error;
      return { link: projectPresentationLink(winner, { url: winnerUrl }), reused: true };
    }
  }
  try {
    const row = await dependencies.insertLink({ ...replacement, requestId });
    return { link: projectPresentationLink(row, { url }), reused: false };
  } catch (error) {
    if (error?.code !== '23505') throw error;
    const winner = await dependencies.getLiveLink(requestId);
    const winnerUrl = rowIsLive(winner, dependencies.now()) ? recoverUrl(winner, dependencies) : null;
    if (!winnerUrl) throw error;
    return { link: projectPresentationLink(winner, { url: winnerUrl }), reused: true };
  }
}

export async function reissuePresentationLink(
  { requestId, actorId, expectedLinkId },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  assertInputs(requestId, actorId, dependencies);
  if (!isGuid(expectedLinkId)) {
    throw linkError('Reissue must name the link being replaced.', 'presentation_link_expected_required', 400);
  }
  const { replacement, url } = await mintReplacement(requestId, actorId, dependencies);
  const row = await dependencies.replaceLiveLink(requestId, replacement, {
    revokedBy: actorId,
    expectedLiveId: expectedLinkId,
  });
  return { link: projectPresentationLink(row, { url }), reused: false };
}

export async function getLivePresentationLink({ requestId }, dependencies = DEFAULT_DEPENDENCIES) {
  if (!dependencies.schemaReady() || !isGuid(requestId) || !dependencies.requestAllowed(requestId)) return null;
  const row = await dependencies.getLiveLink(requestId);
  if (!rowIsLive(row, dependencies.now())) return null;
  const url = recoverUrl(row, dependencies);
  return projectPresentationLink(row, { url, unreadable: !url });
}
