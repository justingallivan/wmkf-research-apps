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

// Slice G — invite-confidence. An email earns HIGH only when its provenance anchors it to
// the reviewer's resolved identity:
//   - orcid/pubmed/institution_page are authoritative/identity-sourced.
//   - serp_search/claude_search require an identity anchor before the search runs (Fix A)
//     and pass the Scholar-domain contradiction gate (Fix C), but ONLY when the row's
//     identity actually resolved (confirmed/probable) — a search email on an unconfirmed
//     identity is not anchored.
// Everything else is LOW and prompts a staff confirm at the send step: a manually-typed
// address, an affiliation-string-derived one (exempt from the Scholar-domain contradiction
// check, so less anchored), or an unknown/legacy source.
const HIGH_TRUST_EMAIL_SOURCES = new Set(['orcid', 'pubmed', 'institution_page']);
const ANCHORED_SEARCH_EMAIL_SOURCES = new Set(['serp_search', 'claude_search']);
const ANCHORED_IDENTITY_STATUSES = new Set(['confirmed', 'probable']);

/**
 * Deterministic email-confidence for the invite send gate (no model call). Accepts either a
 * raw person row (`wmkf_emailsource`/`wmkf_identitystatus`) or a normalized
 * (`emailSource`/`identityStatus`) shape.
 *
 * @param {object} person
 * @returns {{ level: 'high'|'low', reason: string }}
 */
function emailConfidence(person) {
  const source = String(person?.wmkf_emailsource ?? person?.emailSource ?? '').trim().toLowerCase();
  const identity = String(person?.wmkf_identitystatus ?? person?.identityStatus ?? '').trim().toLowerCase();

  if (HIGH_TRUST_EMAIL_SOURCES.has(source)) {
    return { level: 'high', reason: `Address source: ${source}` };
  }
  if (ANCHORED_SEARCH_EMAIL_SOURCES.has(source) && ANCHORED_IDENTITY_STATUSES.has(identity)) {
    return { level: 'high', reason: `${source} address on a ${identity} identity` };
  }

  let reason;
  if (source === 'manual') reason = 'Manually entered — not verified against the reviewer’s identity';
  else if (source === 'affiliation') reason = 'Derived from an affiliation string — not verified against the identity';
  else if (!source) reason = 'No recorded source for this address';
  else if (ANCHORED_SEARCH_EMAIL_SOURCES.has(source)) reason = `${source} address on an unconfirmed identity`;
  else reason = `Unrecognized address source: ${source}`;
  return { level: 'low', reason };
}

module.exports = {
  shouldSkipDuplicateInvitation,
  sendAllowsAttachments,
  recipientMayReceiveAttachments,
  emailConfidence,
};
