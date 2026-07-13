const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');

test('explicit clientCandidateId is the preferred correlation key', () => {
  expect(reviewerSaveKey({ name: 'Dr Example', clientCandidateId: 'run-1:candidate-7' }))
    .toBe('client:run-1:candidate-7');
});

test('fallback key distinguishes same-name submissions by submitted anchors', () => {
  const first = reviewerSaveKey({ name: 'Dr Jane Smith', email: 'jane@one.edu', affiliation: 'One University' });
  const second = reviewerSaveKey({ name: 'Jane Smith', email: 'jane@two.edu', affiliation: 'Two University' });
  expect(first).not.toBe(second);
  expect(first).toBe(reviewerSaveKey({
    name: 'DR. JANE SMITH',
    contactEnrichment: { email: 'JANE@ONE.EDU', affiliation: ' One   University ' },
  }));
});

test('missing candidate name has no fallback key', () => {
  expect(reviewerSaveKey({ email: 'unknown@example.org' })).toBeNull();
});
