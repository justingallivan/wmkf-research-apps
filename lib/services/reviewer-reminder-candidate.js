/**
 * Side-effect-free OData predicate shared by the review-due reminder sweep and
 * its read-only liveness audit. Keeping this outside the send service lets the
 * audit reuse the exact production population without importing email, token
 * minting, lifecycle writes, or maintenance-run code.
 */
import {
  APPLICANT_DISPOSITION_EXCLUDED,
  REVIEW_STATUS_MAP,
} from '../../shared/config/reviewerLifecycle.js';

export const REVIEW_STATUS_MATERIALS_SENT = REVIEW_STATUS_MAP.materials_sent;
export const REVIEW_STATUS_UNDER_REVIEW = REVIEW_STATUS_MAP.under_review;

export function reviewDueCandidateFilter() {
  return `wmkf_accepted eq true `
    + `and (wmkf_reviewstatus eq ${REVIEW_STATUS_MATERIALS_SENT} or wmkf_reviewstatus eq ${REVIEW_STATUS_UNDER_REVIEW}) `
    + `and wmkf_reviewreceivedat eq null and wmkf_remindersentat eq null `
    + `and wmkf_selected eq true `
    + `and (wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null) `
    + `and (wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne ${APPLICANT_DISPOSITION_EXCLUDED})`;
}
