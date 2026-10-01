/**
 * Validate the reviewer-roster POST's indexed, server-keyed batch receipt.
 * Malformed or incomplete receipts are unknown outcomes; callers must reload.
 */
export function readRosterSaveReceipt(data, expectedCount) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !Array.isArray(data.outcomes) || data.outcomes.length !== expectedCount
    || !Number.isInteger(data.recorded) || data.recorded < 0) return null;

  const allowed = new Set(['recorded', 'unchanged', 'invalid', 'failed']);
  const outcomes = [];
  for (let inputIndex = 0; inputIndex < expectedCount; inputIndex += 1) {
    const outcome = data.outcomes[inputIndex];
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)
      || outcome.inputIndex !== inputIndex || !allowed.has(outcome.status)
      || !(outcome.candidateKey === null
        || (typeof outcome.candidateKey === 'string' && outcome.candidateKey.length > 0))) return null;
    if ((outcome.status === 'recorded' || outcome.status === 'unchanged' || outcome.status === 'failed')
      && !outcome.candidateKey) return null;
    outcomes.push(outcome);
  }
  const recorded = outcomes.filter(({ status }) => status === 'recorded').length;
  const success = outcomes.every(({ status }) => status === 'recorded' || status === 'unchanged');
  if (recorded !== data.recorded || data.success !== success) return null;
  return { success, recorded, outcomes };
}
