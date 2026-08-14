/**
 * GET /api/external/grantee/[token]/context
 *
 * Public, token-authed endpoint (allowlisted in middleware). Parallel grantee
 * variant of /api/external/review/[token]/context. Verifies the stateless
 * grantee magic-link token (signature + expiry + aud:'grantee') and returns
 * what the grantee landing page needs to render: the request header, the
 * formatted/approved abstract, caption, their response-only sanitized HTML
 * editor seeds, whether an image is already on file,
 * and the package status — plus a fail-closed `editable` flag and `view`.
 *
 * Fail-closed: a missing deliverable row or unknown/missing deliverable status
 * does NOT default to editable. Only the explicit EDITABLE_STATUSES allowlist
 * renders the edit view; everything else is read-only. Ordering: method → rate-limit → verify → record outcome →
 * fail-fast → only then shape the response.
 *
 * Errors return `{ ok: false, reason }` (the verifier's discriminated reasons)
 * so the page can show a specific state without 500-ing on bad input.
 */

import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { resolveActiveWaiverPolicy } from '../../../../../lib/external/grantee-waiver-policy';
import { mintWaiverRenderToken } from '../../../../../lib/services/external-token';
import { assembleGranteeDocument } from '../../../../../lib/services/grantee-document-assembly';
import { renderAwardBlock } from '../../../../../lib/services/grantee-document-html';
import { renderGranteeBody, renderGranteeCaption } from '../../../../../shared/utils/grantee-markdown';
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
    const model = await withDalContext('grantee-portal-preview', () =>
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

    // S333 Stage 4b: trust-model tightening — this route now establishes
    // the trusted context itself (label byte-preserved from the wrap that
    // used to live inside verifyGranteeToken() itself).
    const verified = await withDalContext('grantee-token-verify', () => verifyGranteeToken(token));
    await recordTokenOutcome(req, token, verified.ok);
    if (!verified.ok) {
      return res.status(verified.reason === 'not_found' ? 404 : 401).json({
        ok: false,
        reason: verified.reason,
      });
    }

    const { request, deliverable } = verified;

    // Status may be a number, a numeric string from the API, or null/undefined.
    const rawStatus = deliverable?.wmkf_deliverablestatus;
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

    // Publication waiver: only the edit view needs it (the grantee is about to
    // acknowledge + submit). Fail CLOSED — if the grantee-waiver slot can't
    // resolve, refuse the edit view with the mapped reason rather than render an
    // un-versioned/unconsentable form. Resolution + version binding is done via a
    // signed render token so submit records exactly the version shown.
    let waiverPolicy = null;
    let waiverToken = null;
    if (view === 'edit') {
      const resolved = await resolveActiveWaiverPolicy();
      if (!resolved.ok) {
        // Transient (unavailable) → 503; deterministic misconfig → 500. No
        // operator alert here (context is high-traffic/retryable); the submit
        // path alerts on a fail-closed block.
        const httpStatus = resolved.reason === 'policy_unavailable' ? 503 : 500;
        return res.status(httpStatus).json({ ok: false, reason: resolved.reason });
      }
      const { policy } = resolved;
      waiverPolicy = { title: policy.title, body: policy.body, versionId: policy.activeVersionId, versionLabel: policy.versionLabel };
      // 30-day render token — generous enough that a slow grantee editing session
      // never expires; re-minted on every context load, and version-bound so it
      // records what was shown even after a later staff republish.
      waiverToken = await mintWaiverRenderToken({
        requestId: verified.requestId,
        versionId: policy.activeVersionId,
        body: policy.body,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    const effectiveAbstract = request.wmkf_abstractapproved || request.wmkf_abstractformatted || '';

    return res.status(200).json({
      ok: true,
      request: {
        title: request.akoya_title || null,
        meetingDate: request.wmkf_meetingdate || null,
      },
      deliverable: {
        // The grantee edits the formatted abstract; once submitted, the approved
        // version is authoritative. Do NOT expose the raw SharePoint image ref —
        // only whether an image is already on file.
        abstractFormatted: request.wmkf_abstractformatted || null,
        abstractApproved: request.wmkf_abstractapproved || null,
        // Response-only safe HTML for the editor seed. Markdown remains the
        // persisted/submitted value and the two source fields remain unchanged.
        abstractHtml: renderGranteeBody(effectiveAbstract),
        caption: deliverable?.wmkf_imagecaption || null,
        // Response-only safe HTML for the shared caption editor. The Markdown
        // field above remains the persistence and submit contract.
        captionHtml: renderGranteeCaption(deliverable?.wmkf_imagecaption || ''),
        hasImage: Boolean(deliverable?.wmkf_imagefileref),
        status,
        statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
      },
      editable,
      view,
      // Display-only assembled award (output a). null when unavailable or on a
      // closed view; the page renders it above the form when present.
      preview,
      // Versioned publication waiver (edit view only). `waiverPolicy.body` is the
      // exact text to display; `waiverToken` binds that version and must be echoed
      // back on submit. Both null on non-edit views.
      waiverPolicy,
      waiverToken,
    });
  } catch (e) {
    console.error('[grantee/context] unexpected error:', e?.message || e);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
