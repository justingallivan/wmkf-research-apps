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
});
