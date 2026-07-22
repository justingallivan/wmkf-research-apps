/**
 * Repair a materials email lifecycle stamp without sending another email.
 * This is the actionable recovery path returned by send-emails when dispatch
 * succeeded but the inline ETag-guarded write did not.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../../shared/config/reviewerStatus';
import { isYmd } from '../../utils/date-ymd';
import { ServiceHttpError } from '../service-http-error';

const ALLOWED_SOURCE_VALUES = new Set([
  suggestionAdapter.REVIEW_STATUS_MAP.accepted,
  suggestionAdapter.REVIEW_STATUS_MAP.materials_sent,
  suggestionAdapter.REVIEW_STATUS_MAP.under_review,
]);
const TERMINAL_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

export async function repairMaterialsSendStamp({
  requestId,
  suggestionId,
  effectiveReviewDueDate,
  materialsSentAt,
  actingUserSystemId,
}) {
  if (!isYmd(effectiveReviewDueDate)) {
    throw new ServiceHttpError('effectiveReviewDueDate must be a valid YYYY-MM-DD date', { httpStatus: 400 });
  }
  const parsedSentAt = new Date(materialsSentAt);
  if (!materialsSentAt || !Number.isFinite(parsedSentAt.getTime())) {
    throw new ServiceHttpError('materialsSentAt must be a valid timestamp', { httpStatus: 400 });
  }

  const row = await suggestionAdapter.findById(suggestionId);
  if (!row) throw new ServiceHttpError('Reviewer suggestion not found', { httpStatus: 404 });
  if (!row._wmkf_request_value
      || String(row._wmkf_request_value).toLowerCase() !== requestId.toLowerCase()) {
    throw new ServiceHttpError('Reviewer suggestion does not belong to this request', { httpStatus: 409 });
  }
  if (row.wmkf_accepted !== true
      || row.wmkf_reviewreceivedat
      || row.wmkf_completedat
      || TERMINAL_VALUES.has(row.wmkf_reviewstatus)
      || !ALLOWED_SOURCE_VALUES.has(row.wmkf_reviewstatus)
      || !row._etag) {
    throw new ServiceHttpError('Reviewer lifecycle changed; reload before repairing', { httpStatus: 409 });
  }
  // Two-date model (owner decision S369): wmkf_reviewduedateatsend is the
  // first deadline committed to and is IMMUTABLE once written;
  // wmkf_reviewduedatelastsent is the deadline last communicated and is
  // updated on every send — including a repair for a re-send.
  //
  // The earlier "a different review due date is already recorded" 409 is gone
  // deliberately: under one date it protected the stamp from being rewritten,
  // but it also refused the legitimate case this endpoint exists for — a
  // SECOND materials send, at a changed deadline, whose inline stamp failed.
  // The protection it provided is preserved structurally instead: `atSend` is
  // only ever written when currently empty, so a client-supplied
  // effectiveReviewDueDate can never overwrite the first commitment. It can
  // only move `lastSent`, which is by definition the mutable one. (Staff can
  // already influence the recorded deadline through the ordinary
  // campaign-config / render-override path, so this is not a new capability —
  // but `atSend` stays out of reach either way.)
  const atSendRecorded = Boolean(row.wmkf_reviewduedateatsend);
  if (atSendRecorded && row.wmkf_reviewduedatelastsent === effectiveReviewDueDate) {
    return { ok: true, status: 'already_recorded', suggestionId };
  }

  await suggestionAdapter.updateLifecycle(suggestionId, {
    reviewDueDateLastSent: effectiveReviewDueDate,
    ...(atSendRecorded ? {} : { reviewDueDateAtSend: effectiveReviewDueDate }),
    ...(row.wmkf_materialssentat ? {} : { materialsSentAt: parsedSentAt.toISOString() }),
    ...(row.wmkf_reviewstatus === suggestionAdapter.REVIEW_STATUS_MAP.accepted
      ? { reviewStatus: 'materials_sent' }
      : {}),
  }, { actingUserSystemId, ifMatch: row._etag });

  return { ok: true, status: 'repaired', suggestionId };
}
