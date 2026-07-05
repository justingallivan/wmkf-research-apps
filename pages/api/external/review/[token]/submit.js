/**
 * POST /api/external/review/[token]/submit
 *
 * Final submission for the in-browser reviewer authoring surface
 * (docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §5/§9). Submit is FINAL —
 * the form locks read-only afterward; there is no edit/re-submit (diverges from
 * the legacy "replace your submission" upload grace, removed with the upload UI).
 *
 * Responses:
 *   200  { ok: true, receivedAt }
 *   400  validation { ok:false, reason:'validation', errors }
 *   401  token verification failed
 *   403  op_not_permitted (token minted without 'upload_review')
 *   404  token not found
 *   405  method not POST
 *   409  review_received_locked | materials_not_sent | set_changed | conflict
 *   429  rate limited
 *   500  internal
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5, fail-closed
 * batch): the TOKEN BOUNDARY — method dispatch → rate limit → token verify →
 * outcome recording → failure envelopes → fail-closed `tokenHasOp` ops gate —
 * is byte-identical to the historical route (the token IS the auth; no
 * requireAppAccess on this surface). The submit pipeline (finality/stage
 * gates, sanitize/validate/build, atomic changeset, draft delete) lives in
 * lib/services/external-review/submit-service.js.
 */

import { verifySuggestionToken, tokenHasOp } from '../../../../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { submitReview } from '../../../../../lib/services/external-review/submit-service';

// Rich-text answers can be sizeable; cap the JSON body (mirrors /draft).
export const config = {
  api: {
    bodyParser: { sizeLimit: '2mb' },
  },
};

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
        ok: false,
        reason: verified.reason,
      });
    }

    // Fail closed on the token's ops claim: a token minted without
    // 'upload_review' (or with a missing/malformed ops array) must not be able
    // to submit a review, even if the row/hash/expiry checks above passed.
    if (!tokenHasOp(verified, 'upload_review')) {
      return res.status(403).json({ ok: false, reason: 'op_not_permitted' });
    }

    const result = await submitReview({ suggestion: verified.suggestion, body: req.body });
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: e.message });
    }
    console.error('[external review submit] error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
