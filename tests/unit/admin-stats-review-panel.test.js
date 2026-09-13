/**
 * Extends /api/admin/stats for the Virtual Review Panel Phase A ledger
 * (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5):
 * a `reviewPanel` block surfaces known cents, attempt counts by state, and
 * unknownCount, additive to the existing api_usage_log-derived response.
 *
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 7 })) }));

const { sql } = require('@vercel/postgres');
const handler = require('../../pages/api/admin/stats').default;

function response() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function mockSqlByContent(panelRows) {
  sql.mockImplementation((strings) => {
    const text = strings.join(' ');
    if (text.includes('FROM review_panel_seat_attempts')) return Promise.resolve({ rows: panelRows });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { jest.clearAllMocks(); });

test('reviewPanel.knownCostCents sums only known-state cost, additive to the existing response shape', async () => {
  mockSqlByContent([
    { state: 'completed', attempt_count: 3, known_cost_cents: '150' },
    { state: 'failed', attempt_count: 1, known_cost_cents: '0' },
  ]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.body.reviewPanel).toEqual({
    knownCostCents: 150,
    unknownCount: 0,
    byState: [
      { state: 'completed', attemptCount: 3, knownCostCents: 150 },
      { state: 'failed', attemptCount: 1, knownCostCents: 0 },
    ],
  });
});

test('unknownCount is populated from unknown_outcome attempts and their cost is never folded into knownCostCents — fixture carries a nonzero known total to prove suppression, not absence', async () => {
  mockSqlByContent([
    { state: 'completed', attempt_count: 2, known_cost_cents: '200' },
    { state: 'unknown_outcome', attempt_count: 4, known_cost_cents: '0' },
  ]);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.body.reviewPanel.knownCostCents).toBe(200);
  expect(res.body.reviewPanel.unknownCount).toBe(4);
});
