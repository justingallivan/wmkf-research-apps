/** Non-buffering current post-presentation resolver for the full briefing. */
import { verifyBriefingToken } from '../../../../../lib/external/verify-briefing-token';
import { checkPresentationMediaRateLimit } from '../../../../../lib/external/presentation-media-rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { resolveBriefingMediaMember } from '../../../../../lib/services/deliberation-briefing/briefing-page-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';

function unavailable(res, status = 404, reason = 'not_found') {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(status).json({ ok: false, reason });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return unavailable(res, 405, 'method_not_allowed');
  }
  const { token, member, mode = 'open' } = req.query;
  if (typeof token !== 'string' || typeof member !== 'string' || typeof mode !== 'string') {
    return unavailable(res);
  }
  const rate = await checkPresentationMediaRateLimit(req, token);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return unavailable(res, rate.reason === 'rate_limited' ? 429 : 503, rate.reason);
  }
  try {
    const verified = await verifyBriefingToken(token);
    if (!verified.ok) return unavailable(res);
    const media = await withDalContext('external-briefing-presentation-open', () =>
      resolveBriefingMediaMember({ requestId: verified.requestId, member, mode }));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.redirect(302, media.redirectUrl);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return unavailable(res, error.httpStatus === 404 ? 404 : error.httpStatus);
    }
    console.error('[external briefing presentation open] failed:', error?.message || error);
    return unavailable(res, 500, 'server_error');
  }
}
