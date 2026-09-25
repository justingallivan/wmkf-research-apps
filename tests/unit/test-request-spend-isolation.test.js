/** @jest-environment node */
import { excludeTestRequestSpendRows } from '../../lib/services/test-requests/spend-isolation.js';

const ORDINARY = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const rows = [
  { request_id: ORDINARY, attempt_count: 2, known_cost_cents: 25, unknown_count: 0 },
  { request_id: TEST.toUpperCase(), attempt_count: 3, known_cost_cents: 40, unknown_count: 1 },
];
const ON = { TEST_REQUEST_ISOLATION: 'on' };
const record = (id, marker, runId) => ({ akoya_requestid: id, wmkf_istestrequest: marker, wmkf_testcreationrunid: runId });

test('off mode returns the historical rows unchanged and performs no marker read', async () => {
  const findByIds = jest.fn();
  const result = await excludeTestRequestSpendRows(rows, { env: { TEST_REQUEST_ISOLATION: 'off' }, findByIds });
  expect(result).toEqual({ rows, isolation: null });
  expect(findByIds).not.toHaveBeenCalled();
});

test('on mode reads requests in one batch and reports test spend as one line', async () => {
  const findByIds = jest.fn(async () => ({ records: [record(ORDINARY, null, null), record(TEST, true, RUN)] }));
  const result = await excludeTestRequestSpendRows(rows, { env: ON, findByIds });
  expect(findByIds).toHaveBeenCalledTimes(1);
  expect(findByIds.mock.calls[0][0]).toEqual([ORDINARY, TEST]);
  expect(result.rows).toEqual([rows[0]]);
  expect(result.isolation).toEqual({
    available: true,
    testSpend: { attemptCount: 3, knownCostCents: 40, unknownCount: 1 },
  });
});

test('on mode chunks large ID sets', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({
    request_id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, attempt_count: 1, known_cost_cents: 1, unknown_count: 0,
  }));
  const findByIds = jest.fn(async (ids) => ({ records: ids.map((id) => record(id, false, null)) }));
  const result = await excludeTestRequestSpendRows(many, { env: ON, findByIds });
  expect(findByIds.mock.calls.map((call) => call[0].length)).toEqual([50, 50, 20]);
  expect(result.rows).toHaveLength(120);
});

test.each([
  ['a request is missing from the read', async () => ({ records: [record(ORDINARY, null, null)] })],
  ['the read throws', async () => { throw new Error('transport'); }],
])('on mode keeps every row and marks isolation unavailable when %s', async (_label, findByIds) => {
  const result = await excludeTestRequestSpendRows(rows, { env: ON, findByIds });
  expect(result.rows).toEqual(rows);
  expect(result.isolation.available).toBe(false);
  expect(result.isolation.testStateUnknown).toBeGreaterThan(0);
});

test('on mode treats a non-GUID request ID as unclassifiable', async () => {
  const findByIds = jest.fn(async () => ({ records: [record(ORDINARY, null, null)] }));
  const result = await excludeTestRequestSpendRows([rows[0], { ...rows[1], request_id: 'not-a-guid' }], { env: ON, findByIds });
  expect(result.isolation).toEqual({ available: false, testStateUnknown: 1 });
  expect(result.rows).toHaveLength(2);
});
