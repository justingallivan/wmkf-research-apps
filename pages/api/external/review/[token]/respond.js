/**
 * POST /api/external/review/[token]/respond
 *
 * Unified accept/decline endpoint for Stage 2a. Discriminated by `action`
 * in the request body — single endpoint because the server-side guards (token
 * verify, state machine, idempotency, optimistic locking, audit) are shared.
 * Email triggers (decline-ack, referral handoff) are deferred to a follow-up build.
 *
 * Response family (the plan's canonical non-{error} shape — every envelope is
 * `{ ok, reason?, ... }` and is preserved byte-exact by the service's explicit
 * ServiceHttpError bodies):
 *   200 OK { ok: true, idempotent?, acceptanceJobId?, engagementState }
 *   400  malformed body / missing acks / invalid picklist value / invalid action
 *   401  token verification failed (verifier's reason codes)
 *   404  token not found
 *   405  method not POST
 *   409  materials_sent_locked | review_received_locked | withdrawn_sufficient |
 *        terminal response locks
 *   412  optimistic-lock conflict
 *   422  payment_contact_required
 *   429  rate limited
 *   500  policy_misconfigured or unexpected
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5, fail-closed
 * batch): the TOKEN BOUNDARY — method dispatch → rate limit → token verify →
 * outcome recording → failure envelopes — is byte-identical to the historical
 * route (the token IS the auth; no requireAppAccess on this surface). The
 * state machine, drain-contract job staging/ordering, and Dataverse writes
 * live in lib/services/external-review/respond-service.js.
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { missingRequiredAddressFields, validateAddress } from '../../../../../lib/external/required-address';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { renderAcceptanceConfirmationEmail } from '../../../../../lib/services/reviewer-acceptance-email';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { applyReviewerResponse } from '../../../../../lib/services/external-review/respond-service';

// Mailing-address VALIDITY (`validateAddress`) and PRESENCE
// (`missingRequiredAddressFields`) live in lib/external/required-address.js;
// re-exported here so existing importers/tests keep resolving them from this
// route (historical import surface, unchanged by the Stage 5 extraction).
export { missingRequiredAddressFields, validateAddress };
export { renderAcceptanceConfirmationEmail };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }
    // S333 Stage 4b: trust-model tightening — this route now establishes
    // the trusted context itself (label byte-preserved from the wrap that
    // used to live inside verifySuggestionToken() itself).
    const verified = await withDalContext('external-token-verify', () => verifySuggestionToken(token));
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false, reason: verified.reason,
      });
    }
    const { suggestion, request, reviewer } = verified;

    const result = await applyReviewerResponse({
      suggestion,
      request,
      reviewer,
      body: req.body || {},
      ifMatch: req.headers['if-match'],
      reviewerPortalToken: token,
    });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: e.message });
    }
    console.error('[external respond] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
