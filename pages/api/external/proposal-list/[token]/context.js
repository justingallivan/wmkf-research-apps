/**
 * GET /api/external/proposal-list/[token]/context
 *
 * The verified link holder's proposal list
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md): highlighted
 * proposals and the rest grouped by section, read only from the link's frozen
 * Postgres items. Ordering: method → rate-limit → verify → record outcome → read.
 */
import { verifyProposalListToken } from '../../../../../lib/external/verify-proposal-list-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { buildProposalListContext } from '../../../../../lib/services/proposal-lists/list-page-service';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
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
    const verified = await verifyProposalListToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });
    }
    return res.status(200).json(await buildProposalListContext({ link: verified.link }));
  } catch (e) {
    console.error('[external proposal list context] error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
