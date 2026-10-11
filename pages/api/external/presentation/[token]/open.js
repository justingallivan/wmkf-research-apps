/** Reverify membership, then redirect directly to Zoom or a fresh Microsoft URL. */
import { verifyPresentationToken } from '../../../../../lib/external/verify-presentation-token.js';
import {
  checkPresentationMediaRateLimit,
  checkPresentationProposalCheckRateLimit,
} from '../../../../../lib/external/presentation-media-rate-limit.js';
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
  if (!token || !member || !['open', 'watch', 'download', 'check', 'pdf'].includes(mode)) return unavailable(res);
  // mode=check is the page's automatic proposal check: its own budget, so page loads never use media capacity.
  const rate = mode === 'check'
    ? await checkPresentationProposalCheckRateLimit(req, token)
    : await checkPresentationMediaRateLimit(req, token);
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return unavailable(res, rate.reason === 'rate_limited' ? 429 : 503, rate.reason);
  }
  try {
    const verified = await verifyPresentationToken(token);
    if (!verified.ok) return unavailable(res);
    const material = await withDalContext('external-presentation-open', () =>
      resolvePresentationMember({ requestId: verified.requestId, member, mode }));
    // mode=check (proposal only): every gate ran; answer with the page descriptor, never a URL.
    if (material.kind === 'available') return res.status(200).json({ ok: true, material: material.material });
    // mode=pdf (applicant Word files only): a bounded PDF conversion served from this origin for viewing.
    if (material.kind === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      res.setHeader('Content-Length', String(material.buffer.length));
      return res.status(200).send(material.buffer);
    }
    return res.redirect(302, material.redirectUrl);
  } catch (error) {
    if (error instanceof ServiceHttpError) return unavailable(res, error.httpStatus === 404 ? 404 : error.httpStatus);
    console.error('[external presentation open] failed:', error?.message || error);
    return unavailable(res, 500, 'server_error');
  }
}
