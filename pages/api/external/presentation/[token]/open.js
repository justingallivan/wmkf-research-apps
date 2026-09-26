/** Reverify membership, then redirect directly to Zoom or a fresh Microsoft URL. */
import { verifyPresentationToken } from '../../../../../lib/external/verify-presentation-token.js';
import { checkPresentationMediaRateLimit } from '../../../../../lib/external/presentation-media-rate-limit.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { resolvePresentationMember } from '../../../../../lib/services/post-presentation-materials/presentation-page-service.js';
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
  const member = Array.isArray(req.query.member) ? '' : String(req.query.member || '');
  const mode = Array.isArray(req.query.mode) ? '' : String(req.query.mode || 'open');
  if (!token || !member || !['open', 'watch', 'download'].includes(mode)) return unavailable(res);
  const rate = await checkPresentationMediaRateLimit(req, token);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return unavailable(res, rate.reason === 'rate_limited' ? 429 : 503, rate.reason);
  }
  try {
    const verified = await verifyPresentationToken(token);
    if (!verified.ok) return unavailable(res);
    const material = await withDalContext('external-presentation-open', () =>
      resolvePresentationMember({ requestId: verified.requestId, member, mode }));
    return res.redirect(302, material.redirectUrl);
  } catch (error) {
    if (error instanceof ServiceHttpError) return unavailable(res, error.httpStatus === 404 ? 404 : error.httpStatus);
    console.error('[external presentation open] failed:', error?.message || error);
    return unavailable(res, 500, 'server_error');
  }
}
