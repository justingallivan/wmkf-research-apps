import {
  buildSeedOrder,
  calculateComposite,
  calculateCumulativeTotals,
  canonicalGuid,
  moneyToMinorUnits,
  readSavedOverallAssessment,
  summarizeProposalReviews,
  validateCompleteOrder,
} from '../../lib/services/proposal-ranking/calculations';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

const savedScale = [
  { label: 'Excellent', value: 5 },
  { label: 'Very Good', value: 4 },
  { label: 'Good', value: 3 },
  { label: 'Fair', value: 2 },
  { label: 'Poor', value: 1 },
];

describe('Proposal Ranking calculations', () => {
  test('normalizes GUID-shaped Dataverse IDs without requiring RFC version/variant bits', () => {
    expect(canonicalGuid(' {EE11EEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE} ')).toBe('ee11eeee-eeee-eeee-eeee-eeeeeeeeeeee');
    expect(canonicalGuid('F1111111-1111-1111-1111-111111111111')).toBe('f1111111-1111-1111-1111-111111111111');
    expect(canonicalGuid('not-a-guid')).toBeNull();
  });

  test('accepts only the recognized saved scale and exact legacy label/value pairs', () => {
    expect(readSavedOverallAssessment({ overallAssessment: 5, questionOptions: savedScale }))
      .toEqual({ rating: 5, scaleReady: true });
    expect(readSavedOverallAssessment({ overallAssessment: 4, overallAssessmentLabel: 'Very Good' }))
      .toEqual({ rating: 4, scaleReady: true });
    expect(readSavedOverallAssessment({ overallAssessment: 4, overallAssessmentLabel: 'Good' }))
      .toEqual({ rating: null, scaleReady: false });
    expect(readSavedOverallAssessment({ answerValue: 5, answerText: 'Excellent', questionOptions: null, questionOptionsUnreadable: true }))
      .toEqual({ rating: null, scaleReady: false });
    expect(readSavedOverallAssessment({ overallAssessment: 4, questionOptions: [{ label: 'Low', value: 4 }] }))
      .toEqual({ rating: null, scaleReady: false });
  });

  test('summarizes received human reviews, retaining counts and distribution', () => {
    const result = summarizeProposalReviews([
      { received: true, synthetic: false, answer: { overallAssessment: 5, questionOptions: savedScale } },
      { received: true, synthetic: false, answer: { overallAssessment: 3, questionOptions: savedScale } },
      { received: true, synthetic: true, answer: { overallAssessment: 1, questionOptions: savedScale } },
      { received: false, synthetic: false, answer: { overallAssessment: 1, questionOptions: savedScale } },
      { received: true, synthetic: false, answer: { overallAssessment: null } },
    ]);
    expect(result).toMatchObject({ ready: true, mean: 4, displayMean: 4, ratedCount: 2, receivedCount: 3 });
    expect(result.distribution).toMatchObject({ Excellent: 1, Good: 1, Poor: 0 });
    expect(summarizeProposalReviews([
      { received: true, synthetic: false, answer: { overallAssessment: 2, questionOptions: [{ label: 'Bad', value: 2 }] } },
    ])).toMatchObject({ ready: false, reason: 'unknown-rating-scale' });
    expect(summarizeProposalReviews([
      { received: true, answer: { overallAssessment: 5, questionOptions: savedScale } },
    ])).toMatchObject({ ready: false, reason: 'unknown-synthetic-reviewer-marker' });
  });

  test('keeps reviewer means and seed ordering consistent from two through five reviews', () => {
    const ratingSets = [[3, 5], [3, 4, 5], [3, 3, 5, 5], [3, 4, 4, 5, 4]];
    const proposals = ratingSets.map((ratings, index) => ({
      requestId: `review-${index + 1}`,
      requestNumber: `R-${ratingSets.length - index}`,
      score: summarizeProposalReviews(ratings.map((rating) => ({
        received: true, synthetic: false,
        answer: { overallAssessment: rating, questionOptions: savedScale },
      }))),
    }));
    expect(proposals.map(({ score }) => score.ratedCount)).toEqual([2, 3, 4, 5]);
    expect(proposals.map(({ score }) => score.mean)).toEqual([4, 4, 4, 4]);
    expect(buildSeedOrder(proposals)).toEqual(proposals.slice().reverse().map(({ requestId }) => requestId));
  });

  test('sorts unrounded means and then numeric-aware request numbers deterministically', () => {
    const proposals = [
      { requestId: ids[0], requestNumber: 'R-10', score: { mean: 4.25 } },
      { requestId: ids[1], requestNumber: 'R-2', score: { mean: 4.2 } },
      { requestId: ids[2], requestNumber: 'R-1', score: { mean: null } },
    ];
    expect(buildSeedOrder(proposals)).toEqual([ids[0], ids[1], ids[2]]);
    expect(buildSeedOrder([{ ...proposals[0], score: { mean: null } }, { ...proposals[1], score: { mean: null } }]))
      .toEqual([ids[1], ids[0]]);
  });

  test('keeps missing money null and marks totals incomplete from that row onward', () => {
    expect(moneyToMinorUnits('125.50')).toBe(12550);
    expect(moneyToMinorUnits('1.001')).toBeNull();
    const totals = calculateCumulativeTotals(ids, new Map([
      [ids[0], { amountMinorUnits: 10000, currencyCode: 'USD' }],
      [ids[1], { amountMinorUnits: null, currencyCode: 'USD' }],
      [ids[2], { amountMinorUnits: 2500, currencyCode: 'USD' }],
    ]));
    expect(totals).toEqual([
      { requestId: ids[0], cumulativeMinorUnits: 10000, complete: true, currencyCode: 'USD' },
      { requestId: ids[1], cumulativeMinorUnits: null, complete: false, currencyCode: 'USD' },
      { requestId: ids[2], cumulativeMinorUnits: null, complete: false, currencyCode: 'USD' },
    ]);
    expect(() => calculateCumulativeTotals(ids.slice(0, 2), new Map([
      [ids[0], { amountMinorUnits: 10000, currencyCode: 'USD' }],
      [ids[1], { amountMinorUnits: 100, currencyCode: 'CAD' }],
    ]))).toThrow(/more than one currency/);
  });

  test('validates a complete permutation and calculates exact rank sums and spread', () => {
    expect(validateCompleteOrder(ids, ids)).toBe(true);
    expect(validateCompleteOrder([ids[0], ids[0], ids[2]], ids)).toBe(false);
    expect(validateCompleteOrder([ids[0], ids[2]], ids)).toBe(false);
    const result = calculateComposite([
      { order: [ids[0], ids[1], ids[2]] },
      { order: [ids[1], ids[2], ids[0]] },
    ], ids);
    expect(result.scores[ids[0]]).toEqual({ rankSum: 4, averageRank: 2 });
    expect(result.scores[ids[1]]).toEqual({ rankSum: 3, averageRank: 1.5 });
    expect(result.order).toEqual([ids[1], ids[0], ids[2]]);
    expect(result.ranges[ids[0]]).toMatchObject({ min: 1, max: 3, disagreement: true });
    expect(calculateComposite([{ order: ids }], ids).ranges[ids[0]].disagreement).toBe(false);
  });
});

describe('combined meeting interleaving', () => {
  const combine = (...sources) => require('../../lib/services/proposal-ranking/calculations.js').combineMeetingOrders(sources.map(([order, averages]) => ({ order, scores: Object.fromEntries(order.map((id, i) => [id, { averageRank: averages[i] }])) })));
  test('compares the next proposal from each program with SE first on equal scores', () => {
    expect(combine([['s1', 's2', 's3'], [1, 2.5, 3]], [['m1', 'm2'], [1, 2]])).toEqual(['s1', 'm1', 'm2', 's2', 's3']);
  });
  test('preserves meeting decisions even when averages no longer increase within a program', () => {
    expect(combine([['s2', 's1'], [2, 1]], [['m1', 'm2'], [1, 3]])).toEqual(['m1', 's2', 's1', 'm2']);
    expect(combine([[], []], [['m1'], [1]])).toEqual(['m1']);
  });
  test('rejects duplicate proposals and missing scores', () => {
    expect(() => combine([['a'], [1]], [['a'], [1]])).toThrow('unique');
    expect(() => combine([['a'], [NaN]])).toThrow('valid');
  });
});
