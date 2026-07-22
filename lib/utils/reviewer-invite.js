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

// Address-action buckets for first-contact invitations:
//   ready         — identity-owned first-party evidence, or the same address on
//                   two distinct recent scholarly works.
//   quick_check   — one structured scholarly work or a legacy/manual source.
//   research_only — a search lead without address-specific first-party evidence;
//                   it is never sendable, even after a checkbox confirmation.
//   missing       — no address.
//
// `level` remains in the return value for backward-compatible UI consumers, but
// `action` is the server-authoritative send policy.
const READY_EMAIL_SOURCES = new Set(['orcid', 'institution_page', 'scholarly_multi']);
const RESEARCH_ONLY_EMAIL_SOURCES = new Set(['serp_search', 'claude_search', 'search_contested']);

/**
 * Deterministic email-confidence for the invite send gate (no model call). Accepts either a
 * raw person row (`wmkf_emailsource`/`wmkf_identitystatus`) or a normalized
 * (`emailSource`/`identityStatus`) shape.
 *
 * @param {object} person
 * @returns {{ level: 'high'|'low', action: 'ready'|'quick_check'|'research_only'|'missing', reason: string }}
 */
function emailConfidence(person) {
  const source = String(person?.wmkf_emailsource ?? person?.emailSource ?? '').trim().toLowerCase();
  const hasExplicitEmail = ['email', 'wmkf_emailaddress', 'emailaddress1']
    .some((field) => Object.prototype.hasOwnProperty.call(person || {}, field));
  const email = person?.email ?? person?.wmkf_emailaddress ?? person?.emailaddress1 ?? null;

  if (hasExplicitEmail && !String(email || '').trim()) {
    return { level: 'low', action: 'missing', reason: 'No email address found' };
  }

  if (READY_EMAIL_SOURCES.has(source)) {
    return { level: 'high', action: 'ready', reason: `Address source: ${source}` };
  }

  if (RESEARCH_ONLY_EMAIL_SOURCES.has(source)) {
    const reason = source === 'search_contested'
      ? 'Search lead conflicts with verified identity evidence'
      : 'Search lead lacks address-specific first-party evidence';
    return { level: 'low', action: 'research_only', reason };
  }

  let reason;
  if (source === 'manual') reason = 'Manually entered — not verified against the reviewer’s identity';
  else if (source === 'affiliation') reason = 'Derived from an affiliation string — not verified against the identity';
  else if (source === 'scholarly_single') reason = 'Confirmed in one recent author-affiliation record — quick check recommended';
  else if (source === 'pubmed') reason = 'Legacy PubMed address with only one recorded publication — quick check recommended';
  else if (!source) reason = 'No recorded source for this address';
  else reason = `Unrecognized address source: ${source}`;
  return { level: 'low', action: 'quick_check', reason };
}

module.exports = {
  shouldSkipDuplicateInvitation,
  sendAllowsAttachments,
  isKnownTemplateType,
  recipientMayReceiveAttachments,
  emailConfidence,
};
