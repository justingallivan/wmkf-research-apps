import {
  assessmentItems,
  moveAssessmentItem,
  FIRST_BOUNDARY,
  SECOND_BOUNDARY,
} from '../../shared/components/proposal-ranking/assessment-model';
test('card crossing a divider changes its grade without moving other cards into a new grade', () => {
  const source = {
    order: ['a', 'b', 'c'],
    boundaries: [1, 2],
    confidence: { a: 'confident' },
  };
  expect(assessmentItems(source)).toEqual([
    'a',
    FIRST_BOUNDARY,
    'b',
    SECOND_BOUNDARY,
    'c',
  ]);
  const moved = moveAssessmentItem(source, 0, 2);
  expect(moved).toEqual({
    ...source,
    order: ['b', 'a', 'c'],
    boundaries: [0, 2],
  });
  expect(source.boundaries).toEqual([1, 2]);
});
test('bars can empty a section but cannot cross', () => {
  const source = { order: ['a', 'b', 'c'], boundaries: [1, 2] };
  expect(moveAssessmentItem(source, 1, 0).boundaries).toEqual([0, 2]);
  expect(moveAssessmentItem(source, 1, 4)).toBe(source);
  expect(moveAssessmentItem(source, 3, 2).boundaries).toEqual([1, 1]);
});
