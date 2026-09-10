/**
 * Reviewer engagement — conditional pending→release write
 * (Stage 3 build plan, slice 3I).
 *
 * Extracted verbatim from `review-manager/withdraw-sufficient-service.js`'s
 * authoritative state change (main `:265`): the still-pending → released
 * write, conditioned on the row's `_etag`. The caller keeps everything else
 * (per-id result mapping, the `withdrawn` counter, and the courtesy email) —
 * this module is only the write. Errors propagate to the caller unchanged;
 * mapping a 412 to `changed_skipped` (else `write_failed`) stays in the caller.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { RELEASE_REASON_VALUES, RELEASE_REASONS } from '../../../shared/config/reviewerLifecycle';

export async function withdrawPendingInvitation({
  id,
  nowIso,
  ifMatch,
  actingUserSystemId,
  reason = RELEASE_REASONS.no_longer_needed,
}) {
  if (!RELEASE_REASON_VALUES.includes(reason)) {
    throw new Error('withdrawPendingInvitation: unknown release reason');
  }
  const updates = reason === RELEASE_REASONS.no_response
    ? {
      responseType: 'no_response',
      responseReceivedAt: nowIso,
      respondReminderSentAt: null,
      externalTokenRevoked: true,
    }
    : {
      responseType: 'withdrawn_sufficient',
      withdrawnSufficientAt: nowIso,
      respondReminderSentAt: null,
    };
  await suggestionAdapter.updateLifecycle(id, {
    ...updates,
  }, { actingUserSystemId, ifMatch });
}
