/**
 * Pure helpers for the reviewer-invitation send path. Kept separate so the
 * safety-critical duplicate-send decision is unit-testable without standing up
 * the full send-emails SSE handler.
 */

/**
 * True when an invitation send to this suggestion should be SKIPPED to avoid a
 * duplicate real email. Only the invitation flow is guarded — materials/followup/
 * thankyou are intentionally re-sendable. A deliberate re-invite (`allowResend`)
 * overrides the guard.
 *
 * @param {object} p
 * @param {string} p.templateType
 * @param {boolean} p.allowResend
 * @param {boolean} p.invited - the suggestion row's current wmkf_invited value
 * @returns {boolean}
 */
function shouldSkipDuplicateInvitation({ templateType, allowResend, invited }) {
  return templateType === 'invitation' && !allowResend && invited === true;
}

/**
 * Whether an email send of this type may carry attachments. A pre-acceptance
 * INVITATION must carry NONE (no proposal materials before the reviewer accepts
 * + acks COI/AI policy); materials/followup/thankyou are post-acceptance and may.
 *
 * @param {string} templateType
 * @returns {boolean}
 */
function sendAllowsAttachments(templateType) {
  return templateType !== 'invitation';
}

/**
 * SERVER-authoritative attachment gate: proposal materials may only ride on an
 * email to a recipient who has actually ACCEPTED. This is keyed on the suggestion
 * row's `wmkf_accepted` (server state), NOT the caller-supplied templateType — so
 * a pre-acceptance or mislabeled send can never leak materials.
 *
 * @param {object} suggestion - the wmkf_appreviewersuggestion row
 * @returns {boolean}
 */
function recipientMayReceiveAttachments(suggestion) {
  return suggestion?.wmkf_accepted === true;
}

module.exports = { shouldSkipDuplicateInvitation, sendAllowsAttachments, recipientMayReceiveAttachments };
