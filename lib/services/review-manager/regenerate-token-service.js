/**
 * Review Manager — external-token regeneration service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for POST /api/review-manager/regenerate-token;
 * the route is a thin shell (method dispatch, auth, input validation,
 * DAL context, HTTP mapping).
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
 * Expiry is server-derived from accepted state plus the effective reviewer
 * due date. Regeneration replaces token authority but preserves any saved
 * review draft because the draft belongs to the engagement, not to one token:
 *   - fail closed on APPLICANT_DISPOSITION_EXCLUDED — this is a direct-mint
 *     path (mintAndStore, not ensureToken), so it carries its own disposition
 *     chokepoint (Phase 0.7);
 *   - no draft deletion occurs here; explicit revoke/remove/submit/manual-entry
 *     paths retain their own terminal cleanup semantics.
 */

import { mintAndStore } from '../../external/token-lifecycle';
import { APPLICANT_DISPOSITION_EXCLUDED, getForTokenRegeneration } from '../../dataverse/adapters/reviewer-suggestion';
import { ServiceHttpError } from '../service-http-error';
import { getById as getRequestById } from '../../dataverse/adapters/grant-request.js';
import { computeReviewerTokenExpiry } from '../../external/reviewer-token-ttl.js';
import { resolveEffectiveReviewDueDate } from '../../external/reviewer-due-date.js';

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
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ ok: true, url: string, expiresAt: string, jti: string }>}
 * @throws {RegenerateTokenError} 404 (body { ok:false, reason:'not_found' })
 *   or 409 (body { ok:false, reason:'excluded' })
 */
export async function regenerateToken({ suggestionId, actingUserSystemId }) {
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

  const request = await getRequestById(requestId, { select: 'wmkf_reviewduedate' });
  const expiresAt = computeReviewerTokenExpiry({
    accepted: suggestion.wmkf_accepted === true,
    reviewDueDate: resolveEffectiveReviewDueDate({
      overrideDate: suggestion.wmkf_reviewduedateoverride,
      defaultDate: request?.wmkf_reviewduedate,
    }),
  });

  const result = await mintAndStore({ suggestionId, requestId, expiresAt, actingUserSystemId });

  return {
    ok: true,
    url: result.url,
    expiresAt: result.expiresAt.toISOString(),
    jti: result.jti,
  };
}
