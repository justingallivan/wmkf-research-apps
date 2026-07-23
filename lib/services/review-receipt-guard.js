/**
 * Shared authorization contract for every request-time review receipt write.
 *
 * A receipt writer may only use the ETag returned by the same row read that
 * passed these checks. That couples terminal/finality eligibility to the
 * PATCH/changeset and closes the transition-vs-receipt race for every sink.
 */

import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus';

const TERMINAL_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

export const REVIEW_RECEIPT_GUARD_SELECT = [
  'wmkf_appreviewersuggestionid',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_reviewreceivedat',
  'wmkf_reviewstatus',
].join(',');

export class ReviewReceiptEligibilityError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ReviewReceiptEligibilityError';
    this.reason = reason;
  }
}

/**
 * Authorize a receipt write and return the exact row-version token it must use.
 */
export function authorizeReviewReceipt(row) {
  if (!row) throw new ReviewReceiptEligibilityError('not_found');
  if (TERMINAL_VALUES.has(row.wmkf_reviewstatus)) {
    throw new ReviewReceiptEligibilityError('engagement_ended');
  }
  if (row.wmkf_reviewreceivedat) {
    throw new ReviewReceiptEligibilityError('review_received_locked');
  }
  if (row.wmkf_accepted !== true || row.wmkf_declined === true) {
    throw new ReviewReceiptEligibilityError('not_eligible');
  }
  if (!row._etag) throw new ReviewReceiptEligibilityError('conflict');
  return { ifMatch: row._etag };
}

export function isReviewReceiptPreconditionFailure(error) {
  return error?.status === 412 || error?.response?.status === 412;
}

/** Classify the row that won a failed If-Match race for caller-facing output. */
export function classifyReviewReceiptConflict(row) {
  if (TERMINAL_VALUES.has(row?.wmkf_reviewstatus)) return 'engagement_ended';
  if (row?.wmkf_reviewreceivedat) return 'review_received_locked';
  return 'conflict';
}
