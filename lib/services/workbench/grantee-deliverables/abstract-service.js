/**
 * Workbench grantee-deliverables — PD abstract load/save service
 * (Route→Service Consolidation Plan, Stage 4 series C).
 *
 * Holds ALL business logic for GET/PUT /api/workbench/grantee-deliverables/
 * abstract (S278); the route is a thin multi-verb shell (P1m template: one
 * service method per verb; the two historical DAL scopes —
 * 'grantee-abstract-load' / 'grantee-abstract-save' — are branch-specific and
 * PRESERVED per verb, per the P1m ruling caveat).
 *
 * The published body is `wmkf_abstractapproved ?? wmkf_abstractformatted`
 * (lib/services/grantee-document-assembly.js), so the editable target is the
 * "effective" field: draft before grantee submission, approved after.
 * Design guards (Codex pre-impl S278) preserved verbatim: fresh-server-read
 * target resolution, provenance guard, client-etag If-Match concurrency
 * (412 → 409 stale), baseField flip → 409 stale, status allowlist gate,
 * never touches wmkf_deliverablestatus, never blanks the field.
 *
 * Contract (plan Decision 3): plain args, plain 200 bodies; throws
 * ServiceHttpError — 404 default `{ error }`; the 409s carry `code` (+
 * `currentField`/`status`/`statusLabel`) so they set explicit bodies; the
 * non-412 save failure throws a 500 with the historical sanitized message.
 * ASSUMES a trusted DAL context (per-verb) already exists.
 */

import * as grantRequestAdapter from '../../../dataverse/adapters/grant-request.js';
import { getDeliverableForRequest } from '../../grantee-deliverable-record';
import {
  GRANTEE_DELIVERABLE_STATUS,
  GRANTEE_DELIVERABLE_LABEL,
  isStaffReplaceableStatus,
} from '../../../../shared/config/granteeDeliverableStatus';
import { ServiceHttpError } from '../../service-http-error';
import { BYLINE_REQUEST_SELECT, resolveByline } from '../../grantee-document-assembly';
import { renderGranteeBody } from '../../../../shared/utils/grantee-markdown';

const REQUEST_SELECT = `akoya_requestid,wmkf_abstractformatted,wmkf_abstractapproved,${BYLINE_REQUEST_SELECT}`;

const normStatus = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Statuses in which the DRAFT (wmkf_abstractformatted) may be edited by staff.
// null is allowed (pre-Drafted). Safe default, S278.
const DRAFT_EDITABLE = new Set([
  GRANTEE_DELIVERABLE_STATUS.DRAFTED,
  GRANTEE_DELIVERABLE_STATUS.INVITED,
  GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT,
]);
// Statuses in which the APPROVED (wmkf_abstractapproved) version may be edited by
// staff. Excludes REVISION_REQUESTED (a grantee resubmit would clobber the fix),
// COMPLETE and CLOSED_NO_RESPONSE.
const APPROVED_EDITABLE = new Set([
  GRANTEE_DELIVERABLE_STATUS.SUBMITTED,
  GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW,
]);

// Which field a save lands in, decided from the fresh-read row: the grantee's
// approved text once it exists, else the draft. Mirrors the publish precedence.
function resolveTarget(row) {
  const approved = (row.wmkf_abstractapproved || '').trim();
  if (approved) {
    return { which: 'approved', field: 'wmkf_abstractapproved', text: row.wmkf_abstractapproved };
  }
  return { which: 'formatted', field: 'wmkf_abstractformatted', text: row.wmkf_abstractformatted || '' };
}

function isEditable(which, status) {
  if (which === 'approved') return APPROVED_EDITABLE.has(status);
  return status === null || DRAFT_EDITABLE.has(status);
}

/**
 * Derive a safely linkable image URL from wmkf_imagefileref.
 *
 * The upload writer stores `uploadedItem.webUrl || \`${folder}/${filename}\``
 * (lib/services/grantee-upload.js:121), so the ref is an absolute SharePoint URL
 * in the normal case but a RELATIVE library path when Graph returned no webUrl.
 * Linkifying the relative form would render a broken same-origin link, so only
 * an absolute http(s) URL becomes a clickable href; everything else (including
 * anything javascript:-shaped) resolves to null and the UI shows plain text.
 * Parsed here rather than in JSX so it stays unit-testable and a hostile scheme
 * can never reach an href.
 */
