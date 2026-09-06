/**
 * Reviewer engagement — invitation-record writers
 * (Reviewer Lifecycle Stage 3F: three separately exported functions, each a
 * verbatim move of exactly one write call. They intentionally do not share a
 * helper: delivered evidence (post-send, unconditional) is not the same
 * event as a manual verified-link record (pre-validated token, conditional
 * on the current ETag) or a legacy generation mark (no delivery at all).
 * Collapsing them into a shared "stamp invited" helper would blur that
 * distinction, so each function is left as a thin, direct passthrough to the
 * adapter call it replaced.)
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';

// `lib/services/review-manager/send-emails-service.js` — the inline
// post-send invitation stamp. Unconditional: no `ifMatch` (owner decision
// D1). The email has already shipped by the time this runs, so the caller
// treats a rejection as `inviteRecorded: false` rather than losing the
// send to a scrolling warning; this function itself adds no retry or
// validation beyond what the caller already had.
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

// `lib/services/reviewer-finder/generate-emails-service.js` — the legacy
// generation mark-as-sent. Preserved verbatim (owner decision D2): raw
// entity fields, no `ifMatch`, no `actingUserSystemId`.
export async function markInvitationGenerated({ suggestionId, now }) {
  await suggestionAdapter.patchFields(suggestionId, { wmkf_emailsentat: now, wmkf_invited: true });
}
