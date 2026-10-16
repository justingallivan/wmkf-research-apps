/** Version-2 assessment calculations. No persistence, identity lookup or weighting. */
import {
  buildSeedOrder,
  calculateComposite,
  calculateCumulativeTotals,
  validateCompleteOrder,
} from './calculations.js';

export const CONFIDENCE_VALUES = Object.freeze(['confident', 'not-sure']);
export const GRADES = Object.freeze(['A', 'B', 'C']);

export function defaultBoundaries(count) {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Proposal count must be a nonnegative integer.');
  const third = Math.floor(count / 3);
  const first = third + (count % 3 > 0 ? 1 : 0);
  return [first, first + third + (count % 3 > 1 ? 1 : 0)];
}

export function validBoundaries(boundaries, count) {
  return (
    Array.isArray(boundaries) &&
    boundaries.length === 2 &&
    boundaries.every(Number.isSafeInteger) &&
    boundaries[0] >= 0 &&
    boundaries[0] <= boundaries[1] &&
    boundaries[1] <= count
  );
}

/** Drafts may omit answers; ready/merge/reveal must explicitly require completeness. */
export function validateAssessment(
  assessment,
  expectedIds,
  { complete = false } = {},
) {
  if (
    !assessment ||
    !validateCompleteOrder(assessment.order, expectedIds) ||
    !validBoundaries(assessment.boundaries, expectedIds.length)
  )
    return false;
  const confidence = assessment.confidence;
  if (
    !confidence ||
    typeof confidence !== 'object' ||
    Array.isArray(confidence)
  )
    return false;
  const keys = Object.keys(confidence);
  return (
    keys.every(
      (id) =>
        expectedIds.includes(id) && CONFIDENCE_VALUES.includes(confidence[id]),
    ) &&
    (!complete || keys.length === expectedIds.length)
  );
}

export function gradeAt(index, boundaries) {
  return index < boundaries[0] ? 'A' : index < boundaries[1] ? 'B' : 'C';
}

export function seedAssessment(order) {
  if (!validateCompleteOrder(order, order))
    throw new Error('Seed contains duplicate proposals.');
  return {
    order: [...order],
    boundaries: defaultBoundaries(order.length),
    confidence: {},
  };
}

export function mergeProgramAssessments({ mr, se }, proposals) {
  const byProgram = (program) =>
    proposals
      .filter((proposal) => proposal.programKey === program)
      .map((proposal) => proposal.requestId);
  if (
    proposals.some((proposal) => !['mr', 'se'].includes(proposal.programKey)) ||
    new Set(proposals.map((proposal) => proposal.requestId)).size !==
      proposals.length ||
    !validateAssessment(mr, byProgram('mr'), { complete: true }) ||
    !validateAssessment(se, byProgram('se'), { complete: true })
  ) {
    throw new Error(
      'Both program assessments must be complete before combining.',
    );
  }
  const byId = new Map(
    proposals.map((proposal) => [proposal.requestId, proposal]),
  );
  const order = [];
  const ends = [];
  for (const grade of GRADES) {
    const left = mr.order.filter(
      (id, index) => gradeAt(index, mr.boundaries) === grade,
    );
    const right = se.order.filter(
      (id, index) => gradeAt(index, se.boundaries) === grade,
    );
    for (
      let index = 0;
      index < Math.max(left.length, right.length);
      index += 1
    ) {
      // Sort only this pair: a later pair can never leap over an earlier one.
      const pair = [left[index], right[index]].filter((id) => id !== undefined);
      order.push(...buildSeedOrder(pair.map((id) => byId.get(id))));
    }
    ends.push(order.length);
  }
  return {
    order,
    boundaries: ends.slice(0, 2),
    confidence: { ...mr.confidence, ...se.confidence },
  };
}

export function calculateRevealedAssessment(assessments, proposals) {
  const seed = buildSeedOrder(proposals);
  if (
    !assessments.length ||
    new Set(seed).size !== seed.length ||
    assessments.some(
      (assessment) => !validateAssessment(assessment, seed, { complete: true }),
    )
  ) {
    throw new Error(
      'Every individual combined assessment must be complete before reveal.',
    );
  }
  const composite = calculateComposite(assessments, seed);
  const grades = assessments.map(
    (assessment) =>
      new Map(
        assessment.order.map((id, index) => [
          id,
          gradeAt(index, assessment.boundaries),
        ]),
      ),
  );
  let first = 0;
  let second = composite.order.length;
  while (
    first < composite.order.length &&
    grades.every((map) => map.get(composite.order[first]) === 'A')
  )
    first += 1;
  while (
    second > first &&
    grades.every((map) => map.get(composite.order[second - 1]) === 'C')
  )
    second -= 1;
  return { ...composite, boundaries: [first, second] };
}

export function calculateSectionTotals(order, boundaries, proposals) {
  const expected = proposals.map((proposal) => proposal.requestId);
  if (
    !validateCompleteOrder(order, expected) ||
    !validBoundaries(boundaries, order.length)
  )
    throw new Error('Invalid collective order or separators.');
  const byId = new Map(
    proposals.map((proposal) => [
      proposal.requestId,
      {
        ...proposal,
        currencyCode: proposal.currency?.code || proposal.currencyCode || null,
      },
    ]),
  );
  const sections = [
    order.slice(0, boundaries[0]),
    order.slice(boundaries[0], boundaries[1]),
    order.slice(boundaries[1]),
  ];
  return sections.map((ids) => {
    const totals = calculateCumulativeTotals(ids, byId);
    const last = totals[totals.length - 1];
    const geography = { East: 0, West: 0, Unknown: 0 };
    ids.forEach((id) => {
      const value = byId.get(id).institutionGeography;
      geography[value === 'East' || value === 'West' ? value : 'Unknown'] += 1;
    });
    return {
      count: ids.length,
      amountMinorUnits: last ? last.cumulativeMinorUnits : 0,
      complete: last ? last.complete : true,
      currencyCode: last?.currencyCode || null,
      geography,
    };
  });
}
