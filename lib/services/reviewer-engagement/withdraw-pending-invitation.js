/**
 * Reviewer engagement — conditional pending→withdrawn_sufficient write
 * (Stage 3 build plan, slice 3I).
 *
 * Extracted verbatim from `review-manager/withdraw-sufficient-service.js`'s
 * authoritative state change (main `:265`): the still-pending → withdrawn
 * write, conditioned on the row's `_etag`. The caller keeps everything else
 * (per-id result mapping, the `withdrawn` counter, and the courtesy email) —
 * this module is only the write. Errors propagate to the caller unchanged;
 * mapping a 412 to `changed_skipped` (else `write_failed`) stays in the caller.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';

export async function withdrawPendingInvitation({ id, nowIso, ifMatch, actingUserSystemId }) {
  await suggestionAdapter.updateLifecycle(id, {
    responseType: 'withdrawn_sufficient',
    withdrawnSufficientAt: nowIso,
    respondReminderSentAt: null,
  }, { actingUserSystemId, ifMatch });
}
