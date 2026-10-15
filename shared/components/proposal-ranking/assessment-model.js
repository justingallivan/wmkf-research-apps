/** Cards and dividers share a sequence so crossing a bar changes only that card. */
export const FIRST_BOUNDARY = 'ranking-boundary-first';
export const SECOND_BOUNDARY = 'ranking-boundary-second';
export function assessmentItems({ order, boundaries }) {
  return [
    ...order.slice(0, boundaries[0]),
    FIRST_BOUNDARY,
    ...order.slice(boundaries[0], boundaries[1]),
    SECOND_BOUNDARY,
    ...order.slice(boundaries[1]),
  ];
}
export function moveAssessmentItem(assessment, from, to) {
  const items = assessmentItems(assessment);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return assessment;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  if (items.indexOf(FIRST_BOUNDARY) > items.indexOf(SECOND_BOUNDARY))
    return assessment;
  return {
    ...assessment,
    order: items.filter(
      (id) => id !== FIRST_BOUNDARY && id !== SECOND_BOUNDARY,
    ),
    boundaries: [
      items.indexOf(FIRST_BOUNDARY),
      items.indexOf(SECOND_BOUNDARY) - 1,
    ],
  };
}
