/** Request-scoped J27 pilot. A lookup can produce a lead; only staff can record ownership. */
const { PROVENANCE_KINDS } = require('../../utils/reviewer-provenance');
const { SEARCH_EMAIL_SOURCES } = require('./constants');
const { addContactLead } = require('./email-adjudication');

// For the existing exact-person CRM contradiction check only. WeakMap entries
// cannot be supplied by the browser, serialized to a card, or saved as a primary.
const reconciliationEvidence = new WeakMap();

function heldEvidenceForReconciliation(candidate) {
  return reconciliationEvidence.get(candidate);
}

function isOrdinaryFindCandidate(candidate) {
  return !candidate.isApplicantRecommended && !candidate.suggestionId
    && (candidate.isClaudeSuggestion === true || candidate.provenance?.kind === PROVENANCE_KINDS.LITERATURE_RETRIEVED);
}

function holdFindContact(candidate, result) {
  const ce = result.contactEnrichment;
  if (!isOrdinaryFindCandidate(candidate) || !ce.email) return;
  const source = ce.emailSource;
  if (!SEARCH_EMAIL_SOURCES.has(source) && source !== 'search_contested' && source !== 'institution_page') return;
  const disposition = source === 'search_contested' ? 'contested_hold'
    : candidate.institutionMismatch && candidate.expertiseMismatch ? 'identity_conflict' : 'staff_review';
  const sourceUrl = ce.emailEvidence?.sourceUrl || null;
  ce.tierResults.find_mailbox = { reason: 'search_ownership', disposition, pages: sourceUrl ? [sourceUrl] : [] };
  if (disposition === 'staff_review') {
    addContactLead(ce, { value: ce.email, source, sourceUrl, confidence: 'medium', rejectedReason: 'ownership_unconfirmed' });
  }
  reconciliationEvidence.set(result, { email: ce.email, source, persistAllowed: ce.emailPersistAllowed === true });
  ce.email = null;
  ce.emailSource = null;
  ce.emailEvidence = null;
  ce.emailYear = null;
  ce.emailIsRecent = false;
  ce.emailPersistAllowed = false;
  result.email = null;
}

module.exports = { isOrdinaryFindCandidate, holdFindContact, heldEvidenceForReconciliation };
