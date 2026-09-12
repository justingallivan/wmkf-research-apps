/**
 * Token + row verification for the external deliberation BRIEFING endpoints
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2, §3).
 *
 * Stored-digest variant like the reviewer verifier, keyed on Postgres rather
 * than a Dataverse row: signature + expiry (verifyToken), `aud === 'briefing'`
 * (rejects reviewer and grantee tokens), digest match against a
 * deliberation_briefing_links row, that row not revoked and not past its own
 * expiry, and the token's `sub` equal to the row's request. Every call re-runs
 * the row checks; a reissued link stops working on the next request.
 *
 * Returns the same discriminated-union shape as the sibling verifiers so the
 * routes share one fail-closed contract. `revoked` is the one new reason.
 */
import { verifyToken, hashToken } from '../services/external-token';
import { BRIEFING_AUDIENCE } from '../services/deliberation-briefing/briefing-link-service';
import { isDeliberationBriefingSchemaReady } from '../utils/deliberation-briefing-readiness.js';
import { getLinkByDigest } from '../services/deliberation-briefing/briefing-link-store';

/**
 * @param {string} jwt
 * @param {{ schemaReady?: Function, getLinkByDigest?: Function, now?: Function }} [deps]
 * @returns {Promise<
 *   | { ok: true, payload: object, requestId: string, link: object }
 *   | { ok: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed'|'not_found'|'revoked' }
 * >}
 */
export async function verifyBriefingToken(jwt, deps = {}) {
  const schemaReady = deps.schemaReady || isDeliberationBriefingSchemaReady;
  const readByDigest = deps.getLinkByDigest || getLinkByDigest;
  const now = deps.now ? deps.now() : new Date();

  if (!schemaReady()) return { ok: false, reason: 'not_found' };

  const verified = await verifyToken(jwt);
  if (!verified.valid) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== BRIEFING_AUDIENCE) return { ok: false, reason: 'invalid_claim' };

  const requestId = verified.payload.subject;
  if (!requestId) return { ok: false, reason: 'malformed' };

  const row = await readByDigest(hashToken(jwt));
  if (!row) return { ok: false, reason: 'invalid_claim' };
  if (String(row.request_id).toLowerCase() !== String(requestId).toLowerCase()) {
    return { ok: false, reason: 'invalid_claim' };
  }
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, payload: verified.payload, requestId: row.request_id, link: row };
}
