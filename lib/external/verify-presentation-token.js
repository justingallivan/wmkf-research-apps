/** Verify a materials-only presentation token against its durable live row. */
import { hashToken, verifyToken } from '../services/external-token.js';
import { PRESENTATION_AUDIENCE } from '../services/post-presentation-materials/presentation-link-service.js';
import { getLinkByDigest } from '../services/post-presentation-materials/presentation-link-store.js';
import {
  isPostPresentationMaterialsRequestAllowed,
  isPostPresentationMaterialsSchemaReady,
} from '../utils/post-presentation-materials-readiness.js';

export async function verifyPresentationToken(jwt, dependencies = {}) {
  const schemaReady = dependencies.schemaReady || isPostPresentationMaterialsSchemaReady;
  const requestAllowed = dependencies.requestAllowed || isPostPresentationMaterialsRequestAllowed;
  const readByDigest = dependencies.getLinkByDigest || getLinkByDigest;
  const now = dependencies.now ? dependencies.now() : new Date();
  if (!schemaReady()) return { ok: false, reason: 'not_found' };
  const verified = await verifyToken(jwt);
  if (!verified.valid) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== PRESENTATION_AUDIENCE) return { ok: false, reason: 'invalid_claim' };
  const requestId = verified.payload.subject;
  if (!requestId || !requestAllowed(requestId)) return { ok: false, reason: 'not_found' };
  const row = await readByDigest(hashToken(jwt));
  if (!row || String(row.request_id).toLowerCase() !== String(requestId).toLowerCase()) {
    return { ok: false, reason: 'invalid_claim' };
  }
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, payload: verified.payload, requestId, link: row };
}
