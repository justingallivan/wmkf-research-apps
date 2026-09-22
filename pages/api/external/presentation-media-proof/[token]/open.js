/**
 * Resolve one proof media action. Redirect mode is the initial experiment;
 * JSON mode is the no-store fallback used to compare browser range behavior.
 */

import { checkPresentationMediaProofRateLimit } from '../../../../../lib/external/presentation-media-proof-rate-limit';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import {
  assertPreviewProofDeployment,
  resolvePresentationMediaProof,
  verifyPresentationMediaProofToken,
} from '../../../../../lib/services/post-presentation-materials/presentation-media-proof-service';

const MODES = new Set(['watch', 'download']);
const DELIVERIES = new Set(['redirect', 'json']);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  try {
    assertPreviewProofDeployment();
  } catch {
    return res.status(404).json({ ok: false, reason: 'not_found' });
  }
  const token = Array.isArray(req.query.token) ? '' : String(req.query.token || '');
  const mode = Array.isArray(req.query.mode) ? '' : String(req.query.mode || '');
  const delivery = Array.isArray(req.query.delivery) ? '' : String(req.query.delivery || 'redirect');
  if (!MODES.has(mode) || !DELIVERIES.has(delivery)) {
    return res.status(400).json({ ok: false, reason: 'invalid_resolution_mode' });
  }
  const limited = await checkPresentationMediaProofRateLimit(req, token);
  if (!limited.ok) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    return res.status(limited.reason === 'rate_limited' ? 429 : 503).json({ ok: false, reason: limited.reason });
  }
  try {
    const verified = await verifyPresentationMediaProofToken(token);
    if (!verified.ok) return res.status(401).json({ ok: false, reason: verified.reason });
    const media = await resolvePresentationMediaProof(verified);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (delivery === 'json') return res.status(200).json({ ok: true, url: media.downloadUrl, mode });
    res.setHeader('Location', media.downloadUrl);
    return res.status(302).end();
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.code });
    }
    console.error('[presentation-media-proof] media resolution failed:', error?.message || error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
