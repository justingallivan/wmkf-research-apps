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
import { bypassDynamicsRestrictions } from '../../../../../lib/services/dynamics-context';
import { assembleGranteeDocument } from '../../../../../lib/services/grantee-document-assembly';
import { renderAwardBlock } from '../../../../../lib/services/grantee-document-html';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
  isGranteeEditableStatus,
} from '../../../../../shared/config/granteeDeliverableStatus';

// Editable = the shared allowlist (single source of truth, also used by the
// submit route). A null/unknown status is NOT editable — fail closed.

// Statuses that render a read-only "received / under review" confirmation.
const SUBMITTED_VIEW_STATUSES = new Set([
  GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW,
  GRANTEE_DELIVERABLE_STATUS.COMPLETE,
]);

/**
 * Chunk-8 output (a): the assembled, styled award document shown above the
 * editable body so the grantee sees exactly how their award will appear. This
 * is a DISPLAY-ONLY preview — institution / location / PI+co-PIs / amount /
 * edited title are all Foundation-owned (D9) and the edited title is
 * staff-owned/fixed (owner decision S271), so nothing here is editable. The
 * grantee still edits the body / caption / image in the form below.
 *
 * Auth boundary: this is the external grantee-token surface, so the model is
 * assembled WITHOUT the private SharePoint ref (`includeImageRef: false`) and
 * rendered WITHOUT the image figure (`includeImage: false`) — the surface stays
 * `hasImage`-only. The renderer escapes every plain-text field and inlines only
 * the already-sanitized body HTML, so the returned string is safe to inject.
 *
 * Fail-soft: the preview is additive. Any assembly/render failure returns null
 * rather than breaking the core context response (which the form depends on).
 *
 * @returns {Promise<string|null>} the award-block HTML fragment, or null.
 */
async function buildPreviewHtml(requestId) {
  try {
    const model = await bypassDynamicsRestrictions('grantee-portal-preview', () =>
      assembleGranteeDocument(requestId, { includeImageRef: false }),
    );
    if (!model) return null;
    const html = renderAwardBlock(model, { includeImage: false });
    return html || null;
  } catch (e) {
    console.error('[grantee/context] preview assembly failed:', e?.message || e);
    return null;
  }
}

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

    const editable = isGranteeEditableStatus(status);
    let view;
    if (editable) view = 'edit';
    else if (status !== null && SUBMITTED_VIEW_STATUSES.has(status)) view = 'submitted';
    else view = 'closed';

    // Output (a): assemble the styled award preview for the views that render it
    // (edit + submitted). Skip on `closed` — the grantee only sees a contact
    // message there, so the extra Dataverse reads are wasted.
    const preview = (view === 'edit' || view === 'submitted')
      ? await buildPreviewHtml(verified.requestId)
      : null;

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
      // Display-only assembled award (output a). null when unavailable or on a
      // closed view; the page renders it above the form when present.
      preview,
    });
  } catch (e) {
    console.error('[grantee/context] unexpected error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
