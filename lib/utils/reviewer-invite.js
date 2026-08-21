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
// The quick-check sources, named explicitly so provenance PRECEDENCE can be computed
// without re-deriving it from emailConfidence's branch order. `reviewer-invite.test.js`
// asserts this set agrees with emailConfidence for every member, so the two statements
// of the same fact cannot drift.
const QUICK_CHECK_EMAIL_SOURCES = new Set(['manual', 'staff_verified', 'affiliation', 'scholarly_single', 'pubmed']);

/**
 * Which send-gate tier a stored address SOURCE belongs to, for provenance precedence.
 *
 * Returns null for an absent or unrecognized source. Deliberate asymmetry with
 * `emailConfidence`, which classifies an unknown source as `quick_check` so a live send
 * still asks for a human check: an unknown source is treated as sendable-with-check but
 * earns NO precedence claim, so it can neither upgrade nor displace a known source.
 *
 * @param {string|null|undefined} source
 * @returns {'ready'|'quick_check'|'research_only'|null}
 */
function emailSourceTier(source) {
  const value = String(source ?? '').trim().toLowerCase();
  if (!value) return null;
  if (READY_EMAIL_SOURCES.has(value)) return 'ready';
  if (RESEARCH_ONLY_EMAIL_SOURCES.has(value)) return 'research_only';
  if (QUICK_CHECK_EMAIL_SOURCES.has(value)) return 'quick_check';
  return null;
}

const EMAIL_SOURCE_TIER_RANK = Object.freeze({ research_only: 1, quick_check: 2, ready: 3 });

// Sources that record a HUMAN's assertion about an address rather than machine evidence:
// `manual` (a staffer typed it) and `staff_verified` (a staffer confirmed a system-found
// one against an independent source).
const HUMAN_ASSERTED_EMAIL_SOURCES = new Set(['manual', 'staff_verified']);

function isHumanAssertedEmailSource(source) {
  return HUMAN_ASSERTED_EMAIL_SOURCES.has(String(source ?? '').trim().toLowerCase());
}

/**
 * Does `incoming` describe strictly better address provenance than `stored`?
 * Unknown/absent on either side answers false — precedence needs two known claims.
 *
 * Pure tier comparison. Whether an upgrade is PERMITTED is `emailSourceUpgradeAllowed`.
 */
function emailSourceOutranks(incoming, stored) {
  const incomingTier = emailSourceTier(incoming);
  const storedTier = emailSourceTier(stored);
  if (!incomingTier || !storedTier) return false;
  return EMAIL_SOURCE_TIER_RANK[incomingTier] > EMAIL_SOURCE_TIER_RANK[storedTier];
}

/**
 * May an automated writer replace `stored` with the stronger `incoming` source?
 *
 * Strictly better tier, AND the stored value is not a human assertion. A stored
 * `manual`/`staff_verified` is TERMINAL against machine evidence (S387, after adversarial
 * review): its quick-check tier is not merely a weaker evidence claim, it is what keeps a
 * human in the loop at send time for an address a person had to vouch for. Promoting it to
 * `ready` on later machine evidence would silently remove that recipient's send-time
 * acknowledgement — and, because the person row is shared across requests, would remove it
 * everywhere, including the request where the staffer made the assertion. The cost of
 * keeping it terminal is one checkbox per send; the cost of upgrading it is a checkpoint
 * disappearing without anyone deciding that.
 *
 * A HUMAN can still supersede a human: `manual` and `search_contested` overwrite
 * unconditionally in the adapter, so a staff re-entry or fresh contradicting evidence
 * still moves the value.
 */
function emailSourceUpgradeAllowed(incoming, stored) {
  if (isHumanAssertedEmailSource(stored)) return false;
  return emailSourceOutranks(incoming, stored);
}

/**
 * Deterministic email-confidence for the invite send gate (no model call). Accepts either a
 * raw person row (`wmkf_emailsource`/`wmkf_identitystatus`) or a normalized
 * (`emailSource`/`identityStatus`) shape.
 *
 * @param {object} person
 * @returns {{ level: 'high'|'low', action: 'ready'|'quick_check'|'research_only'|'missing'|'blocked', reason: string, code?: string, remediation?: object[] }}
 */
function emailConfidence(person) {
  const source = String(person?.wmkf_emailsource ?? person?.emailSource ?? '').trim().toLowerCase();
  const hasExplicitEmail = ['email', 'wmkf_emailaddress', 'emailaddress1']
    .some((field) => Object.prototype.hasOwnProperty.call(person || {}, field));
  const email = person?.email ?? person?.wmkf_emailaddress ?? person?.emailaddress1 ?? null;

  if (hasExplicitEmail && !String(email || '').trim()) {
    return { level: 'low', action: 'missing', reason: 'No email address found' };
  }

  // A durable contradiction is a hard block for every new reviewer email. This
  // precedes source-tier handling so a formerly-ready source cannot fail open.
  const {
    addressTrustDecision,
    staffAddressChoiceProjection,
    STAFF_ADDRESS_CHOICE_REASON,
  } = require('./reviewer-address-trust');
  const trust = addressTrustDecision({
    ...person,
    email,
    addressTrustStateJson: person?.wmkf_addresstruststatejson ?? person?.addressTrustStateJson,
  });
  if (trust.status === 'conflict_pending') {
    return {
      level: 'low',
      action: 'blocked',
      code: 'address_conflict_pending',
      reason: 'A newly found address conflicts with the stored reviewer address',
      remediation: [
        { action: 'resolve_address_conflict', label: 'Review both addresses' },
        { action: 'create_repair_request', label: 'Create repair request' },
      ],
    };
  }

  // Only a valid versioned bundle for the exact current email upgrades a
  // staff_verified source to ready. Legacy/source-only rows remain quick-check.
  if (source === 'staff_verified' && trust.status === 'staff_verified') {
    const staffChoice = staffAddressChoiceProjection(trust.state, { email });
    return {
      level: 'high',
      action: 'ready',
      reason: staffChoice
        ? STAFF_ADDRESS_CHOICE_REASON
        : 'Exact address verified by staff against recorded evidence',
    };
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
  // Legacy source-only staff_verified rows predate the versioned evidence
  // bundle. They remain quick_check; only the exact valid bundle above is ready.
  if (source === 'staff_verified') reason = 'Verified by staff against an independent source — confirm before sending';
  else if (source === 'manual') reason = 'Manually entered — not verified against the reviewer’s identity';
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
  emailSourceTier,
  emailSourceOutranks,
  emailSourceUpgradeAllowed,
  isHumanAssertedEmailSource,
};
