/**
 * GET /api/external/briefing/[token]/context
 *
 * Public, token-authed read model for the deliberation briefing page
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.3). Ordering matches the other
 * external routes: method → rate-limit → verify → record outcome → fail-fast →
 * only then shape the response. The response carries descriptors and bounded
 * member ids only, never a SharePoint or Dataverse URL, drive, item, or path.
 *
 * Fail-closed: the flag off, an unknown/revoked/expired link, or a request
 * that no longer resolves all return `{ ok: false, reason }`.
 */
import { verifyBriefingToken } from '../../../../../lib/external/verify-briefing-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { buildBriefingContext } from '../../../../../lib/services/deliberation-briefing/briefing-page-service';
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
    const verified = await verifyBriefingToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });
    }
    const context = await withDalContext('external-briefing-context', () =>
      buildBriefingContext({ requestId: verified.requestId, link: verified.link }));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(context);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: 'server_error' });
    }
    console.error('[external briefing context] error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
