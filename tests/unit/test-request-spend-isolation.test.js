/** @jest-environment node */
import { excludeTestRequestSpendRows } from '../../lib/services/test-requests/spend-isolation.js';

const rows = [
  { request_id: '11111111-1111-4111-8111-111111111111', attempt_count: 2, known_cost_cents: 25, unknown_count: 0 },
  { request_id: '22222222-2222-4222-8222-222222222222', attempt_count: 3, known_cost_cents: 40, unknown_count: 1 },
];

test('off mode returns the historical rows unchanged and performs no marker read', async () => {
  const resolve = jest.fn();
  const result = await excludeTestRequestSpendRows(rows, {
    env: { TEST_REQUEST_ISOLATION: 'off' }, resolve,
  });
  expect(result).toEqual({ rows, isolation: null });
  expect(resolve).not.toHaveBeenCalled();
});

test('on mode excludes request-attributable test spend and records it', async () => {
  const resolve = jest.fn(async (requestId) => (
    requestId === rows[0].request_id ? { kind: 'ordinary' } : { kind: 'synthetic' }
  ));
  const result = await excludeTestRequestSpendRows(rows, {
    env: { TEST_REQUEST_ISOLATION: 'on' }, resolve,
  });
  expect(result.rows).toEqual([rows[0]]);
  expect(result.isolation).toEqual({
    excludedAttemptCount: 3,
    excludedKnownCostCents: 40,
    excludedUnknownCostCount: 1,
    testStateUnknown: 0,
  });
});

test('on mode excludes unreadable attribution and records the gap', async () => {
  const result = await excludeTestRequestSpendRows([rows[1]], {
    env: { TEST_REQUEST_ISOLATION: 'on' },
    resolve: async () => ({ kind: 'unknown', reason: 'read_failed' }),
  });
  expect(result.rows).toEqual([]);
  expect(result.isolation.testStateUnknown).toBe(1);
});
