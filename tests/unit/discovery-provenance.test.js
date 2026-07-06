/**
 * Characterization tests for the DiscoveryService provenance-origin resolvers
 * (provenanceOriginForVerifiedSuggestion, provenanceOriginForUnverifiedSuggestion,
 * evaluateVerificationIncoherence).
 *
 * Written before Stage 3 of the DiscoveryService decomposition
 * (docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md) to pin current behavior before the code moves to
 * lib/services/discovery/provenance.js. Enum values are pulled from the shared util so the
 * assertions track the source of truth. (normalizeSuggestionSource + mapSpineVerificationResult
 * already have coverage in reviewer-suggestion-data-quality + discovery-verification-status.)
 */

const { DiscoveryService } = require('../../lib/services/discovery-service');
const { PROVENANCE_KINDS, SEED_ROLES } = require('../../lib/utils/reviewer-provenance');

describe('DiscoveryService.provenanceOriginForVerifiedSuggestion', () => {
  it('applicant-recommended', () => {
    expect(DiscoveryService.provenanceOriginForVerifiedSuggestion({ source: 'applicant_recommended' })).toEqual({
      kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      sources: ['applicant_form', 'pubmed'],
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
    });
  });
  it('proposal-named', () => {
    expect(DiscoveryService.provenanceOriginForVerifiedSuggestion({ source: 'proposal_named' })).toEqual({
      kind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      sources: ['proposal_text', 'pubmed'],
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
    });
  });
  it('default literature-retrieved', () => {
    expect(DiscoveryService.provenanceOriginForVerifiedSuggestion({ source: 'claude_suggestion' })).toEqual({
      kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED,
      sources: ['pubmed'],
      seedRole: SEED_ROLES.QUERY_SEED,
    });
  });
});

describe('DiscoveryService.provenanceOriginForUnverifiedSuggestion', () => {
  it('applicant-recommended (no pubmed source)', () => {
    expect(DiscoveryService.provenanceOriginForUnverifiedSuggestion({ isApplicantRecommended: true })).toEqual({
      kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED,
      sources: ['applicant_form'],
      seedRole: SEED_ROLES.APPLICANT_SUGGESTED,
    });
  });
  it('proposal-named', () => {
    expect(DiscoveryService.provenanceOriginForUnverifiedSuggestion({ source: 'proposal_named' })).toEqual({
      kind: PROVENANCE_KINDS.PROPOSAL_NAMED,
      sources: ['proposal_text'],
      seedRole: SEED_ROLES.PEER_OR_COMPETITOR,
    });
  });
  it('default barred-parametric (unverified literature guess)', () => {
    expect(DiscoveryService.provenanceOriginForUnverifiedSuggestion({ source: 'claude_suggestion' })).toEqual({
      kind: PROVENANCE_KINDS.BARRED_PARAMETRIC,
      sources: [],
      seedRole: SEED_ROLES.QUERY_SEED,
    });
  });
});

describe('DiscoveryService.evaluateVerificationIncoherence', () => {
  const V = DiscoveryService.VERIFICATION_STATUSES;
  it('flags institution + expertise mismatch for a VERIFIED candidate', () => {
    expect(DiscoveryService.evaluateVerificationIncoherence({
      institutionMismatch: true,
      expertiseMismatchResult: { hasMismatch: true },
      verificationStatus: V.VERIFIED,
    })).toEqual({ hasIncoherence: true, reasons: ['institution_mismatch', 'expertise_mismatch'] });
  });
  it('no incoherence when not VERIFIED, even with mismatches', () => {
    expect(DiscoveryService.evaluateVerificationIncoherence({
      institutionMismatch: true,
      expertiseMismatchResult: { hasMismatch: true },
      verificationStatus: V.PROBABLE,
    })).toEqual({ hasIncoherence: false, reasons: [] });
  });
});
