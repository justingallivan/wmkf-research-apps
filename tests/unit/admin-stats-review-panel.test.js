/**
 * Extends /api/admin/stats for the Virtual Review Panel Phase A ledger
 * (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5):
 * a `reviewPanel` block surfaces known cents, attempt counts by state, and
 * unknownCount, additive to the existing api_usage_log-derived response.
 * Must use the SAME ATTEMPT_COST_UNKNOWN_SQL predicate as
 * review-panel-store.js and pages/api/cron/spend-check.js — these tests
 * assert the actual SQL text the mock receives contains that predicate, not
 * just the numbers the test itself hands back.
 *
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => {
  const sqlTag = jest.fn(() => Promise.resolve({ rows: [] }));
  sqlTag.query = jest.fn();
  return { sql: sqlTag };
});
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));
jest.mock('../../lib/services/test-requests/spend-isolation.js', () => ({
  excludeTestRequestSpendRows: jest.fn(async (rows) => ({
    rows: rows.filter((row) => row.request_id === 'ordinary'),
    isolation: {
      excludedAttemptCount: 3,
      excludedKnownCostCents: 40,
      excludedUnknownCostCount: 1,
      testStateUnknown: 0,
    },
  })),
}));

const { sql } = require('@vercel/postgres');
const { ATTEMPT_COST_UNKNOWN_SQL } = require('../../lib/services/review-panel-store');
const { excludeTestRequestSpendRows } = require('../../lib/services/test-requests/spend-isolation.js');
const handler = require('../../pages/api/admin/stats').default;

function response() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function mockPanelRows(rows) {
  sql.query.mockResolvedValueOnce({ rows });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.TEST_REQUEST_ISOLATION;
  sql.mockResolvedValue({ rows: [] });
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('isolation on groups spend by request, excludes marked rows, and records unattributable API usage', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  mockPanelRows([
    { state: 'completed', request_id: 'ordinary', attempt_count: 2, known_cost_cents: '25', unknown_count: 0 },
    { state: 'completed', request_id: 'test', attempt_count: 3, known_cost_cents: '40', unknown_count: 1 },
  ]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);

  expect(sql.query.mock.calls[0][0]).toContain('JOIN review_panel_entries e ON e.id = a.entry_id');
  expect(excludeTestRequestSpendRows).toHaveBeenCalled();
  expect(res.body.reviewPanel).toMatchObject({
    knownCostCents: 25,
    unknownCount: 0,
    isolation: { excludedAttemptCount: 3, excludedKnownCostCents: 40 },
  });
  expect(res.body.usageAttribution).toEqual({ apiUsageLog: 'unattributable' });
});

test('the panel query text embeds the SAME unified unknown-cost predicate as review-panel-store.js — this fails if the predicate is ever deleted or diverges', async () => {
  mockPanelRows([]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(sql.query).toHaveBeenCalledTimes(1);
  const queryText = sql.query.mock.calls[0][0];
  // Assert the COMPLETE guarded SUM expression, not merely that the
  // predicate string appears somewhere in the query (see the matching
  // comment in spend-check-review-panel.test.js).
  expect(queryText).toContain(`SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL})`);
  expect(queryText).toContain(`COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})`);
  expect(queryText).toMatch(/state\s*=\s*'unknown_outcome'/);
  expect(queryText).toMatch(/cost_state\s+IS\s+DISTINCT\s+FROM\s+'known'/i);
  expect(queryText).toContain('FROM review_panel_seat_attempts a');
});

test('reviewPanel.knownCostCents sums only known-cost rows across state buckets, additive to the existing response shape', async () => {
  mockPanelRows([
    { state: 'completed', attempt_count: 3, known_cost_cents: '150', unknown_count: 0 },
    { state: 'failed', attempt_count: 1, known_cost_cents: '0', unknown_count: 0 },
  ]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.body.reviewPanel).toEqual({
    knownCostCents: 150,
    unknownCount: 0,
    byState: [
      { state: 'completed', attemptCount: 3, knownCostCents: 150, unknownCount: 0 },
      { state: 'failed', attemptCount: 1, knownCostCents: 0, unknownCount: 0 },
    ],
    available: true,
  });
});

test('unknownCount is populated from unknown-cost attempts (including a "failed" bucket with an ambiguous paid-call confirmation, not just unknown_outcome) and never folded into knownCostCents — fixture carries a nonzero known total to prove suppression, not absence', async () => {
  mockPanelRows([
    { state: 'completed', attempt_count: 2, known_cost_cents: '200', unknown_count: 0 },
    { state: 'unknown_outcome', attempt_count: 4, known_cost_cents: '0', unknown_count: 4 },
    { state: 'failed', attempt_count: 3, known_cost_cents: '0', unknown_count: 1 }, // 1 of the 3 failed attempts has cost_state='unknown'
  ]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.body.reviewPanel.knownCostCents).toBe(200);
  expect(res.body.reviewPanel.unknownCount).toBe(5); // 4 (unknown_outcome) + 1 (ambiguous failed)
});

test('migration 047 not yet applied (42P01 undefined_table on review_panel_seat_attempts): the endpoint still returns 200 with the rest of the response intact, and reviewPanel signals unavailable rather than a fabricated zero', async () => {
  sql.query.mockRejectedValueOnce(Object.assign(new Error('relation "review_panel_seat_attempts" does not exist'), { code: '42P01' }));
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.reviewPanel).toEqual({ knownCostCents: 0, unknownCount: 0, byState: [], available: false });
  expect(res.body.byApp).toEqual([]); // the rest of the response is unaffected by the missing table
  expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/review_panel_seat_attempts not present; migration 047 not applied/));
  warnSpy.mockRestore();
});

test('a non-42P01 error from the panel query still propagates as a failed request (the guard is not a blanket swallow)', async () => {
  sql.query.mockRejectedValueOnce(Object.assign(new Error('connection terminated unexpectedly'), { code: '57P03' }));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.statusCode).toBe(500);
  errorSpy.mockRestore();
});
