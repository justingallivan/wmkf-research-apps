/**
 * Grammatical English list formatter (serial / "Oxford" comma).
 *
 * Joins a list of names into a single grammatically-correct phrase regardless of
 * how many there are, so email copy reads naturally for any number of co-PIs:
 *   []                  → ''
 *   ['A']               → 'A'
 *   ['A', 'B']          → 'A and B'
 *   ['A', 'B', 'C']     → 'A, B, and C'
 *   ['A', 'B', 'C', 'D']→ 'A, B, C, and D'
 *
 * Blank / whitespace-only entries are dropped first, so a sparse list never
 * produces a dangling comma or a stray "and". Input is an array of strings (the
 * co-PI junction returns names as an array); non-string entries are coerced.
 *
 * @param {Array<string>} names
 * @returns {string}
 */
export function formatNameList(names) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  // 3+: serial comma before the final "and".
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}
