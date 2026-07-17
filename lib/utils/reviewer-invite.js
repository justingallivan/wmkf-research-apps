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
// First-contact template types whose re-send to an already-invited reviewer is
// guarded (an accidental re-click/retry must not fire a second real first-contact
// email). Materials/followup/thankyou are intentionally re-sendable.
const FIRST_CONTACT_TEMPLATES = new Set(['invitation']);

function shouldSkipDuplicateInvitation({ templateType, allowResend, invited }) {
  return FIRST_CONTACT_TEMPLATES.has(templateType) && !allowResend && invited === true;
}

// Allowlist of template types whose email may carry PROPOSAL-MATERIAL attachments
// (cycle template + additional materials). Everything else — including
// pre-acceptance invitation — carries no materials by default.
// An ALLOWLIST (not a denylist) so a NEW template type is material-free unless it's
// explicitly added here (Codex chunk-5 #2: a denylist let any new type leak materials).
const MATERIAL_BEARING_TEMPLATES = new Set(['materials', 'followup', 'thankyou']);

/**
 * Whether an email send of this type may carry proposal-material attachments.
 *
 * @param {string} templateType
 * @returns {boolean}
 */
function sendAllowsAttachments(templateType) {
  return MATERIAL_BEARING_TEMPLATES.has(templateType);
}

// Every template type the send path knows how to handle (copy + lifecycle). An
// UNKNOWN type must be rejected before any real email goes out — otherwise it sends
// with no lifecycle stamp and (under the allowlist) silently no materials (Codex
// chunk-6 #4: no default/unknown guard).
const KNOWN_TEMPLATE_TYPES = new Set(['invitation', 'materials', 'followup', 'thankyou']);

/**
 * @param {string} templateType
 * @returns {boolean}
 */
function isKnownTemplateType(templateType) {
  return KNOWN_TEMPLATE_TYPES.has(templateType);
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
//   - serp_search/claude_search remain LOW even when the PERSON identity is resolved:
//     search snippets/model output do not by themselves prove that the ADDRESS belongs
//     to that person. A server-fetched, candidate-associated page is re-sourced as
//     institution_page before it can earn HIGH.
// Everything else is LOW and prompts a staff confirm at the send step: a manually-typed
// address, an affiliation-string-derived one (exempt from the Scholar-domain contradiction
// check, so less anchored), or an unknown/legacy source.
const HIGH_TRUST_EMAIL_SOURCES = new Set(['orcid', 'pubmed', 'institution_page']);
const SEARCH_EMAIL_SOURCES = new Set(['serp_search', 'claude_search']);

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

  if (HIGH_TRUST_EMAIL_SOURCES.has(source)) {
    return { level: 'high', reason: `Address source: ${source}` };
  }

  let reason;
  if (source === 'manual') reason = 'Manually entered — not verified against the reviewer’s identity';
  else if (source === 'affiliation') reason = 'Derived from an affiliation string — not verified against the identity';
  else if (source === 'search_contested') reason = 'Found by search but requires staff confirmation before inviting';
  else if (SEARCH_EMAIL_SOURCES.has(source)) reason = 'Found by search without address-specific first-party evidence';
  else if (!source) reason = 'No recorded source for this address';
  else reason = `Unrecognized address source: ${source}`;
  return { level: 'low', reason };
}

module.exports = {
  shouldSkipDuplicateInvitation,
  sendAllowsAttachments,
  isKnownTemplateType,
  recipientMayReceiveAttachments,
  emailConfidence,
};
