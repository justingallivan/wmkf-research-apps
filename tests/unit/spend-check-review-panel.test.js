/**
 * Extends /api/cron/spend-check for the Virtual Review Panel Phase A ledger
 * (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5):
 * the panel never writes api_usage_log, so its known cost must be folded
 * into the daily sum from review_panel_seat_attempts directly, and any
 * unknown-outcome attempts in the window must be surfaced, never silently
 * dropped or silently counted as $0. The panel query must use the SAME
 * ATTEMPT_COST_UNKNOWN_SQL predicate as review-panel-store.js and
 * pages/api/admin/stats.js — these tests assert the actual SQL text the
 * mock receives contains that predicate, not just the numbers the test
 * itself hands back (a test that only asserts the numbers would still pass
 * if the predicate were deleted and replaced with something else entirely).
 *
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => {
  const sqlTag = jest.fn();
  sqlTag.query = jest.fn();
  return { sql: sqlTag };
});
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/alert-service', () => ({ createAlert: jest.fn(), autoResolve: jest.fn() }));
jest.mock('../../lib/services/maintenance-service', () => ({ startRun: jest.fn(async () => 'run-1'), completeRun: jest.fn(async () => {}) }));

const { sql } = require('@vercel/postgres');
const { ATTEMPT_COST_UNKNOWN_SQL } = require('../../lib/services/review-panel-store');
const AlertService = require('../../lib/services/alert-service');
const handler = require('../../pages/api/cron/spend-check').default;

function response() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function mockQueries({ usageRow, panelRow }) {
  sql.mockResolvedValueOnce({ rows: [usageRow] }); // api_usage_log (tagged sql`...`)
  sql.query.mockResolvedValueOnce({ rows: [panelRow] }); // review_panel_seat_attempts (sql.query)
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DAILY_SPEND_ALERT_CENTS;
});

test('the panel query text embeds the SAME unified unknown-cost predicate as review-panel-store.js — this fails if the predicate is ever deleted or diverges', async () => {
  mockQueries({ usageRow: { total_cost_cents: '0', request_count: 0 }, panelRow: { panel_known_cost_cents: '0', panel_unknown_count: 0 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(sql.query).toHaveBeenCalledTimes(1);
  const queryText = sql.query.mock.calls[0][0];
  // Assert the COMPLETE guarded SUM expression, not merely that the
  // predicate string appears SOMEWHERE in the query — a query that kept the
  // predicate in COUNT but dropped `NOT ${ATTEMPT_COST_UNKNOWN_SQL}` from
  // SUM's own FILTER (folding an unknown-cost attempt's cost into the total)
  // would still pass a bare `toContain(ATTEMPT_COST_UNKNOWN_SQL)` check.
  expect(queryText).toContain(`SUM(a.cost_cents) FILTER (WHERE NOT ${ATTEMPT_COST_UNKNOWN_SQL})`);
  expect(queryText).toContain(`COUNT(*) FILTER (WHERE ${ATTEMPT_COST_UNKNOWN_SQL})`);
  expect(queryText).toMatch(/state\s*=\s*'unknown_outcome'/);
  expect(queryText).toMatch(/cost_state\s+IS\s+DISTINCT\s+FROM\s+'known'/i);
  expect(queryText).toContain('FROM review_panel_seat_attempts a');
});

test('folds known review panel cost into the daily total; no unknown attempts and under threshold means no alert at all', async () => {
  mockQueries({ usageRow: { total_cost_cents: '100', request_count: 2 }, panelRow: { panel_known_cost_cents: '50', panel_unknown_count: 0 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold).toMatchObject({ status: 'ok', spentCents: 150, panelKnownCents: 50, panelUnknownCount: 0 });
  expect(AlertService.createAlert).not.toHaveBeenCalled();
  expect(AlertService.autoResolve).toHaveBeenCalled();
});

test('threshold NOT exceeded but a review panel attempt has unknown cost: an alert is still raised (not autoResolved) naming the count and the known total', async () => {
  mockQueries({ usageRow: { total_cost_cents: '100', request_count: 2 }, panelRow: { panel_known_cost_cents: '50', panel_unknown_count: 1 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold).toMatchObject({ status: 'alerting', spentCents: 150, panelKnownCents: 50, panelUnknownCount: 1 });
  expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  const alertCall = AlertService.createAlert.mock.calls[0][0];
  expect(alertCall.message).toMatch(/1 review panel attempt\(s\) have unknown cost; the daily total is incomplete/i);
  expect(alertCall.message).toMatch(/\$0\.50/); // the known total is still named
  expect(alertCall.autoResolveKey).toBe('spend:daily-threshold'); // same dedupe key as the threshold-exceeded path
  expect(alertCall.metadata).toMatchObject({ overThreshold: false, panelKnownCents: 50, panelUnknownCount: 1 });
});

test('an alert triggered by the combined total names the unknown attempt count in its message — proving the note is present, not just the count', async () => {
  process.env.DAILY_SPEND_ALERT_CENTS = '100';
  mockQueries({ usageRow: { total_cost_cents: '60', request_count: 3 }, panelRow: { panel_known_cost_cents: '50', panel_unknown_count: 2 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.status).toBe('alerting');
  expect(res.body.dailyThreshold.spentCents).toBe(110);
  const alertCall = AlertService.createAlert.mock.calls[0][0];
  expect(alertCall.message).toMatch(/incomplete/i);
  expect(alertCall.message).toMatch(/2 review panel attempt\(s\)/);
  expect(alertCall.metadata).toMatchObject({ panelKnownCents: 50, panelUnknownCount: 2, overThreshold: true });
});

test('never folds an unknown-outcome attempt cost into the total (fixture has a nonzero known total to prove suppression, not absence)', async () => {
  mockQueries({ usageRow: { total_cost_cents: '0', request_count: 0 }, panelRow: { panel_known_cost_cents: '200', panel_unknown_count: 5 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.spentCents).toBe(200); // only the KNOWN 200 cents, the 5 unknown attempts contribute nothing
  expect(res.body.dailyThreshold.panelUnknownCount).toBe(5);
});
