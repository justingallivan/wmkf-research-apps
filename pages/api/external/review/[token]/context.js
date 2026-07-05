/**
 * GET /api/external/review/[token]/context
 *
 * Public endpoint (allowlisted in middleware). Verifies the magic-link token
 * and returns everything the landing page needs to render. The page picks
 * which view to show (Stage 2a invitation vs Stage 2b materials vs
 * confirmation states) based on `engagementState`.
 *
 * Errors return shape `{ ok: false, reason }` with one of the verifier's
 * discriminated reasons. This lets the landing page show a specific error
 * state (expired vs. revoked vs. malformed) without 500-ing on bad input.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5, fail-closed
 * batch): the TOKEN BOUNDARY — method dispatch → rate limit → token verify →
 * outcome recording → failure envelopes — is byte-identical to the historical
 * route (the token IS the auth; no requireAppAccess on this surface). All
 * post-verification assembly (first-access stamp + etag re-read, file
 * listing, question set, policies, prefill) lives in
 * lib/services/external-review/context-service.js, which preserves the
 * historical branch-specific DAL scopes verbatim.
 */

import { verifySuggestionToken } from '../../../../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { buildReviewContext } from '../../../../../lib/services/external-review/context-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }
    const verified = await verifySuggestionToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    const { suggestion, request, reviewer } = verified;
    const payload = await buildReviewContext({ suggestion, request, reviewer });
    return res.status(200).json(payload);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: e.message });
    }
    console.error('[external context] unexpected error:', e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
