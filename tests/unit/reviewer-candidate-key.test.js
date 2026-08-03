/** @jest-environment node */

const {
  canonicalStoredReviewerCandidateKey,
  reviewerCandidateKey,
} = require('../../lib/utils/reviewer-candidate-key');

test('accepts authoritative anchors and the exact historical stored-row composite', () => {
  const storedKey = reviewerCandidateKey({
    name: 'Katherine Ferrara',
    email: 'kwferrar@stanford.edu',
    affiliation: 'Stanford University',
  });

  expect(storedKey).toBe(
    'candidate:katherine%20ferrara|email:kwferrar%40stanford.edu|orcid:-|affiliation:stanford%20university',
  );
  expect(canonicalStoredReviewerCandidateKey(storedKey)).toBe(storedKey);
  expect(canonicalStoredReviewerCandidateKey('person:22222222-2222-2222-2222-222222222222'))
    .toBe('person:22222222-2222-2222-2222-222222222222');
});

test('rejects arbitrary browser keys and malformed historical composites', () => {
  for (const key of [
    'client:browser-row',
    'candidate:legacy-row',
    'candidate:name|email:value|orcid:value',
    'candidate:name|email:value|orcid:value|affiliation:',
    'candidate:name|email:value|orcid:value|affiliation:value\nother',
    `candidate:${'a'.repeat(561)}|email:x|orcid:-|affiliation:y`,
  ]) {
    expect(canonicalStoredReviewerCandidateKey(key)).toBeNull();
  }
});
