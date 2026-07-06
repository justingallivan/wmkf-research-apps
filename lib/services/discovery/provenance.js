/**
 * DiscoveryService provenance & suggestion-normalization cluster — Stage 3 of the
 * DiscoveryService decomposition (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md).
 *
 * The single ingestion chokepoint that cleans a reviewer suggestion (honorific strip,
 * website sanitize, canonical source label), the provenance-origin resolvers for the
 * verified / unverified / spine paths, the OpenAlex-ORCID spine result mapper, and the
 * verification-incoherence check. Extracted VERBATIM from discovery-service.js as a
 * behavior-freeze — internal `this.X` self-calls became direct function calls; constants
 * (`VERIFICATION_STATUSES`, `VERIFICATION_SKIPPED_REASON`) come from ./constants and the
 * provenance/contact utilities from the shared libs. The DiscoveryService facade delegates each.
 *
 * Depends on ./constants, ../../utils/reviewer-provenance, ../../utils/contact-parser.
 * Characterization net: tests/unit/reviewer-suggestion-data-quality.test.js +
 * tests/unit/discovery-verification-status.test.js.
 */

const { VERIFICATION_STATUSES, VERIFICATION_SKIPPED_REASON } = require('./constants');
const { PROVENANCE_KINDS, SEED_ROLES, withReviewerProvenance } = require('../../utils/reviewer-provenance');
const { ContactParser } = require('../../utils/contact-parser');

function normalizeSuggestionSource(suggestion = {}) {
  const rawSource = String(suggestion.source || '').trim();
  // Data-quality cleaning at the single ingestion chokepoint, so BOTH the verify
  // path and the display/roster path see cleaned values (S266):
  //  - strip an unverified honorific from the display name ("Prof. X Y" → "X Y");
  //    we never verify titles, so asserting one is a fabricated-credential risk.
  //    Safe for dedup — normalizeReviewerName already strips honorifics.
  //  - null a suggestion `website` that isn't a useful profile page (e.g. a
  //    co-author's paper PDF). The suggestion website key is unverifiable from
  //    source (the prompt lives in Dataverse), so this is the defensive catch.
  const cleaned = {};
  if (typeof suggestion.name === 'string' && suggestion.name.trim()) {
    // Only override when the strip leaves a real name — a degenerate all-honorific
    // value ("Dr.") strips to '', and blanking the name would lose the row.
    const stripped = ContactParser.stripHonorifics(suggestion.name);
    if (stripped) cleaned.name = stripped;
  }
  if (typeof suggestion.website === 'string' && suggestion.website.trim()) {
    cleaned.website = ContactParser.sanitizeWebsiteForCandidate(
      suggestion.website,
      cleaned.name || suggestion.name
    );
  }
  if (suggestion.isApplicantRecommended || suggestion.applicantRecommended) {
    return {
      ...suggestion,
      ...cleaned,
      source: 'applicant_recommended',
      provenanceKind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
    };
  }
  if (/^mentioned in proposal$/i.test(rawSource)) {
    return {
      ...suggestion,
      ...cleaned,
      source: 'proposal_named',
      provenanceKind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
    };
  }
  // SOURCE: References is intentionally NOT cited_reference; that requires a
  // resolved DOI/PMID/arXiv work anchor, not a parser label.
  return {
    ...suggestion,
    ...cleaned,
    source: 'claude_suggestion',
  };
}

function provenanceOriginForVerifiedSuggestion(suggestion = {}) {
  if (suggestion.isApplicantRecommended || suggestion.applicantRecommended || suggestion.source === 'applicant_recommended') {
    return {
      kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      sources: ['applicant_form', 'pubmed'],
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
    };
  }
  if (suggestion.source === 'proposal_named') {
    return {
      kind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      sources: ['proposal_text', 'pubmed'],
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
    };
  }
  return {
    kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
    sources: ['pubmed'],
    seedRole: SEED_ROLES.QUERY_SEED,
  };
}

function provenanceOriginForUnverifiedSuggestion(suggestion = {}) {
  if (suggestion.isApplicantRecommended || suggestion.applicantRecommended || suggestion.source === 'applicant_recommended') {
    return {
      kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      sources: ['applicant_form'],
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
    };
  }
  if (suggestion.source === 'proposal_named') {
    return {
      kind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      sources: ['proposal_text'],
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
    };
  }
  return {
    kind: PROVENANCE_KINDS.BARRED_PARAMETRIC,
    sources: [],
    seedRole: SEED_ROLES.QUERY_SEED,
  };
}

