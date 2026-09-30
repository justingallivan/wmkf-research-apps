/** Minimal no-store context for the materials-only presentation audience. */
import { verifyPresentationToken } from '../../../../../lib/external/verify-presentation-token.js';
import { recordTokenOutcome } from '../../../../../lib/external/rate-limit.js';
import { checkPresentationContextRateLimit } from '../../../../../lib/external/presentation-media-rate-limit.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { buildPresentationContext } from '../../../../../lib/services/post-presentation-materials/presentation-page-service.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';

function unavailable(res, status = 404, reason = 'not_found') {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json({ ok: false, reason });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return unavailable(res, 405, 'method_not_allowed');
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const token = Array.isArray(req.query.token) ? '' : String(req.query.token || '');
  try {
    const rate = await checkPresentationContextRateLimit(req, token);
    if (!rate.ok) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return unavailable(res, rate.reason === 'rate_limit_unavailable' ? 503 : 429, rate.reason);
    }
    const verified = await verifyPresentationToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) return unavailable(res, verified.reason === 'not_found' ? 404 : 401, verified.reason);
    const context = await withDalContext('external-presentation-context', () =>
      buildPresentationContext({ requestId: verified.requestId, link: verified.link }));
    return res.status(200).json(context);
  } catch (error) {
    if (error instanceof ServiceHttpError) return unavailable(res, error.httpStatus);
    console.error('[external presentation context] failed:', error?.message || error);
    return unavailable(res, 500, 'server_error');
  }
}
