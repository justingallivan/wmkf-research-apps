/**
 * Token + row verification for the external PROPOSAL LIST endpoints
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * Stored-digest variant like the briefing verifier: signature + expiry
 * (verifyToken), `aud === 'proposal-list'` (rejects every other external
 * token), digest match against a proposal_list_links row, and that row not
 * revoked and not past its own expiry. Every call re-runs the row checks; a
 * revoked link stops working on the next request. The row's expiry is the one
 * enforced; the JWT's is a later ceiling.
 *
 * Returns the same discriminated-union shape as the sibling verifiers so the
 * routes share one fail-closed contract.
 */
import { verifyToken, hashToken } from '../services/external-token';
import { PROPOSAL_LIST_AUDIENCE } from '../services/proposal-lists/list-link-service';
import { isProposalListSchemaReady } from '../utils/proposal-list-readiness.js';
import { getLinkByDigest } from '../services/proposal-lists/list-store';

/**
 * @param {string} jwt
 * @param {{ schemaReady?: Function, getLinkByDigest?: Function, now?: Function }} [deps]
 * @returns {Promise<
 *   | { ok: true, payload: object, link: object }
 *   | { ok: false, reason: 'no_token'|'expired'|'invalid_signature'|'invalid_claim'|'malformed'|'not_found'|'revoked' }
 * >}
 */
export async function verifyProposalListToken(jwt, deps = {}) {
  const schemaReady = deps.schemaReady || isProposalListSchemaReady;
  const readByDigest = deps.getLinkByDigest || getLinkByDigest;
  const now = deps.now ? deps.now() : new Date();

  if (!schemaReady()) return { ok: false, reason: 'not_found' };

  const verified = await verifyToken(jwt);
  if (!verified.valid) return { ok: false, reason: verified.reason };
  if (verified.payload.aud !== PROPOSAL_LIST_AUDIENCE) return { ok: false, reason: 'invalid_claim' };

  const row = await readByDigest(hashToken(jwt));
  if (!row) return { ok: false, reason: 'invalid_claim' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, payload: verified.payload, link: row };
}
