/**
 * GET /api/external/proposal-list/[token]/document?request=<request number>
 *
 * Streams one listed proposal's staff version to a verified link holder
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md). The caller names a
 * request number only; the server checks it is on this link's list and
 * resolves the file itself. The client never supplies a request id, path,
 * library, or filename. Ordering: method → rate-limit → verify → record
 * outcome → resolve.
 */
import { verifyProposalListToken } from '../../../../../lib/external/verify-proposal-list-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { resolveProposalListDocument } from '../../../../../lib/services/proposal-lists/list-page-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';

function encodeFilename(name) {
  return String(name || 'proposal.pdf').replace(/["\r\n\\]/g, '').slice(0, 180);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const { token, request } = req.query;
  if (typeof request !== 'string' || !request) {
    return res.status(400).json({ ok: false, reason: 'request_required' });
  }
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
    const file = await withDalContext('external-proposal-list-document', () =>
      resolveProposalListDocument({ link: verified.link, requestNumber: request }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(file.filename)}"`);
    if (file.size) res.setHeader('Content-Length', file.size);
    return res.status(200).send(file.buffer);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: 'server_error' });
    }
    console.error('[external proposal list document] error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { responseLimit: '60mb' },
};