function provenanceOriginForSpineSuggestion(suggestion = {}, evidenceSources = [], verified = false) {
  const scholarlySources = Array.from(new Set(evidenceSources.filter(Boolean)));
  if (suggestion.isApplicantRecommended || suggestion.applicantRecommended || suggestion.source === 'applicant_recommended') {
    return {
      kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      sources: ['applicant_form', ...scholarlySources],
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
      force: true,
    };
  }
  if (suggestion.source === 'proposal_named') {
    return {
      kind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      sources: ['proposal_text', ...scholarlySources],
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
      force: true,
    };
  }
  return {
    kind: verified ? PROVENANCE_KINDS.LITERATURE_RETRIEVED : PROVENANCE_KINDS.BARRED_PARAMETRIC,
    sources: verified ? scholarlySources : scholarlySources,
    seedRole: SEED_ROLES.QUERY_SEED,
    force: true,
  };
}

function mapSpineVerificationResult(suggestion, spineResult = {}) {
  const status = spineResult.resolverStatus || spineResult.status || VERIFICATION_STATUSES.UNRESOLVED;
  const sourceNames = [];
  if (spineResult.sources?.openalex === 'ok' || spineResult.selectedRecord) sourceNames.push('openalex');
  if (spineResult.sources?.orcid === 'ok' || spineResult.orcid) sourceNames.push('orcid');

  if (status === 'confirmed' || status === 'probable') {
    const verificationStatus = status === 'confirmed'
      ? VERIFICATION_STATUSES.VERIFIED
      : VERIFICATION_STATUSES.PROBABLE;
    const orcidId = spineResult.orcid || null;
    const candidate = withReviewerProvenance({
      ...suggestion,
      verified: true,
      verificationStatus,
      identityStatus: status,
      verificationSource: 'orcid',
      verificationConfidence: status === 'confirmed' ? 0.95 : 0.75,
      verificationReason: spineResult.reason || `OpenAlex/ORCID identity spine classified ${status}`,
      orcid: orcidId,
      orcidId,
      orcidUrl: orcidId ? `https://orcid.org/${orcidId}` : null,
      openAlexId: spineResult.selectedRecord?.openAlexId || null,
      affiliation: spineResult.selectedRecord?.lastKnownInstitution || suggestion.affiliation,
      // Carry ORCID employment history so the former-institution COI scan
      // (deduplication-service) works for spine-verified candidates, the same
      // way the PubMed path supplies affiliationHistory (Codex S236 post-impl
      // CHECK 4 — without this, non-biomedical reviewers skip former-institution COI).
      affiliationHistory: Array.isArray(spineResult.orcidAffiliations) && spineResult.orcidAffiliations.length
        ? spineResult.orcidAffiliations
        : (spineResult.selectedRecord?.lastKnownInstitution ? [spineResult.selectedRecord.lastKnownInstitution] : []),
      identityEvidence: spineResult.identity || null,
      identityAnchors: spineResult.anchors || [],
      identityNote: spineResult.identityNote || null,
      source: suggestion.source,
    }, provenanceOriginForSpineSuggestion(suggestion, sourceNames, true));
    return { verified: true, candidate };
  }

  const reason = spineResult.reason || VERIFICATION_SKIPPED_REASON;
  const candidate = withReviewerProvenance({
    ...suggestion,
    verified: false,
    verificationStatus: VERIFICATION_STATUSES.UNRESOLVED,
    identityStatus: status === 'ambiguous' ? VERIFICATION_STATUSES.AMBIGUOUS : VERIFICATION_STATUSES.UNRESOLVED,
    verificationSource: sourceNames.length ? 'orcid' : null,
    verificationReason: reason,
    reason,
    needsIdentification: true,
    openAlexId: spineResult.selectedRecord?.openAlexId || null,
    identityEvidence: spineResult.identity || null,
    identityAnchors: spineResult.anchors || [],
    identityNote: spineResult.identityNote || null,
    source: suggestion.source,
  }, provenanceOriginForSpineSuggestion(suggestion, status === 'ambiguous' ? ['openalex'] : [], false));
  return { verified: false, candidate };
}

function unverifiedSuggestion(suggestion, reason) {
  return withReviewerProvenance({
    ...suggestion,
    verified: false,
    verificationStatus: VERIFICATION_STATUSES.UNRESOLVED,
    identityStatus: VERIFICATION_STATUSES.UNRESOLVED,
    reason,
    verificationReason: reason,
    needsIdentification: true,
  }, provenanceOriginForUnverifiedSuggestion(suggestion));
}

function evaluateVerificationIncoherence({ institutionMismatch, expertiseMismatchResult, verificationStatus }) {
  const reasons = [];
  if (verificationStatus === VERIFICATION_STATUSES.VERIFIED && institutionMismatch) {
    reasons.push('institution_mismatch');
  }
  if (verificationStatus === VERIFICATION_STATUSES.VERIFIED && expertiseMismatchResult?.hasMismatch) {
    reasons.push('expertise_mismatch');
  }
  return { hasIncoherence: reasons.length > 0, reasons };
}

module.exports = {
  normalizeSuggestionSource,
  provenanceOriginForVerifiedSuggestion,
  provenanceOriginForUnverifiedSuggestion,
  provenanceOriginForSpineSuggestion,
  mapSpineVerificationResult,
  unverifiedSuggestion,
  evaluateVerificationIncoherence,
};
