/**
 * Token + row verification for the applicant materials contributor endpoints
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16). Stored-digest variant
 * like the briefing verifier: signature + expiry (verifyToken), audience
 * `materials`, digest match against a site_visit_material_collections row,
 * that row not closed and not past its close instant, and the token's `sub`
 * equal to the row's request. Every call re-runs the row checks.
 */
import { verifyToken, hashToken } from '../services/external-token';
import { isSiteVisitMaterialsSchemaReady } from '../utils/site-visit-materials-readiness.js';
import { getCollectionByDigest } from '../services/site-visit-materials/collection-store';
import { SITE_VISIT_MATERIALS_AUDIENCE, SITE_VISIT_MATERIALS_STATUS } from '../../shared/config/siteVisitMaterials.js';

/**
 * @param {string} jwt
 * @returns {Promise<
 *   | { ok: true, payload: object, requestId: string, collection: object }
 *   | { ok: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed'|'not_found'|'closed' }
 * >}
 */
export async function verifyMaterialsToken(jwt, deps = {}) {
  const schemaReady = deps.schemaReady || isSiteVisitMaterialsSchemaReady;
  const readByDigest = deps.getCollectionByDigest || getCollectionByDigest;
  const now = deps.now ? deps.now() : new Date();
  if (!schemaReady()) return { ok: false, reason: 'not_found' };
  const verified = await verifyToken(jwt);
  if (!verified.valid) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== SITE_VISIT_MATERIALS_AUDIENCE) return { ok: false, reason: 'invalid_claim' };
  const requestId = verified.payload.subject;
  if (!requestId) return { ok: false, reason: 'malformed' };
  const row = await readByDigest(hashToken(jwt));
  if (!row) return { ok: false, reason: 'invalid_claim' };
  if (String(row.request_id).toLowerCase() !== String(requestId).toLowerCase()) return { ok: false, reason: 'invalid_claim' };
  if (row.status === SITE_VISIT_MATERIALS_STATUS.CLOSED) return { ok: false, reason: 'closed' };
  if (new Date(row.closes_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, payload: verified.payload, requestId: row.request_id, collection: row };
}