function toStaffImageUrl(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  let parsed;
  try {
    parsed = new URL(ref.trim());
  } catch {
    return null; // relative library path, or unparseable
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? ref.trim() : null;
}

async function fetchRowOr404(requestId) {
  let row;
  try {
    row = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
  } catch {
    row = null;
  }
  if (!row?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }
  return row;
}

/**
 * GET half: resolve the effective abstract + editability for the PD editor, plus
 * the read-only record of what the grantee returned (caption, image, waiver time).
 * @throws {ServiceHttpError} 404
 */
export async function loadGranteeAbstract({ requestId }) {
  const row = await fetchRowOr404(requestId);
  const target = resolveTarget(row);
  const deliverable = await getDeliverableForRequest(requestId);
  const status = normStatus(deliverable?.wmkf_deliverablestatus);
  const imageRef = deliverable?.wmkf_imagefileref || null;
  // The PI/Co-PI byline the grantee and the published document will show. Staff
  // had no view of these names before sending, so a wrong Co-PI in Dataverse
  // reached a grantee inside a draft abstract with nothing in the flow to catch
  // it. Derived by the shared producer so what the PD checks here is byte-for-
  // byte what gets published (see resolveByline).
  //
  // Fail SOFT but never fail SILENT. The Co-PI read is a second Dataverse query
  // that this route did not previously make; letting it throw would take the
  // whole abstract editor down over a display-only addition. But a byline that
  // failed to load must not render as "no Co-PIs listed" — that is a false
  // clear on the exact check this exists to support — so the failure is a
  // distinct flag the UI reports as unverified.
  let byline = { pi: null, coPIs: [], names: null, unavailable: true };
  try {
    byline = { ...(await resolveByline(row, requestId)), unavailable: false };
  } catch (error) {
    console.error('[grantee-abstract] byline resolve failed:', error?.message || error);
  }
  return {
    abstractFormatted: row.wmkf_abstractformatted || '',
    abstractApproved: row.wmkf_abstractapproved || '',
    effective: target.text || '',
    // Response-only sanitized HTML seeds Tiptap. The exact Markdown above stays
    // authoritative for dirty tracking and persistence.
    effectiveHtml: renderGranteeBody(target.text || ''),
    effectiveField: target.which,
    etag: row._etag || null,
    status,
    statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
    editable: isEditable(target.which, status),
    // What the grantee returned. The caption and image became staff-writable in
    // S412 through the separate replace-submission route, which owns that
    // concurrency story (deliverable etag below); this GET stays the reader.
    caption: deliverable?.wmkf_imagecaption || null,
    // Server-computed capability + the deliverable etag the replace route needs
    // as its If-Match. Computed here so the client never re-derives the status
    // rule (feedback-ui-gates-must-mirror-server-guards).
    canReplace: isStaffReplaceableStatus(status),
    deliverableEtag: deliverable?._etag || null,
    imageRef,
    imageUrl: toStaffImageUrl(imageRef),
    hasImage: Boolean(imageRef),
    // Waiver acknowledgment time, stamped in the same submit changeset. NOT a
    // submitted date — no such field exists; the UI labels it as the waiver time.
    submittedAt: deliverable?.wmkf_waiverackedat || null,
    // Outbound lifecycle timestamps, so staff can see how long a grantee has
    // been sitting on an invitation without opening Dataverse. Both were already
    // in DELIVERABLE_SELECT (grantee-deliverable-record.js) for the reminder
    // cron's benefit; this only exposes them. `remindedAt` stays null until the
    // day-12 cron claims the row and flips Invited → REMINDER_SENT.
    invitedAt: deliverable?.wmkf_inviteddate || null,
    remindedAt: deliverable?.wmkf_remindeddate || null,
    pi: byline.pi,
    coPIs: byline.coPIs,
    bylineNames: byline.names,
    bylineUnavailable: byline.unavailable,
  };
}

/**
 * PUT half: conditional save of a PD edit onto the fresh-read effective field.
 * @throws {ServiceHttpError} 404; 409 stale / not_editable (explicit bodies);
 *   500 with the historical sanitized message on a non-412 write failure
 */
export async function saveGranteeAbstract({ requestId, text, clientEtag, baseField, actingUserSystemId }) {
  const row = await fetchRowOr404(requestId);

  // Effective target from the FRESH read (not the client's claim).
  const target = resolveTarget(row);
  const deliverable = await getDeliverableForRequest(requestId);
  const status = normStatus(deliverable?.wmkf_deliverablestatus);

  // Stale-edit guard: if the effective field flipped since the client loaded
  // (e.g. the grantee submitted, draft -> approved), the edit was made against
  // the wrong version — reload rather than write a draft edit over a fresh
  // grantee submission.
  if (baseField && baseField !== target.which) {
    throw new ServiceHttpError('stale abstract edit', {
      httpStatus: 409,
      code: 'stale',
      body: {
        code: 'stale',
        error: 'The abstract changed since you loaded it (the grantee may have submitted). Reload and re-apply your edit.',
        currentField: target.which,
      },
    });
  }

  // Status gate (Safe default, S278).
  if (!isEditable(target.which, status)) {
    throw new ServiceHttpError('abstract not editable in current status', {
      httpStatus: 409,
      code: 'not_editable',
      body: {
        code: 'not_editable',
        error: `This abstract cannot be edited in its current status (${status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || status) : 'Not started'}).`,
        status,
        statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
      },
    });
  }

  try {
    await grantRequestAdapter.updateById(
      row.akoya_requestid,
      { [target.field]: text },
      { ifMatch: clientEtag, actingUserSystemId },
    );
  } catch (e) {
    if (e.status === 412) {
      // Something wrote the row since the client loaded it.
      throw new ServiceHttpError('stale abstract edit (412)', {
        httpStatus: 409,
        code: 'stale',
        body: {
          code: 'stale',
          error: 'The abstract changed since you loaded it. Reload and re-apply your edit.',
        },
      });
    }
    console.error('[grantee-deliverables/abstract] save failed:', e.message);
    throw new ServiceHttpError('Failed to save the abstract.', { httpStatus: 500 });
  }

  // Re-read for the new etag so the PD can keep editing without a reload.
  let newEtag = null;
  try {
    const after = await grantRequestAdapter.getById(requestId, { select: 'akoya_requestid' });
    newEtag = after._etag || null;
  } catch { /* non-fatal; client can reload to get a fresh etag */ }

  return {
    ok: true,
    field: target.which,
    etag: newEtag,
    status,
    statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
  };
}
