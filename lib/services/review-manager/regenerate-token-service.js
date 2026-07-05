/**
 * Review Manager — external-token regeneration service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for POST /api/review-manager/regenerate-token;
 * the route is a thin shell (method dispatch, auth, input validation
 * incl. expiresAt parsing, DAL context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns { ok: true, url, expiresAt: ISO string, jti };
 *   - throws RegenerateTokenError (extends ServiceHttpError) with an explicit
 *     `body` (this route speaks `{ ok: false, reason }`, not `{ error }`):
 *       404 not_found (lookup 404 or missing _wmkf_request_value),
 *       409 excluded (applicant-disposition fail-closed chokepoint);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Semantics preserved exactly from the route (characterization tests are the
 * oracle):
 *   - fail closed on APPLICANT_DISPOSITION_EXCLUDED — this is a direct-mint
 *     path (mintAndStore, not ensureToken), so it carries its own disposition
 *     chokepoint (Phase 0.7);
 *   - post-mint draft cleanup is BEST-EFFORT: the token is already minted, so
 *     a ReviewDraftService.deleteBySuggestion failure must never fail the
 *     regenerate (GC / the next regen sweeps a leftover). Drafts key on the
 *     stable suggestion_id, not the token, so a stale (possibly tampered)
 *     draft would otherwise resurface under the new link — dropped here, NOT
 *     in mintAndStore (which also runs on benign reminder/email resends where
 *     the draft must survive). Plan §9 #draft-token / Codex P1-4.
 */

import { mintAndStore } from '../../external/token-lifecycle';
import ReviewDraftService from '../review-draft-service';
import { APPLICANT_DISPOSITION_EXCLUDED, getForTokenRegeneration } from '../../dataverse/adapters/reviewer-suggestion';
import { ServiceHttpError } from '../service-http-error';

/**
 * Domain error carrying an HTTP status AND the exact non-`{ error }` JSON
 * body the shell must send (plan Decision 3, `body` set explicitly).
 */
export class RegenerateTokenError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'RegenerateTokenError';
  }
}

/**
 * Mint a fresh external-access token for a suggestion and persist its hash.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID (already validated by the shell)
 * @param {Date} args.expiresAt - future expiry (already validated by the shell)
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ ok: true, url: string, expiresAt: string, jti: string }>}
 * @throws {RegenerateTokenError} 404 (body { ok:false, reason:'not_found' })
 *   or 409 (body { ok:false, reason:'excluded' })
 */
export async function regenerateToken({ suggestionId, expiresAt, actingUserSystemId }) {
  // Look up the suggestion to get its requestId — required for token payload.
  let suggestion;
  try {
    suggestion = await getForTokenRegeneration(suggestionId);
  } catch (e) {
    if (/Get record failed \(404\)/.test(e.message || '')) {
      throw new RegenerateTokenError('suggestion not found', 404, { ok: false, reason: 'not_found' });
    }
    throw e;
  }

  // Fail closed on an applicant-"excluded" engagement — never regenerate a
  // magic link for a reviewer the applicant asked us not to use.
  if (suggestion?.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED) {
    throw new RegenerateTokenError('engagement excluded by applicant', 409, { ok: false, reason: 'excluded' });
  }

  const requestId = suggestion?._wmkf_request_value;
  if (!requestId) {
    throw new RegenerateTokenError('suggestion has no request', 404, { ok: false, reason: 'not_found' });
  }

  const result = await mintAndStore({ suggestionId, requestId, expiresAt, actingUserSystemId });

  // Best-effort draft cleanup (see header) — a failure never fails the 200.
  try {
    await ReviewDraftService.deleteBySuggestion(suggestionId);
  } catch (e) {
    console.error('[review-manager regenerate-token] draft cleanup failed (non-fatal):', e.message);
  }

  return {
    ok: true,
    url: result.url,
    expiresAt: result.expiresAt.toISOString(),
    jti: result.jti,
  };
}
