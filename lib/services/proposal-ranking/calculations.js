/**
 * Proposal Ranking's deterministic calculation contract. Pure functions only;
 * source interpretation and persistence stay in the service/adapter layers.
 */

export const PROGRAM_KEYS = Object.freeze(['se', 'mr']);
export const RATING_SCALE = Object.freeze([
  { label: 'Excellent', value: 5 },
  { label: 'Very Good', value: 4 },
  { label: 'Good', value: 3 },
  { label: 'Fair', value: 2 },
  { label: 'Poor', value: 1 },
]);

const RATING_BY_VALUE = new Map(RATING_SCALE.map((item) => [item.value, item.label]));
const RATING_BY_LABEL = new Map(RATING_SCALE.map((item) => [item.label.toLowerCase(), item.value]));

export function canonicalGuid(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^\{|\}$/g, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function compareRequestNumbers(left, right) {
  const a = String(left.requestNumber ?? '');
  const b = String(right.requestNumber ?? '');
  const numeric = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return numeric || String(left.requestId).toLowerCase().localeCompare(String(right.requestId).toLowerCase());
}

function validateRatingOptions(options) {
  if (!Array.isArray(options) || options.length !== RATING_SCALE.length) return false;
  const normalized = options.map((option) => ({
    label: String(option?.label ?? option?.text ?? '').trim().toLowerCase(),
    value: Number(option?.value),
  }));
  return RATING_SCALE.every(({ label, value }) => normalized.some((option) => option.label === label.toLowerCase() && option.value === value));
}

/** Read an overallAssessment from its saved row without consulting live questions. */
export function readSavedOverallAssessment(answer) {
  if (answer?.questionOptionsUnreadable === true) return { rating: null, scaleReady: false };
  const rawValue = answer?.overallAssessment ?? answer?.answerValue;
  if (!answer || rawValue == null) return { rating: null, scaleReady: true };
  const value = Number(rawValue);
  if (!Number.isFinite(value) || !RATING_BY_VALUE.has(value)) return { rating: null, scaleReady: false };
  if (answer.questionOptions != null) {
    if (!validateRatingOptions(answer.questionOptions)) return { rating: null, scaleReady: false };
    return { rating: value, scaleReady: true };
  }
  const label = String(answer.overallAssessmentLabel ?? answer.answerText ?? '').trim().toLowerCase();
  return RATING_BY_LABEL.get(label) === value
    ? { rating: value, scaleReady: true }
    : { rating: null, scaleReady: false };
}

/**
 * Build a frozen score summary from received, non-synthetic reviews.
 * Review shape is deliberately adapter-neutral: { received, synthetic, answer }.
 */
export function summarizeProposalReviews(reviews = []) {
  const received = reviews.filter((review) => review?.received === true);
  const distribution = Object.fromEntries(RATING_SCALE.map(({ label }) => [label, 0]));
  const scores = [];
  let receivedCount = 0;
  for (const review of received) {
    if (review.synthetic !== false && review.synthetic !== true) {
      return { ready: false, reason: 'unknown-synthetic-reviewer-marker' };
    }
    if (review.synthetic === true) continue;
    receivedCount += 1;
    const interpreted = readSavedOverallAssessment(review.answer);
    if (!interpreted.scaleReady) return { ready: false, reason: 'unknown-rating-scale' };
    if (interpreted.rating == null) continue;
    scores.push(interpreted.rating);
    distribution[RATING_BY_VALUE.get(interpreted.rating)] += 1;
  }
  const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  return {
    ready: true,
    mean,
    displayMean: mean == null ? null : Math.round(mean * 10) / 10,
    ratedCount: scores.length,
    receivedCount,
    distribution,
  };
}

export function buildSeedOrder(proposals) {
  return [...proposals].sort((a, b) => {
    const aScore = Number.isFinite(a.score?.mean) ? a.score.mean : null;
    const bScore = Number.isFinite(b.score?.mean) ? b.score.mean : null;
    if (aScore != null && bScore == null) return -1;
    if (aScore == null && bScore != null) return 1;
    if (aScore != null && bScore != null && aScore !== bScore) return bScore - aScore;
    return compareRequestNumbers(a, b);
  }).map((proposal) => proposal.requestId);
}

/** Money values are represented as integer minor units and require a common currency. */
export function moneyToMinorUnits(amount, precision = 2) {
  if (amount == null || amount === '') return null;
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || !Number.isInteger(precision) || precision < 0 || precision > 4) return null;
  const factor = 10 ** precision;
  const minor = Math.round(numeric * factor);
  return Math.abs(numeric * factor - minor) < 1e-6 ? minor : null;
}

export function calculateCumulativeTotals(requestIds, proposalById) {
  let totalMinor = 0;
  let complete = true;
  let currency = null;
  const rows = [];
  for (const requestId of requestIds) {
    const proposal = proposalById.get(requestId);
    if (!proposal) throw new Error('The ordered list contains a proposal outside this round.');
    const amount = proposal.amountMinorUnits;
    const rowCurrency = proposal.currencyCode ? String(proposal.currencyCode).toUpperCase() : null;
    if (amount != null && !rowCurrency) throw new Error('A proposal amount has no verified currency.');
    if (rowCurrency && currency && rowCurrency !== currency) throw new Error('Proposal requests use more than one currency.');
    if (rowCurrency) currency ??= rowCurrency;
    if (amount == null) complete = false;
    else if (complete) totalMinor += amount;
    rows.push({ requestId, cumulativeMinorUnits: complete ? totalMinor : null, complete, currencyCode: currency });
  }
  return rows;
}

export function validateCompleteOrder(order, expectedIds) {
  if (!Array.isArray(order) || !Array.isArray(expectedIds) || order.length !== expectedIds.length) return false;
  const expected = new Set(expectedIds);
  return new Set(order).size === order.length && order.every((id) => expected.has(id));
}

export function calculateComposite(submissions, seedOrder) {
  if (!Array.isArray(submissions) || submissions.length === 0) throw new Error('At least one submitted list is required.');
  const proposalCount = seedOrder.length;
  const seedPosition = new Map(seedOrder.map((id, index) => [id, index]));
  const sums = new Map(seedOrder.map((id) => [id, 0]));
  for (const submission of submissions) {
    if (!validateCompleteOrder(submission.order, seedOrder)) throw new Error('A submitted list is incomplete or contains an unknown proposal.');
    submission.order.forEach((id, index) => sums.set(id, sums.get(id) + index + 1));
  }
  const ranked = [...seedOrder].sort((a, b) => sums.get(a) - sums.get(b) || seedPosition.get(a) - seedPosition.get(b));
  const minMaxById = new Map(seedOrder.map((id) => [id, { min: proposalCount, max: 0 }]));
  for (const submission of submissions) {
    submission.order.forEach((id, index) => {
      const range = minMaxById.get(id);
      range.min = Math.min(range.min, index + 1);
      range.max = Math.max(range.max, index + 1);
    });
  }
  const ranges = Object.fromEntries([...minMaxById].map(([id, range]) => [id, {
    ...range,
    disagreement: submissions.length >= 2 && range.max !== range.min
      && range.max - range.min >= Math.ceil(proposalCount / 4),
  }]));
  return {
    order: ranked,
    scores: Object.fromEntries(seedOrder.map((id) => [id, { rankSum: sums.get(id), averageRank: sums.get(id) / submissions.length }])),
    ranges,
  };
}
