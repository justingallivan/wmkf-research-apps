/**
 * GET /api/external/materials/[token]/context — what the PI or liaison sees:
 * institution, title, due/close dates, checklist with received files, the
 * upload cap. Filenames only, no SharePoint identity. Ordering: method →
 * rate limit → verify → record outcome → shape.
 */
import { verifyMaterialsToken } from '../../../../../lib/external/verify-materials-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { buildContributorContext } from '../../../../../lib/services/site-visit-materials/contributor-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const { token } = req.query;
  try {
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }
    const verified = await verifyMaterialsToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });
    const context = await withDalContext('external-materials-context', () => buildContributorContext({ collection: verified.collection }));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(context);
  } catch (e) {
    if (e instanceof ServiceHttpError) return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: 'server_error' });
    console.error('[external materials context] error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
