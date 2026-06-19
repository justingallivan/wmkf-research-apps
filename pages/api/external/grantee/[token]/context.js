/**
 * GET /api/external/grantee/[token]/context
 *
 * Public, token-authed endpoint (allowlisted in middleware). Parallel grantee
 * variant of /api/external/review/[token]/context. Verifies the stateless
 * grantee magic-link token (signature + expiry + aud:'grantee') and returns
 * what the grantee landing page needs to render: the request header, the
 * formatted/approved abstract, caption, whether an image is already on file,
 * and the package status — plus a fail-closed `editable` flag and `view`.
 *
 * Fail-closed (Codex chunk-1 review): an unknown/missing
 * wmkf_granteedeliverablestatus does NOT default to editable. Only the explicit
 * EDITABLE_STATUSES allowlist renders the edit view; everything else is
 * read-only. Ordering: method → rate-limit → verify → record outcome →
 * fail-fast → only then shape the response.
 *
 * Errors return `{ ok: false, reason }` (the verifier's discriminated reasons)
 * so the page can show a specific state without 500-ing on bad input.
 */

import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
} from '../../../../../shared/config/granteeDeliverableStatus';

// Statuses where the grantee may still edit/submit. A null/unknown status is
// intentionally NOT here — fail closed (read-only) rather than editable.
const EDITABLE_STATUSES = new Set([
  GRANTEE_DELIVERABLE_STATUS.DRAFTED,
  GRANTEE_DELIVERABLE_STATUS.INVITED,
  GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
  GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED,
]);

// Statuses that render a read-only "received / under review" confirmation.
const SUBMITTED_VIEW_STATUSES = new Set([
  GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW,
  GRANTEE_DELIVERABLE_STATUS.COMPLETE,
]);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const token = req.query.token;
    const rl = await checkRateLimit(req, token);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    const verified = await verifyGranteeToken(token);
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    const { request } = verified;

    // Status may be a number, a numeric string from the API, or null/undefined.
    const rawStatus = request.wmkf_granteedeliverablestatus;
    const status = rawStatus === null || rawStatus === undefined || rawStatus === ''
      ? null
      : Number(rawStatus);

    const editable = status !== null && EDITABLE_STATUSES.has(status);
    let view;
    if (editable) view = 'edit';
    else if (status !== null && SUBMITTED_VIEW_STATUSES.has(status)) view = 'submitted';
    else view = 'closed';

    return res.status(200).json({
      ok: true,
      request: {
        title: request.akoya_title || null,
        requestNumber: request.akoya_requestnum || null,
        meetingDate: request.wmkf_meetingdate || null,
      },
      deliverable: {
        // The grantee edits the formatted abstract; once submitted, the approved
        // version is authoritative. Do NOT expose the raw SharePoint image ref —
        // only whether an image is already on file.
        abstractFormatted: request.wmkf_abstractformatted || null,
        abstractApproved: request.wmkf_abstractapproved || null,
        caption: request.wmkf_granteeimagecaption || null,
        hasImage: Boolean(request.wmkf_granteeimagefileref),
        status,
        statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
      },
      editable,
      view,
    });
  } catch (e) {
    console.error('[grantee/context] unexpected error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
