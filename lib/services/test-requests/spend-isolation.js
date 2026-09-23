import { createRequestTestStateLookup, resolveRequestTestState } from './request-test-state.js';
import { testRequestIsolationEnabled } from './isolation.js';

const number = (value) => Number(value || 0);

/**
 * Filter pre-aggregated review-panel spend groups by their trusted Request ID.
 * The caller keeps its historical SQL path when isolation is off; this helper
 * is therefore reached only after the marker schema is enabled.
 */
export async function excludeTestRequestSpendRows(
  rows,
  { env = process.env, resolve = resolveRequestTestState } = {},
) {
  if (!testRequestIsolationEnabled(env)) return { rows, isolation: null };
  const lookup = createRequestTestStateLookup({ env, resolve });
  const included = [];
  const isolation = {
    excludedAttemptCount: 0,
    excludedKnownCostCents: 0,
    excludedUnknownCostCount: 0,
    testStateUnknown: 0,
  };

  for (const row of rows || []) {
    const state = await lookup(row.request_id);
    if (state.kind === 'ordinary') {
      included.push(row);
      continue;
    }
    isolation.excludedAttemptCount += number(row.attempt_count);
    isolation.excludedKnownCostCents += number(row.known_cost_cents);
    isolation.excludedUnknownCostCount += number(row.unknown_count);
    if (state.kind === 'unknown') isolation.testStateUnknown += 1;
  }
  return { rows: included, isolation };
}
