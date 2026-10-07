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
