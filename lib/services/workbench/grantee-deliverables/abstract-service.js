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
} from '../../../../shared/config/granteeDeliverableStatus';
import { ServiceHttpError } from '../../service-http-error';

const REQUEST_SELECT = 'akoya_requestid,wmkf_abstractformatted,wmkf_abstractapproved';

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
 * GET half: resolve the effective abstract + editability for the PD editor.
 * @throws {ServiceHttpError} 404
 */
export async function loadGranteeAbstract({ requestId }) {
  const row = await fetchRowOr404(requestId);
  const target = resolveTarget(row);
  const deliverable = await getDeliverableForRequest(requestId);
  const status = normStatus(deliverable?.wmkf_deliverablestatus);
  return {
    abstractFormatted: row.wmkf_abstractformatted || '',
    abstractApproved: row.wmkf_abstractapproved || '',
    effective: target.text || '',
    effectiveField: target.which,
    etag: row._etag || null,
    status,
    statusLabel: status !== null ? (GRANTEE_DELIVERABLE_LABEL[status] || null) : null,
    editable: isEditable(target.which, status),
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
