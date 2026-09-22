/** Public Preview-only context for the five-minute presentation media proof. */

import { checkPresentationMediaProofRateLimit } from '../../../../../lib/external/presentation-media-proof-rate-limit';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import {
  assertPreviewProofDeployment,
  getPresentationMediaProofContext,
  verifyPresentationMediaProofToken,
} from '../../../../../lib/services/post-presentation-materials/presentation-media-proof-service';

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
  const limited = await checkPresentationMediaProofRateLimit(req, token);
  if (!limited.ok) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    return res.status(limited.reason === 'rate_limited' ? 429 : 503).json({ ok: false, reason: limited.reason });
  }
  try {
    const verified = await verifyPresentationMediaProofToken(token);
    if (!verified.ok) return res.status(401).json({ ok: false, reason: verified.reason });
    const context = await getPresentationMediaProofContext(verified);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.status(200).json(context);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.code });
    }
    console.error('[presentation-media-proof] context failed:', error?.message || error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
