import {
  defaultBoundaries,
  validateAssessment,
  mergeProgramAssessments,
  calculateRevealedAssessment,
  calculateSectionTotals,
} from '../../lib/services/proposal-ranking/assessments';

const proposal = (requestId, programKey, mean, requestNumber = requestId) => ({
  requestId,
  programKey,
  requestNumber,
  score: { mean },
});
const assessment = (
  order,
  boundaries = [order.length, order.length],
  confidence = 'confident',
) => ({
  order,
  boundaries,
  confidence: Object.fromEntries(order.map((id) => [id, confidence])),
});

test.each([
  [0, [0, 0]],
  [1, [1, 1]],
  [2, [1, 2]],
  [3, [1, 2]],
  [4, [2, 3]],
  [5, [2, 4]],
])('thirds for %i proposals', (count, expected) => {
  expect(defaultBoundaries(count)).toEqual(expected);
});

test('rejects invalid membership, bars and confidence including unknown keys', () => {
  const valid = assessment(['a', 'b']);
  expect(validateAssessment(valid, ['a', 'b'], { complete: true })).toBe(true);
  for (const patch of [
    { order: ['a', 'a'] },
    { boundaries: [2, 1] },
    { boundaries: [0, 3] },
    { boundaries: [0, 1.5] },
    { confidence: { a: 'confident', b: 'maybe' } },
    { confidence: { a: 'confident', b: 'confident', c: 'confident' } },
  ]) {
    expect(validateAssessment({ ...valid, ...patch }, ['a', 'b'])).toBe(false);
  }
  expect(validateAssessment({ ...valid, confidence: {} }, ['a', 'b'])).toBe(
    true,
  );
  expect(
    validateAssessment({ ...valid, confidence: {} }, ['a', 'b'], {
      complete: true,
    }),
  ).toBe(false);
});

test('pair winners alternate without allowing later high scores to leap over earlier pairs', () => {
  const proposals = [
    proposal('m1', 'mr', 2),
    proposal('m2', 'mr', 5),
    proposal('m3', 'mr', 5),
    proposal('s1', 'se', 3),
    proposal('s2', 'se', 4),
  ];
  const merged = mergeProgramAssessments(
    { mr: assessment(['m1', 'm2', 'm3']), se: assessment(['s1', 's2']) },
    proposals,
  );
  expect(merged.order).toEqual(['s1', 'm1', 'm2', 's2', 'm3']);
  expect(merged.boundaries).toEqual([5, 5]);
});

test('merges each grade separately; handles missing scores, numeric fallback and an empty program', () => {
  const proposals = [
    proposal('m1', 'mr', null, '10'),
    proposal('m2', 'mr', 5),
    proposal('s1', 'se', null, '2'),
  ];
  const merged = mergeProgramAssessments(
    {
      mr: assessment(['m1', 'm2'], [1, 1]),
      se: assessment(['s1'], [1, 1], 'not-sure'),
    },
    proposals,
  );
  expect(merged.order).toEqual(['s1', 'm1', 'm2']);
  expect(merged.boundaries).toEqual([2, 2]);
  expect(merged.confidence.s1).toBe('not-sure');
  expect(
    mergeProgramAssessments(
      { mr: assessment(['m1', 'm2'], [1, 1]), se: assessment([]) },
      proposals.slice(0, 2),
    ).order,
  ).toEqual(['m1', 'm2']);
  expect(() =>
    mergeProgramAssessments(
      {
        mr: assessment(['m1', 'm2']),
        se: { ...assessment(['s1']), confidence: {} },
      },
      proposals,
    ),
  ).toThrow(/complete/);
});

test('aggregation is equally weighted and uses reviewer score only to resolve equal rank sums', () => {
  const proposals = [proposal('a', 'mr', 3), proposal('b', 'se', 4)];
  const inputs = [
    assessment(['a', 'b'], [2, 2]),
    assessment(['b', 'a'], [0, 0], 'not-sure'),
  ];
  const result = calculateRevealedAssessment(inputs, proposals);
  expect(result.order).toEqual(['b', 'a']);
  expect(result.scores.a).toEqual({ rankSum: 3, averageRank: 1.5 });
  expect(result.boundaries).toEqual([0, 2]);
  expect(
    calculateRevealedAssessment(
      inputs.map((item) => ({
        ...item,
        confidence: { a: 'confident', b: 'confident' },
      })),
      proposals,
    ).order,
  ).toEqual(result.order);
});

test.each([
  [
    [3, 3],
    [3, 3],
  ],
  [
    [0, 0],
    [0, 0],
  ],
  [
    [1, 2],
    [1, 2],
  ],
  [
    [0, 3],
    [0, 3],
  ],
])('unanimous outer bars %j', (bars, expected) => {
  const proposals = ['a', 'b', 'c'].map((id) => proposal(id, 'mr', 3));
  expect(
    calculateRevealedAssessment([assessment(['a', 'b', 'c'], bars)], proposals)
      .boundaries,
  ).toEqual(expected);
});

test('section totals count awards rather than dollars and preserve missing amounts', () => {
  const proposals = [
    {
      ...proposal('a', 'mr', 3),
      amountMinorUnits: 100,
      currency: { code: 'USD' },
      institutionGeography: 'West',
    },
    {
      ...proposal('b', 'se', 3),
      amountMinorUnits: 10000,
      currency: { code: 'USD' },
      institutionGeography: 'East',
    },
    {
      ...proposal('c', 'se', 3),
      amountMinorUnits: null,
      currency: { code: 'USD' },
    },
  ];
  expect(calculateSectionTotals(['a', 'b', 'c'], [2, 3], proposals)).toEqual([
    {
      count: 2,
      amountMinorUnits: 10100,
      complete: true,
      currencyCode: 'USD',
      geography: { West: 1, East: 1, Unknown: 0 },
    },
    {
      count: 1,
      amountMinorUnits: null,
      complete: false,
      currencyCode: 'USD',
      geography: { West: 0, East: 0, Unknown: 1 },
    },
    {
      count: 0,
      amountMinorUnits: 0,
      complete: true,
      currencyCode: null,
      geography: { West: 0, East: 0, Unknown: 0 },
    },
  ]);
});
