/**
 * Comparison order for the Discussion Sentiment page (plan §4.2): reception, then enthusiasm, then the
 * number of disagreements, then the number of uncertainties. Most favorable first; fewer disagreements and
 * uncertainties first within a tie; "unclear" last in each category. Rows without a current result sort
 * after every row that has one, in their selection order. Pure and stable.
 */
export const RECEPTION_ORDER = Object.freeze(['positive', 'mixed', 'negative', 'unclear']);
export const ENTHUSIASM_ORDER = Object.freeze(['high', 'moderate', 'low', 'unclear']);

const rank = (order, value) => {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
};

/** rows: [{ record: DeliberationSentiment | null, ... }] in selection order; returns a new sorted array. */
export function sortSentimentRows(rows) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const left = a.row.record;
    const right = b.row.record;
    if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
    if (left && right) {
      return rank(RECEPTION_ORDER, left.reception) - rank(RECEPTION_ORDER, right.reception)
        || rank(ENTHUSIASM_ORDER, left.enthusiasm) - rank(ENTHUSIASM_ORDER, right.enthusiasm)
        || (left.disagreements?.length || 0) - (right.disagreements?.length || 0)
        || (left.uncertainties?.length || 0) - (right.uncertainties?.length || 0)
        || a.index - b.index;
    }
    return a.index - b.index;
  }).map((entry) => entry.row);
}
