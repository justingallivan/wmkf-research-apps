/**
 * Repair a materials email lifecycle stamp without sending another email.
 * This is the actionable recovery path returned by send-emails when dispatch
 * succeeded but the inline ETag-guarded write did not.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../../../shared/config/reviewerStatus';
import { ServiceHttpError } from '../service-http-error';
import { verifyMaterialsSendRepairReceipt } from './materials-send-repair-receipt';

const ALLOWED_SOURCE_VALUES = new Set([
  suggestionAdapter.REVIEW_STATUS_MAP.accepted,
  suggestionAdapter.REVIEW_STATUS_MAP.materials_sent,
  suggestionAdapter.REVIEW_STATUS_MAP.under_review,
]);
const TERMINAL_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

export async function repairMaterialsSendStamp({
  repairReceipt,
  actingUserSystemId,
}) {
  let evidence;
  try {
    evidence = verifyMaterialsSendRepairReceipt(repairReceipt);
  } catch (error) {
    throw new ServiceHttpError(error.message, { httpStatus: 409 });
  }

  const {
    requestId,
    suggestionId,
    effectiveReviewDueDate,
    materialsSentAt,
  } = evidence;

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
  const signedDispatchTime = new Date(materialsSentAt).getTime();
  const recordedDispatchTime = row.wmkf_materialssentat
    ? new Date(row.wmkf_materialssentat).getTime()
    : null;
  if (recordedDispatchTime !== null && !Number.isFinite(recordedDispatchTime)) {
    throw new ServiceHttpError('Reviewer lifecycle has an invalid materials dispatch timestamp', { httpStatus: 409 });
  }
  const sameDispatchTime = recordedDispatchTime === signedDispatchTime;
  const sameDueDate = row.wmkf_reviewduedatelastsent === effectiveReviewDueDate;
  // Exact idempotency key: the HMAC-verified
  // (suggestionId, materialsSentAt, effectiveReviewDueDate) tuple. The latter
  // two values are durably present on this row after a successful inline stamp
  // or repair, so a lost HTTP response can be retried without a second write.
  if (sameDispatchTime && sameDueDate) {
    return { ok: true, status: 'already_recorded', suggestionId };
  }
  if (sameDispatchTime) {
    throw new ServiceHttpError(
      'A different due date is already recorded for this dispatch timestamp',
      { httpStatus: 409 },
    );
  }
  if (recordedDispatchTime !== null && recordedDispatchTime > signedDispatchTime) {
    throw new ServiceHttpError('A newer materials dispatch is already recorded', { httpStatus: 409 });
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
  // only ever written when currently empty, so the receipt-carried rendered
  // date can never overwrite the first commitment. It can only move
  // `lastSent`, which is by definition the mutable one. The date and dispatch
  // time are not client assertions: send-emails signed them only after the
  // dispatch call returned. The receipt also carries the exact pre-dispatch
  // ETag as evidence of the send's source row. It is deliberately NOT used as
  // a one-use nonce: an earlier dispatch may have advanced the row version
  // before this later signed receipt is repaired. This write instead uses the
  // fresh ETag from the eligibility read above. An equal tuple is the
  // already-recorded no-op; an older tuple is rejected; only a newer signed
  // dispatch may advance the mutable ledger.
  const atSendRecorded = Boolean(row.wmkf_reviewduedateatsend);
  try {
    await suggestionAdapter.updateLifecycle(suggestionId, {
      reviewDueDateLastSent: effectiveReviewDueDate,
      ...(atSendRecorded ? {} : { reviewDueDateAtSend: effectiveReviewDueDate }),
      materialsSentAt,
      ...(row.wmkf_reviewstatus === suggestionAdapter.REVIEW_STATUS_MAP.accepted
        ? { reviewStatus: 'materials_sent' }
        : {}),
    }, { actingUserSystemId, ifMatch: row._etag });
  } catch (error) {
    if (error?.status === 412 || error?.response?.status === 412) {
      // A concurrent retry of this same signed receipt may have committed
      // between our eligibility read and write. Re-read before treating the
      // 412 as a conflict: exact signed claims are an idempotent success, but
      // terminal/submitted/foreign rows and different claims still fail
      // closed.
      const current = await suggestionAdapter.findById(suggestionId);
      const currentDispatchTime = current?.wmkf_materialssentat
        ? new Date(current.wmkf_materialssentat).getTime()
        : null;
      const currentIsEligible = current
        && current._wmkf_request_value
        && String(current._wmkf_request_value).toLowerCase() === requestId.toLowerCase()
        && current.wmkf_accepted === true
        && !current.wmkf_reviewreceivedat
        && !current.wmkf_completedat
        && !TERMINAL_VALUES.has(current.wmkf_reviewstatus)
        && ALLOWED_SOURCE_VALUES.has(current.wmkf_reviewstatus);
      if (currentIsEligible
          && currentDispatchTime === signedDispatchTime
          && current.wmkf_reviewduedatelastsent === effectiveReviewDueDate) {
        return { ok: true, status: 'already_recorded', suggestionId };
      }
      throw new ServiceHttpError('Reviewer lifecycle changed before repair could be recorded', { httpStatus: 409 });
    }
    throw error;
  }

  return { ok: true, status: 'repaired', suggestionId };
}
