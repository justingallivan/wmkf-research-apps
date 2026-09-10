/**
 * GET /api/external/briefing/[token]/document?member=<id>
 *
 * Streams one briefing member to a verified link holder
 * (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.3, §3). `member` is one of
 * `writeup-docx`, `writeup-pdf`, `proposal`, or `review:<suggestionId>`; the
 * server resolves it against the request's own model and 404s anything else
 * before any Graph call. The client never supplies a path, drive, item, or
 * filename. Ordering: method → rate-limit → verify → record outcome → resolve.
 */
import { verifyBriefingToken } from '../../../../../lib/external/verify-briefing-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { resolveBriefingMember } from '../../../../../lib/services/deliberation-briefing/briefing-page-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';

function encodeFilename(name) {
  return String(name || 'file').replace(/["\r\n\\]/g, '').slice(0, 180);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const { token, member } = req.query;
  if (typeof member !== 'string' || !member) {
    return res.status(400).json({ ok: false, reason: 'member_required' });
  }
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
    const file = await withDalContext('external-briefing-document', () =>
      resolveBriefingMember({ requestId: verified.requestId, member }));
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${file.inline ? 'inline' : 'attachment'}; filename="${encodeFilename(file.filename)}"`);
    if (file.size) res.setHeader('Content-Length', file.size);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(file.buffer);
  } catch (e) {
    if (e instanceof ServiceHttpError) {
      return res.status(e.httpStatus).json(e.body ?? { ok: false, reason: 'server_error' });
    }
    console.error('[external briefing document] error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { responseLimit: '60mb' },
};
