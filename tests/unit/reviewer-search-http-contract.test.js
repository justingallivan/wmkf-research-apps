/**
 * @jest-environment node
 *
 * P7 consumer-side proof. The fixture is produced by the real route handlers
 * in reviewer-search-save-contract.test.js; this suite never rewrites it.
 */

const contract = require('../fixtures/reviewer-search-http-contract.json');
const {
  correlateSaveResultsToRosterCandidates,
} = require('../../shared/components/reviewers/reviewer-search-logic');
const { reviewerCandidateKey } = require('../../lib/utils/reviewer-candidate-key');
const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');

const ORDINARY_SAVED = {
  name: 'Ordinary Saved',
  email: 'applicant@example.edu',
  candidateKey: 'roster:ordinary',
};
const ORDINARY_BLOCKED = {
  name: 'Ordinary Blocked',
  candidateKey: 'roster:conflict',
  email: 'applicant@example.edu',
};

test('consumer reads the frozen ordinary batch and binds each result to its submitted roster key', () => {
  const results = correlateSaveResultsToRosterCandidates(
    contract.ordinaryMixedSave.results,
    [ORDINARY_SAVED, ORDINARY_BLOCKED],
  );

  expect(results).toEqual([
    {
      ...contract.ordinaryMixedSave.results[0],
      rosterCandidateKey: 'roster:ordinary',
    },
    {
      ...contract.ordinaryMixedSave.results[1],
      rosterCandidateKey: 'roster:conflict',
    },
  ]);
  expect(contract.ordinaryMixedSave.savedKeys).toContain(reviewerSaveKey(ORDINARY_SAVED));
  expect(reviewerCandidateKey(ORDINARY_SAVED)).toBe('roster:ordinary');
});

test('consumer preserves the index guard and only uses index-less legacy fallback when unique', () => {
  const saved = contract.ordinaryMixedSave.results[0];
  const malformedIndex = { ...saved, index: 99 };
  const legacy = { ...saved };
  delete legacy.index;

  expect(correlateSaveResultsToRosterCandidates([malformedIndex], [ORDINARY_SAVED])[0])
    .not.toHaveProperty('rosterCandidateKey');
  expect(correlateSaveResultsToRosterCandidates([legacy], [ORDINARY_SAVED])[0])
    .toHaveProperty('rosterCandidateKey', 'roster:ordinary');
});

test('consumer refuses an ambiguous index-less result when same save key has different roster keys', () => {
  const duplicateA = { ...ORDINARY_SAVED, candidateKey: 'roster:a' };
  const duplicateB = { ...ORDINARY_SAVED, candidateKey: 'roster:b' };
  const legacy = { ...contract.ordinaryMixedSave.results[0] };
  delete legacy.index;

  expect(reviewerSaveKey(duplicateA)).toBe(reviewerSaveKey(duplicateB));
  expect(correlateSaveResultsToRosterCandidates([legacy], [duplicateA, duplicateB])[0])
    .not.toHaveProperty('rosterCandidateKey');
});

test('consumer preserves the unknown-outcome asymmetry and roster recovery envelope', () => {
  expect(contract.rosterRecovery.success).toBe(true);
  expect(contract.rosterRecovery.savedKeys).toEqual([]);
  expect(contract.applicantPartialPromotion.rosterFinalized).toBe(false);
  expect(contract.applicantPartialPromotion.partialSuccess).toBe(true);
  expect(contract.applicantPartialPromotion).not.toHaveProperty('savedKeys');
  expect(contract.applicantPartialPromotion).not.toHaveProperty('recovery');
});

test('fixtures freeze omitted conditional response keys', () => {
  expect(contract.ordinaryMixedSave).not.toHaveProperty('rejectedInvalid');
  expect(contract.ordinaryMixedSave).not.toHaveProperty('rejectedMissingEmail');
  expect(contract.applicantPartialPromotion).not.toHaveProperty('potentialReviewerId');
});
