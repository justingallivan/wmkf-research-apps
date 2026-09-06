/**
 * Reviewer engagement — invitation-record writers
 * (Reviewer Lifecycle Stage 3F: separately exported functions, each a
 * verbatim move of exactly one write call. They intentionally do not share a
 * helper: delivered evidence (post-send, unconditional) is not the same
 * event as a manual verified-link record (pre-validated token, conditional
 * on the current ETag). Collapsing them into a shared "stamp invited" helper
 * would blur that distinction, so each function is left as a thin, direct
 * passthrough to the adapter call it replaced. The third Stage 3F function,
 * `markInvitationGenerated` — the legacy generate-emails "mark as sent at
 * generation time" write — was retired with that route on 2026-09-06 under
 * owner decision D2; real sends stamp `invited` via recordDeliveredInvitation.)
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';

// `lib/services/review-manager/send-emails-service.js` — the inline
// post-send invitation stamp. Unconditional: no `ifMatch` — open owner
// decision D1 (carried, not taken; current behavior preserved pending it).
// See the caller's comment (send-emails-service.js ~:925-930) for why:
// this function itself adds no retry or validation beyond what the caller
// already had.
export async function recordDeliveredInvitation({ suggestionId, actingUserSystemId }) {
  await suggestionAdapter.updateLifecycle(suggestionId, {
    invited: true,
    emailSentAt: new Date().toISOString(),
    respondReminderSentAt: null,
  }, { actingUserSystemId });
}

// `lib/services/reviewer-finder/my-candidates-service.js` — the manual
// verified-link invite record. Conditional on the caller's current ETag
// (`ifMatch`), so another preview replacing the token in flight surfaces as
// a rejection instead of silently overwriting a newer link's state.
export async function recordManualInvitation({ suggestionId, emailSentAt, ifMatch, actingUserSystemId }) {
  await suggestionAdapter.updateLifecycle(suggestionId, {
    invited: true,
    emailSentAt,
    respondReminderSentAt: null,
  }, { actingUserSystemId, ifMatch });
}
