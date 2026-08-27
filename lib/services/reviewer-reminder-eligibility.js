/**
 * Shared reviewer-reminder eligibility predicates.
 *
 * One source of truth for "may this suggestion still receive a respond-by /
 * review-due nudge" and for resolving the reviewer's current delivery email,
 * consumed by:
 *   - the manual "Send reminder now" actions (`reviewer-manual-reminder.js`),
 *   - the scheduled-email ledger delivery strategies
 *     (`reviewer-reminder-workflows.js`), which re-check from a fresh read at
 *     send time.
 *
 * The predicates mirror the cron sweeps' OData filters
 * (`reviewer-reminder-sweep.js`) — the sweeps encode the same conditions
 * server-side for the scan; these run against a freshly read row.
 */

import { isExcluded, getByIdWithSelect } from '../dataverse/adapters/reviewer-suggestion.js';
import { getByIdWithSelect as getReviewerByIdWithSelect } from '../dataverse/adapters/potential-reviewer.js';

export const REVIEW_STATUS_MATERIALS_SENT = 100000001;
export const REVIEW_STATUS_UNDER_REVIEW = 100000002;

export const REMINDER_SUGGESTION_SELECT = [
  'wmkf_appreviewersuggestionid',
  '_wmkf_request_value',
  '_wmkf_potentialreviewer_value',
  'wmkf_selected',
  'wmkf_externaltokenrevoked',
  'wmkf_externaltokenexpires',
  'wmkf_invited',
  'wmkf_emailsentat',
  'wmkf_accepted',
  'wmkf_declined',
  'wmkf_responsetype',
  'wmkf_reviewstatus',
  'wmkf_reviewreceivedat',
  'wmkf_applicantdisposition',
  'wmkf_remindercount',
  'wmkf_respondremindersentat',
  'wmkf_remindersentat',
  'wmkf_reviewduedateoverride',
].join(',');

/** Fresh suggestion read for eligibility/authorization. 404 → { row: null }. */
export async function readReminderSuggestion(suggestionId) {
  try {
    return { row: await getByIdWithSelect(suggestionId, REMINDER_SUGGESTION_SELECT), error: null };
  } catch (error) {
    if (error?.status === 404) return { row: null, error: null };
    return { row: null, error };
  }
}

/** Resolve the current reviewer row through the same source used by the sweeps. */
export async function loadReminderReviewer(personId) {
  if (!personId) return null;
  return getReviewerByIdWithSelect(personId, {
    select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress',
  }).catch(() => null);
}

export function sharedRefusalReason(row, requestId) {
  if (row._wmkf_request_value !== requestId) return 'ineligible';
  if (row.wmkf_selected !== true) return 'removed';
  if (row.wmkf_externaltokenrevoked === true) return 'revoked';
  if (isExcluded(row)) return 'ineligible';
  return null;
}

export function respondRefusalReason(row, requestId) {
  const sharedReason = sharedRefusalReason(row, requestId);
  if (sharedReason) return sharedReason;
  if (row.wmkf_invited !== true || !row.wmkf_emailsentat) return 'ineligible';
  if (row.wmkf_accepted === true || row.wmkf_declined === true || row.wmkf_responsetype != null) {
    return 'ineligible';
  }
  return null;
}

export function reviewDueRefusalReason(row, requestId) {
  const sharedReason = sharedRefusalReason(row, requestId);
  if (sharedReason) return sharedReason;
  if (row.wmkf_accepted !== true) return 'ineligible';
  const materialsSent = row.wmkf_reviewstatus === REVIEW_STATUS_MATERIALS_SENT
    || row.wmkf_reviewstatus === REVIEW_STATUS_UNDER_REVIEW;
  if (!materialsSent || row.wmkf_reviewreceivedat) return 'ineligible';
  return null;
}
