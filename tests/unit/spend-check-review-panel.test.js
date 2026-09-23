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
const AlertService = require('../../lib/services/alert-service');
const { excludeTestRequestSpendRows } = require('../../lib/services/test-requests/spend-isolation.js');
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
  delete process.env.TEST_REQUEST_ISOLATION;
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('isolation on groups panel spend by request and exposes excluded and unattributable totals', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  sql.mockResolvedValueOnce({ rows: [{ total_cost_cents: '100', request_count: 2 }] });
  sql.query.mockResolvedValueOnce({ rows: [
    { request_id: 'ordinary', attempt_count: 2, known_cost_cents: '25', unknown_count: 0 },
    { request_id: 'test', attempt_count: 3, known_cost_cents: '40', unknown_count: 1 },
  ] });
  const res = response();
  await handler({ method: 'GET' }, res);

  expect(sql.query.mock.calls[0][0]).toContain('JOIN review_panel_entries e ON e.id = a.entry_id');
  expect(excludeTestRequestSpendRows).toHaveBeenCalled();
  expect(res.body.dailyThreshold).toMatchObject({
    spentCents: 125,
    panelKnownCents: 25,
    panelUnknownCount: 0,
    testRequestIsolation: { excludedAttemptCount: 3, excludedKnownCostCents: 40 },
    apiUsageAttribution: 'unattributable',
  });
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

test('threshold NOT exceeded but a review panel attempt has unknown cost: an alert is still raised (not autoResolved) naming the count and the known total, under its OWN dedupe key', async () => {
  mockQueries({ usageRow: { total_cost_cents: '100', request_count: 2 }, panelRow: { panel_known_cost_cents: '50', panel_unknown_count: 1 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold).toMatchObject({ status: 'alerting', spentCents: 150, panelKnownCents: 50, panelUnknownCount: 1 });
  expect(AlertService.createAlert).toHaveBeenCalledTimes(1); // only the panel-unknown alert — threshold not breached
  expect(AlertService.autoResolve).toHaveBeenCalledWith('spend:daily-threshold'); // the threshold condition itself is clear
  const alertCall = AlertService.createAlert.mock.calls[0][0];
  expect(alertCall.message).toMatch(/1 review panel attempt\(s\) have unknown cost; the daily total is incomplete/i);
  expect(alertCall.message).toMatch(/\$0\.50/); // the known total is still named
  expect(alertCall.autoResolveKey).toBe('spend:review-panel-unknown-cost'); // its OWN key — never the threshold key
  expect(alertCall.metadata).toMatchObject({ overThreshold: false, panelKnownCents: 50, panelUnknownCount: 1 });
});

test('threshold exceeded AND a review panel attempt has unknown cost: two INDEPENDENT alerts, one per condition, each under its own key', async () => {
  process.env.DAILY_SPEND_ALERT_CENTS = '100';
  mockQueries({ usageRow: { total_cost_cents: '60', request_count: 3 }, panelRow: { panel_known_cost_cents: '50', panel_unknown_count: 2 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.status).toBe('alerting');
  expect(res.body.dailyThreshold.spentCents).toBe(110);
  expect(AlertService.createAlert).toHaveBeenCalledTimes(2);
  expect(AlertService.autoResolve).not.toHaveBeenCalled();
  const keys = AlertService.createAlert.mock.calls.map((call) => call[0].autoResolveKey).sort();
  expect(keys).toEqual(['spend:daily-threshold', 'spend:review-panel-unknown-cost'].sort());
  const thresholdCall = AlertService.createAlert.mock.calls.find((call) => call[0].autoResolveKey === 'spend:daily-threshold')[0];
  expect(thresholdCall.message).not.toMatch(/incomplete/i); // the threshold alert's own copy is unchanged by the panel condition
  const panelCall = AlertService.createAlert.mock.calls.find((call) => call[0].autoResolveKey === 'spend:review-panel-unknown-cost')[0];
  expect(panelCall.message).toMatch(/incomplete/i);
  expect(panelCall.message).toMatch(/2 review panel attempt\(s\)/);
  expect(panelCall.metadata).toMatchObject({ panelKnownCents: 50, panelUnknownCount: 2, overThreshold: true });
});

test('dedupe collision regression: an unknown-only alert earlier in the day does not suppress a genuine threshold breach later — two separate cron passes each raise their own alert', async () => {
  // Pass 1 (e.g. 9am): unknown-only, under threshold.
  mockQueries({ usageRow: { total_cost_cents: '0', request_count: 0 }, panelRow: { panel_known_cost_cents: '0', panel_unknown_count: 1 } });
  await handler({ method: 'GET' }, response());
  expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
  expect(AlertService.createAlert.mock.calls[0][0].autoResolveKey).toBe('spend:review-panel-unknown-cost');

  // Pass 2 (e.g. 2pm): a genuine threshold breach, unknown condition persists.
  process.env.DAILY_SPEND_ALERT_CENTS = '100';
  mockQueries({ usageRow: { total_cost_cents: '200', request_count: 5 }, panelRow: { panel_known_cost_cents: '0', panel_unknown_count: 1 } });
  await handler({ method: 'GET' }, response());
  // Across both passes, BOTH keys have now raised an alert — the earlier
  // unknown-only alert never suppressed the later breach (pass 2 alerts
  // twice: once for the new breach, once because the unknown condition
  // still persists — that persistence is independent, expected behavior).
  expect(AlertService.createAlert).toHaveBeenCalledTimes(3);
  const pass2Keys = AlertService.createAlert.mock.calls.slice(1).map((call) => call[0].autoResolveKey).sort();
  expect(pass2Keys).toEqual(['spend:daily-threshold', 'spend:review-panel-unknown-cost'].sort());
});

test('breach clears while the unknown condition persists: only the threshold key is autoResolved, the panel-unknown alert keeps firing', async () => {
  // Pass 1: both conditions active.
  process.env.DAILY_SPEND_ALERT_CENTS = '100';
  mockQueries({ usageRow: { total_cost_cents: '200', request_count: 5 }, panelRow: { panel_known_cost_cents: '0', panel_unknown_count: 1 } });
  await handler({ method: 'GET' }, response());
  expect(AlertService.createAlert).toHaveBeenCalledTimes(2);

  // Pass 2: the breach clears, but the unknown-cost condition persists.
  jest.clearAllMocks();
  mockQueries({ usageRow: { total_cost_cents: '10', request_count: 1 }, panelRow: { panel_known_cost_cents: '0', panel_unknown_count: 1 } });
  await handler({ method: 'GET' }, response());
  expect(AlertService.autoResolve).toHaveBeenCalledTimes(1);
  expect(AlertService.autoResolve).toHaveBeenCalledWith('spend:daily-threshold');
  expect(AlertService.createAlert).toHaveBeenCalledTimes(1);
  expect(AlertService.createAlert.mock.calls[0][0].autoResolveKey).toBe('spend:review-panel-unknown-cost');
});

test('never folds an unknown-outcome attempt cost into the total (fixture has a nonzero known total to prove suppression, not absence)', async () => {
  mockQueries({ usageRow: { total_cost_cents: '0', request_count: 0 }, panelRow: { panel_known_cost_cents: '200', panel_unknown_count: 5 } });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.spentCents).toBe(200); // only the KNOWN 200 cents, the 5 unknown attempts contribute nothing
  expect(res.body.dailyThreshold.panelUnknownCount).toBe(5);
});

test('migration 047 not yet applied (42P01 undefined_table on review_panel_seat_attempts): cron still returns 200 and the daily threshold logic runs on api_usage_log alone, no unknown-cost alert', async () => {
  sql.mockResolvedValueOnce({ rows: [{ total_cost_cents: '100', request_count: 2 }] });
  sql.query.mockRejectedValueOnce(Object.assign(new Error('relation "review_panel_seat_attempts" does not exist'), { code: '42P01' }));
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.dailyThreshold).toMatchObject({
    status: 'ok',
    spentCents: 100,
    panelKnownCents: 0,
    panelUnknownCount: 0,
    panelAvailable: false,
  });
  // No unknown-cost alert raised for an unmigrated table — it isn't an
  // "unknown cost" condition, just an absent one — and the threshold
  // logic still ran to completion on api_usage_log alone.
  expect(AlertService.createAlert).not.toHaveBeenCalled();
  expect(AlertService.autoResolve).toHaveBeenCalledWith('spend:review-panel-unknown-cost');
  expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/review_panel_seat_attempts not present; migration 047 not applied/));
  warnSpy.mockRestore();
});

test('a non-42P01 error from the panel query still propagates as a failed cron run (the guard is not a blanket swallow)', async () => {
  sql.mockResolvedValueOnce({ rows: [{ total_cost_cents: '100', request_count: 2 }] });
  sql.query.mockRejectedValueOnce(Object.assign(new Error('connection terminated unexpectedly'), { code: '57P03' }));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(500);
  expect(AlertService.createAlert).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
