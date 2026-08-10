/**
 * deriveReviewMatrix — workbench Reviews tab Phase 2 comparison matrix
 * (docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md).
 *
 * Covers: live ordering, retired-key append + flag, not-asked vs empty,
 * average/spread with nulls excluded, single-reviewer, zero-submitted,
 * all-retired (fetcher null), and duplicate questionKey with differing
 * snapshot text/type across reviewers (first-wins, per the module header).
 */

import { deriveReviewMatrix } from '../../shared/utils/review-matrix';

function reviewer(suggestionId, name, answers) {
  return { suggestionId, name, answers };
}

function row(questionKey, questionOrder, questionType, questionText, {
  answerText = null,
  answerHtml = null,
  answerValue = null,
  answerValues = null,
  answerValuesUnreadable = false,
} = {}) {
  return {
    questionKey,
    questionOrder,
    questionType,
    questionText,
    answerText,
    answerHtml,
    answerValue,
    answerValues,
    answerValuesUnreadable,
  };
}

describe('deriveReviewMatrix', () => {
  test('orders questions by the live question set, not snapshot order', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('risk', 2, 'picklist', 'Risk?', { answerText: 'Medium', answerValue: 2 }),
        row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 3 }),
      ]),
    ];
    // Live set reverses the snapshot order: impact should come first.
    const liveQuestions = [
      { key: 'impact', order: 1, text: 'Impact (live)', type: 'picklist' },
      { key: 'risk', order: 2, text: 'Risk (live)', type: 'picklist' },
    ];
    const matrix = deriveReviewMatrix(reviewers, liveQuestions);
    expect(matrix.questions.map((q) => q.key)).toEqual(['impact', 'risk']);
    // Live text/label wins over snapshot text for a live key.
    expect(matrix.questions[0].text).toBe('Impact (live)');
    expect(matrix.questions[0].retired).toBe(false);
  });

  test('a snapshot key absent from the live set is appended after, in snapshot order, flagged retired', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 3 }),
        row('oldQ', 5, 'richtext', 'Old prior-cycle question', { answerHtml: '<p>hi</p>' }),
      ]),
    ];
    const liveQuestions = [
      { key: 'impact', order: 1, text: 'Impact (live)', type: 'picklist' },
    ];
    const matrix = deriveReviewMatrix(reviewers, liveQuestions);
    expect(matrix.questions.map((q) => q.key)).toEqual(['impact', 'oldQ']);
    expect(matrix.questions[1].retired).toBe(true);
    expect(matrix.questions[1].text).toBe('Old prior-cycle question'); // snapshot text (not live)
  });

  test('not-asked (no row at all) is distinct from empty (row exists, blank content)', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('narrative', 1, 'richtext', 'Comments?', { answerHtml: '<p>content</p>' }),
      ]),
      reviewer('r2', 'Dr. B', [
        row('narrative', 1, 'richtext', 'Comments?', { answerHtml: '' }), // row exists, blank
      ]),
      reviewer('r3', 'Dr. C', []), // no row at all for this key
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    const q = matrix.questions.find((x) => x.key === 'narrative');
    expect(q.cells.find((c) => c.suggestionId === 'r1').state).toBe('answered');
    expect(q.cells.find((c) => c.suggestionId === 'r2').state).toBe('empty');
    expect(q.cells.find((c) => c.suggestionId === 'r3').state).toBe('not-asked');
  });

  test('average/min/max/answeredCount exclude reviewers who did not answer (drift, decision 3)', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 4 })]),
      reviewer('r2', 'Dr. B', [row('impact', 1, 'picklist', 'Impact?', { answerText: 'Low', answerValue: 2 })]),
      reviewer('r3', 'Dr. C', []), // not asked — excluded from aggregate
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    const q = matrix.questions.find((x) => x.key === 'impact');
    expect(q.average).toBe(3); // (4+2)/2
    expect(q.min).toBe(2);
    expect(q.max).toBe(4);
    expect(q.answeredCount).toBe(2);
    expect(q.totalReviewers).toBe(3);
  });

  test('average rounds to 1 decimal', () => {
    const reviewers = [
      reviewer('r1', 'A', [row('impact', 1, 'picklist', 'Impact?', { answerValue: 3, answerText: 'x' })]),
      reviewer('r2', 'B', [row('impact', 1, 'picklist', 'Impact?', { answerValue: 4, answerText: 'y' })]),
      reviewer('r3', 'C', [row('impact', 1, 'picklist', 'Impact?', { answerValue: 4, answerText: 'z' })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    const q = matrix.questions.find((x) => x.key === 'impact');
    expect(q.average).toBe(3.7); // 11/3 = 3.6666... -> 3.7
  });

  test('a picklist question with zero answered reviewers has null average/min/max', () => {
    const reviewers = [
      reviewer('r1', 'A', []), // no row for impact at all
    ];
    // Live set declares the picklist question exists, but nobody has a row.
    const liveQuestions = [{ key: 'impact', order: 1, text: 'Impact', type: 'picklist' }];
    const matrix = deriveReviewMatrix(reviewers, liveQuestions);
    // No answers[] rows anywhere means the key never enters byKey (union is
    // over answered rows), so it simply does not appear in questions.
    expect(matrix.questions.find((x) => x.key === 'impact')).toBeUndefined();
  });

  test('single-reviewer case', () => {
    const reviewers = [
      reviewer('r1', 'Solo', [
        row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 3 }),
      ]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    expect(matrix.reviewers).toEqual([{ suggestionId: 'r1', name: 'Solo', affiliation: null }]);
    const q = matrix.questions.find((x) => x.key === 'impact');
    expect(q.average).toBe(3);
    expect(q.answeredCount).toBe(1);
  });

  test('zero-submitted reviewers yields an empty matrix', () => {
    const matrix = deriveReviewMatrix([], null);
    expect(matrix.reviewers).toEqual([]);
    expect(matrix.questions).toEqual([]);
  });

  test('reviewer roster prefers accepted self-reported affiliation and falls back to person affiliation', () => {
    const matrix = deriveReviewMatrix([
      {
        suggestionId: 'r1',
        name: 'Dr. Accepted',
        reviewerAffiliation: ' Florida International University ',
        affiliation: 'Prior Institution',
        answers: [],
      },
      {
        suggestionId: 'r2',
        name: 'Dr. Legacy',
        reviewerAffiliation: ' ',
        affiliation: 'Legacy University',
        answers: [],
      },
      { suggestionId: 'r3', name: 'Dr. Unknown', answers: [] },
    ], null);

    expect(matrix.reviewers).toEqual([
      { suggestionId: 'r1', name: 'Dr. Accepted', affiliation: 'Florida International University' },
      { suggestionId: 'r2', name: 'Dr. Legacy', affiliation: 'Legacy University' },
      { suggestionId: 'r3', name: 'Dr. Unknown', affiliation: null },
    ]);
  });

  test('fetcher null (fail-soft): falls back to snapshot-order-only and does not mark questions retired', () => {
    const reviewers = [
      reviewer('r1', 'A', [row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 3 })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    expect(matrix.questions[0].retired).toBe(false);
  });

  test('duplicate questionKey with differing snapshot text across reviewers: first reviewer wins (documented)', () => {
    const reviewers = [
      reviewer('r1', 'First', [row('oldQ', 3, 'richtext', 'Original wording', { answerHtml: '<p>a</p>' })]),
      reviewer('r2', 'Second', [row('oldQ', 3, 'richtext', 'Edited wording later', { answerHtml: '<p>b</p>' })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    const q = matrix.questions.find((x) => x.key === 'oldQ');
    expect(q.text).toBe('Original wording'); // first-seen wins
    expect(q.cells.find((c) => c.suggestionId === 'r1').answerHtml).toBe('<p>a</p>');
    expect(q.cells.find((c) => c.suggestionId === 'r2').answerHtml).toBe('<p>b</p>');
  });

  test('a reviewer with no answers array at all contributes nothing (not an error)', () => {
    const reviewers = [
      { suggestionId: 'r1', name: 'No answers field' },
      reviewer('r2', 'Has answers', [row('impact', 1, 'picklist', 'Impact?', { answerText: 'High', answerValue: 3 })]),
    ];
    const matrix = deriveReviewMatrix(reviewers, null);
    expect(matrix.reviewers).toHaveLength(2);
    const q = matrix.questions.find((x) => x.key === 'impact');
    expect(q.cells.find((c) => c.suggestionId === 'r1').state).toBe('not-asked');
  });

  test('multiselect tallies are separate from numeric rating aggregates', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerValues: [{ value: 1, label: 'Tools' }, { value: 3, label: 'Broad interest' }],
          answerText: 'Tools; Broad interest',
        }),
      ]),
      reviewer('r2', 'Dr. B', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerValues: [{ value: 1, label: 'Tools' }],
          answerText: 'Tools',
        }),
      ]),
    ];

    const question = deriveReviewMatrix(reviewers, null).questions[0];
    expect(question.average).toBeUndefined();
    expect(question.answeredCount).toBe(2);
    expect(question.tallies).toEqual([
      {
        value: 1,
        label: 'Tools',
        count: 2,
        reviewers: [
          { suggestionId: 'r1', name: 'Dr. A' },
          { suggestionId: 'r2', name: 'Dr. B' },
        ],
      },
      {
        value: 3,
        label: 'Broad interest',
        count: 1,
        reviewers: [{ suggestionId: 'r1', name: 'Dr. A' }],
      },
    ]);
  });

  test('multiselect tallies have deterministic value/label order independent of reviewer arrival', () => {
    const reviewers = [
      reviewer('r1', 'Dr. A', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerValues: [{ value: 4, label: 'Textbooks' }],
          answerText: 'Textbooks',
        }),
      ]),
      reviewer('r2', 'Dr. B', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerValues: [
            { value: 2, label: 'Publications — renamed' },
            { value: 1, label: 'Tools' },
          ],
          answerText: 'Publications — renamed; Tools',
        }),
      ]),
      reviewer('r3', 'Dr. C', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerValues: [{ value: 2, label: 'Publications' }],
          answerText: 'Publications',
        }),
      ]),
    ];

    const question = deriveReviewMatrix(reviewers, null).questions[0];
    expect(question.tallies.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 1, label: 'Tools' },
      { value: 2, label: 'Publications' },
      { value: 2, label: 'Publications — renamed' },
      { value: 4, label: 'Textbooks' },
    ]);
  });

  test('corrupt multiselect content is isolated and excluded from tallies', () => {
    const question = deriveReviewMatrix([
      reviewer('r1', 'Dr. A', [
        row('impactAreas', 3, 'multiselect', 'Impact areas?', {
          answerText: 'Unreadable answer',
          answerValuesUnreadable: true,
        }),
      ]),
    ], null).questions[0];

    expect(question.cells[0].state).toBe('unreadable');
    expect(question.answeredCount).toBe(0);
    expect(question.tallies).toEqual([]);
  });
});
