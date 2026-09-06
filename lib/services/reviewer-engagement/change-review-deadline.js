/**
 * Reviewer engagement — review deadline override write command
 * (Reviewer Lifecycle Stage 3H: extracted from
 * `lib/services/reviewer-due-extension.js`, which still owns eligibility
 * checks, exact-date validation, the `_etag` presence check,
 * `prepareNotification`, the notification envelope, and the
 * `try`/`catch`/`classifySaveError` failure mapping around this call.
 *
 * This module holds only the conditional deadline-override write itself.
 */

import { updateLifecycle } from '../../dataverse/adapters/reviewer-suggestion.js';

/**
 * Persist a new `reviewDueDateOverride` (or `null` to clear it and restore
 * the request date) on the given suggestion. Errors propagate to the caller;
 * no validation is added here.
 */
export async function changeReviewDeadline({
  suggestionId,
  reviewDueDateOverride,
  ifMatch,
  actingUserSystemId,
} = {}) {
  return updateLifecycle(suggestionId, { reviewDueDateOverride }, {
    actingUserSystemId,
    ifMatch,
  });
}
