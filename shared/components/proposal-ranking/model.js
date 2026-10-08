export const PROGRAMS = [
  { key: 'se', label: 'Science & Engineering', shortLabel: 'SE' },
  { key: 'mr', label: 'Medical Research', shortLabel: 'MR' },
];

export const REVIEWER_SCORE_COLORS = Object.freeze([
  '#b91c1c', '#dc2626', '#ea580c', '#f97316', '#f59e0b',
  '#eab308', '#a3b80a', '#84cc16', '#22c55e', '#15803d',
]);
export const UNSCORED_REVIEWER_SCORE_COLOR = '#9ca3af';

export function reviewerScoreIndicator(score) {
  const mean = score?.mean;
  if (!Number.isFinite(mean) || mean < 1 || mean > 5
    || !Number.isFinite(score?.ratedCount) || score.ratedCount < 1) {
    return { color: UNSCORED_REVIEWER_SCORE_COLOR, label: 'Average reviewer score: unscored' };
  }
  const index = Math.round(((mean - 1) / 4) * (REVIEWER_SCORE_COLORS.length - 1));
  return {
    color: REVIEWER_SCORE_COLORS[index],
    label: `Average reviewer score: ${(Math.round(mean * 10) / 10).toFixed(1)} out of 5 (approximate color)`,
  };
}

export function moveProposal(order, from, to) {
  if (!Array.isArray(order) || from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return order;
  }
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function buildCumulativeTotals(order, proposals) {
  const byId = new Map((proposals || []).map((proposal) => [proposal.requestId, proposal]));
  let sum = 0;
  let complete = true;
  let currencyCode = null;
  return (order || []).map((requestId) => {
    const proposal = byId.get(requestId);
    const amount = proposal?.amountMinorUnits;
    const code = proposal?.currency?.code || null;
    if (!proposal || !Number.isSafeInteger(amount) || !code || (currencyCode && currencyCode !== code)) {
      complete = false;
    } else if (complete) {
      sum += amount;
      if (!Number.isSafeInteger(sum)) complete = false;
      if (!currencyCode) currencyCode = code;
    }
    return {
      requestId,
      cumulativeMinorUnits: complete ? sum : null,
      complete,
      currencyCode: currencyCode && (!code || code === currencyCode) ? currencyCode : null,
    };
  });
}

export function formatMoney(minorUnits, currency, { incomplete = false } = {}) {
  if (incomplete || !Number.isSafeInteger(minorUnits) || !currency?.code || !Number.isInteger(currency.precision)) {
    return 'Total incomplete';
  }
  const amount = minorUnits / (10 ** currency.precision);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: currency.precision,
      maximumFractionDigits: currency.precision,
    }).format(amount);
  } catch {
    return `${currency.code} ${amount.toFixed(currency.precision)}`;
  }
}

export function formatScore(score) {
  if (!score) return 'Not scored';
  if (!Number.isFinite(score.displayMean) || !Number.isFinite(score.ratedCount) || score.ratedCount === 0) {
    return 'Not scored';
  }
  const mean = score.displayMean.toFixed(1);
  const rated = Number.isFinite(score.ratedCount) ? score.ratedCount : 0;
  const received = Number.isFinite(score.receivedCount) ? score.receivedCount : 0;
  return `${mean} · ${rated}/${received} rated`;
}

export function errorMessage(error) {
  if (!error) return '';
  if (error.code === 'uncertain_outcome') {
    return 'The save may have reached the server. Refresh this round to reconcile its current state before continuing.';
  }
  if (error.status === 409) return error.message || 'This round changed elsewhere. Refresh before continuing.';
  if (error.status === 503) return error.message || 'Proposal Ranking is temporarily unavailable. Try again later.';
  return error.message || 'Proposal Ranking could not complete that action.';
}
