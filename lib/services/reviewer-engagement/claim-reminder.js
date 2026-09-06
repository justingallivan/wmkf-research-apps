/**
 * Reviewer engagement — review-due reminder claim
 * (Reviewer Lifecycle Stage 3G: extracted from the `kind !== 'respond'` branch
 * of the fire-once claim in `lib/services/reviewer-reminder-sweep.js`).
 *
 * Respond-kind reminders re-mint a token, so their claim (marker + token,
 * written atomically) stays coupled to `mintAndStore` in the sweep — that
 * atomicity is the token-lifecycle module's contract, not this one's.
 * Review-due reminders never mint or replace token authority; their claim is
 * only the ETag-guarded marker/count write below, moved here verbatim. The
 * sweep's try/catch (412 → `claimFailed`, any other error → `prepareFailed`)
 * stays in the sweep — this function lets every error propagate untouched.
 */

import { updateLifecycle } from '../../dataverse/adapters/reviewer-suggestion';

/**
 * @param {Object} args
 * @param {string} args.id - suggestion id
 * @param {{ wmkf_remindersentat: string, wmkf_remindercount: number }} args.claimPatch
 * @param {string|undefined} args.claimIfMatch - ETag guard; passed through as-is
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<void>} resolves on a successful claim; throws (412 or otherwise) on failure
 */
export async function claimReviewDueReminder({ id, claimPatch, claimIfMatch, actingUserSystemId }) {
  await updateLifecycle(id, {
    reminderSentAt: claimPatch.wmkf_remindersentat,
    reminderCount: claimPatch.wmkf_remindercount,
  }, { actingUserSystemId, ifMatch: claimIfMatch });
}
