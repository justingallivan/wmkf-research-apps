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
  if (row.wmkf_reviewduedateatsend) {
    if (row.wmkf_reviewduedateatsend !== effectiveReviewDueDate) {
      throw new ServiceHttpError('A different review due date is already recorded', { httpStatus: 409 });
    }
    return { ok: true, status: 'already_recorded', suggestionId };
  }

  await suggestionAdapter.updateLifecycle(suggestionId, {
    reviewDueDateAtSend: effectiveReviewDueDate,
    ...(row.wmkf_materialssentat ? {} : { materialsSentAt: parsedSentAt.toISOString() }),
    ...(row.wmkf_reviewstatus === suggestionAdapter.REVIEW_STATUS_MAP.accepted
      ? { reviewStatus: 'materials_sent' }
      : {}),
  }, { actingUserSystemId, ifMatch: row._etag });

  return { ok: true, status: 'repaired', suggestionId };
}
