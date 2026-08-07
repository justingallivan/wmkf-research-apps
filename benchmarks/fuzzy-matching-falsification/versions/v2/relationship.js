'use strict';

const INVERSE = Object.freeze({
  child: 'parent',
  parent: 'child',
  predecessor: 'successor',
  successor: 'predecessor',
});

function relationshipBetween(left, right) {
  if (!left || !right) return null;
  if (left.ror_id === right.ror_id) return 'same';
  const forward = left.relationships?.find((entry) => (entry.ror_id || entry.id) === right.ror_id);
  if (forward) return forward.type;
  const reverse = right.relationships?.find((entry) => (entry.ror_id || entry.id) === left.ror_id);
  if (reverse) return INVERSE[reverse.type] || reverse.type;
  return 'distinct';
}

function relationshipsAcross(leftCandidates, rightCandidates) {
  const found = new Set();
  for (const left of leftCandidates) {
    for (const right of rightCandidates) found.add(relationshipBetween(left, right));
  }
  return [...found].filter(Boolean).sort();
}

module.exports = { relationshipBetween, relationshipsAcross };
