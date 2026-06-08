/**
 * @jest-environment node
 */

const {
  buildReviewerProvenance,
  saveSourceListForCandidate,
  provenanceGroupOf,
} = require('../../lib/utils/reviewer-provenance');

describe('reviewer provenance DTO helper', () => {
  test('maps literature candidates to ordered scholarly sources plus provenance kind for save', () => {
    const candidate = {
      name: 'Ada Reviewer',
      source: 'claude_suggestion',
      verificationSource: 'pubmed',
      publications: [{ pmid: '123', doi: '10.1/example' }],
    };

    expect(buildReviewerProvenance(candidate)).toEqual({
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: ['doi:10.1/example', 'pmid:123'],
    });
    expect(saveSourceListForCandidate(candidate)).toEqual(['pubmed', 'literature_retrieved']);
  });

  test('does not infer provenance from legacy Claude flags alone', () => {
    const candidate = { name: 'Parametric Only', isClaudeSuggestion: true, source: 'claude_suggestion' };
    expect(buildReviewerProvenance(candidate).kind).toBe('barred_parametric');
    expect(saveSourceListForCandidate(candidate)).toEqual(['barred_parametric']);
    expect(provenanceGroupOf(candidate)).toBe('needs_identity_review');
  });

  test('maps applicant recommended rows from their actual origin', () => {
    const candidate = { name: 'Applicant Pick', isApplicantRecommended: true };
    expect(buildReviewerProvenance(candidate)).toMatchObject({
      kind: 'applicant_suggested',
      sources: ['applicant_form'],
      seedRole: 'applicant_suggested',
    });
    expect(provenanceGroupOf(candidate)).toBe('applicant_suggested');
  });

  // Slice E (S235) — the BARRED/unknown-kind fallback must not gate a row whose IDENTITY
  // is positively resolved. A BARRED Track-A row upgraded by a shared-ORCID Track-B match
  // keeps the barred kind but gains confirmed identity; it is a legitimate, selectable
  // reviewer, and the server (save-candidates) must NOT 422 it. The genuinely-unresolved
  // BARRED row (no positive identity, covered above at "does not infer…") stays gated.
  test('a positively-resolved BARRED row is selectable, not needs_identity_review', () => {
    const confirmedBarred = {
      name: 'Upgraded By Orcid',
      isClaudeSuggestion: true,
      source: 'claude_suggestion', // → barred_parametric kind (no scholarly source)
      identityStatus: 'confirmed',
      verified: true,
      verificationStatus: 'verified',
      orcid: '0000-0002-1825-0097',
    };
    expect(buildReviewerProvenance(confirmedBarred).kind).toBe('barred_parametric');
    expect(provenanceGroupOf(confirmedBarred)).not.toBe('needs_identity_review');
    expect(provenanceGroupOf(confirmedBarred)).toBe('literature_retrieved');
  });

  test('a probable-identity row is also selectable despite a barred kind', () => {
    const probableBarred = {
      name: 'Probable Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      verificationStatus: 'probable',
    };
    expect(provenanceGroupOf(probableBarred)).toBe('literature_retrieved');
  });

  test('an unresolved row still routes to needs_identity_review (gate intact)', () => {
    const unresolved = {
      name: 'Deferred Person', isClaudeSuggestion: true, source: 'claude_suggestion',
      needsIdentification: true, identityStatus: 'unresolved', verificationStatus: 'unresolved',
    };
    expect(provenanceGroupOf(unresolved)).toBe('needs_identity_review');
  });
});
