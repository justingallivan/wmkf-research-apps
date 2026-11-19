/**
 * GET /api/external/proposal-list/[token]/document?request=<request number>
 *
 * Streams one listed proposal's staff version to a verified link holder
 * (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md). The caller names a
 * request number only; the server checks it is on this link's list and
 * resolves the file itself. The client never supplies a request id, path,
 * library, or filename. Ordering: method → rate-limit → verify → record
 * outcome → resolve.
 *
 * A title on the list page is a plain link, so a refusal is read by a person in
 * a browser tab: when the request accepts HTML the refusal is a short readable
 * page (same status code); other callers get the JSON reason.
 */
import { verifyProposalListToken } from '../../../../../lib/external/verify-proposal-list-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { resolveProposalListDocument } from '../../../../../lib/services/proposal-lists/list-page-service';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';

function encodeFilename(name) {
  return String(name || 'proposal.pdf').replace(/["\r\n\\]/g, '').slice(0, 180);
}

const UNAVAILABLE = 'This proposal is not available yet. Please try again later, or contact the W. M. Keck Foundation.';
const LINK_ENDED = 'This link is no longer active. Please contact the W. M. Keck Foundation for a new one.';
const REASON_MESSAGE = {
  document_not_ready: UNAVAILABLE,
  document_unavailable: UNAVAILABLE,
  not_on_list: 'This proposal is not on your list.',
  rate_limited: 'Too many requests. Please wait a minute and try again.',
  expired: LINK_ENDED,
  revoked: LINK_ENDED,
  not_found: LINK_ENDED,
  invalid: LINK_ENDED,
};

/** Fixed text only: nothing from the request is written into the page. */
function refusalPage(reason) {
  const message = REASON_MESSAGE[reason] || 'This proposal could not be opened. Please try again.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Proposal not available</title></head>`
    + `<body style="font-family: system-ui, sans-serif; background: #f9fafb; color: #111827; margin: 0;">`
    + `<main style="max-width: 36rem; margin: 4rem auto; padding: 0 1rem;">`
    + `<p style="font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; color: #6b7280;">W. M. Keck Foundation · Research proposals</p>`
    + `<h1 style="font-size: 1.5rem;">Proposal not available</h1><p>${message}</p>`
    + `<p style="color: #4b5563;">You can close this tab and return to your list.</p></main></body></html>`;
}

function refuse(req, res, status, body) {
  if (String(req.headers?.accept || '').includes('text/html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(status).send(refusalPage(body?.reason));
  }
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return refuse(req, res, 405, { ok: false, reason: 'method_not_allowed' });
  }
  const { token, request } = req.query;
  if (typeof request !== 'string' || !request) {
    return refuse(req, res, 400, { ok: false, reason: 'request_required' });
  }
  try {
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return refuse(req, res, 429, { ok: false, reason: 'rate_limited' });
    }
    const verified = await verifyProposalListToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return refuse(req, res, verified.reason === 'not_found' ? 404 : 401, { ok: false, reason: verified.reason });
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
      return refuse(req, res, e.httpStatus, e.body ?? { ok: false, reason: 'server_error' });
    }
    console.error('[external proposal list document] error:', e?.message || e);
    return refuse(req, res, 500, { ok: false, reason: 'server_error' });
  }
}

export const config = {
  api: { responseLimit: '60mb' },
};
