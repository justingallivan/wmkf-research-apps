/**
 * Extends /api/cron/spend-check for the Virtual Review Panel Phase A ledger
 * (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.5):
 * the panel never writes api_usage_log, so its known cost must be folded
 * into the daily sum from review_panel_seat_attempts directly, and any
 * unknown-outcome attempts in the window must be surfaced, never silently
 * dropped or silently counted as $0.
 *
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/alert-service', () => ({ createAlert: jest.fn(), autoResolve: jest.fn() }));
jest.mock('../../lib/services/maintenance-service', () => ({ startRun: jest.fn(async () => 'run-1'), completeRun: jest.fn(async () => {}) }));

const { sql } = require('@vercel/postgres');
const AlertService = require('../../lib/services/alert-service');
const handler = require('../../pages/api/cron/spend-check').default;

function response() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DAILY_SPEND_ALERT_CENTS;
});

test('folds known review panel cost into the daily total and counts unknown-outcome attempts separately, without alerting under threshold', async () => {
  sql
    .mockResolvedValueOnce({ rows: [{ total_cost_cents: '100', request_count: 2 }] }) // api_usage_log
    .mockResolvedValueOnce({ rows: [{ panel_known_cost_cents: '50', panel_unknown_count: 1 }] }); // review_panel_seat_attempts
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold).toMatchObject({ status: 'ok', spentCents: 150, panelKnownCents: 50, panelUnknownCount: 1 });
  expect(AlertService.createAlert).not.toHaveBeenCalled();
});

test('an alert triggered by the combined total names the withheld/unknown attempt count in its message — proving the note is present, not just the count', async () => {
  process.env.DAILY_SPEND_ALERT_CENTS = '100';
  sql
    .mockResolvedValueOnce({ rows: [{ total_cost_cents: '60', request_count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ panel_known_cost_cents: '50', panel_unknown_count: 2 }] });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.status).toBe('alerting');
  expect(res.body.dailyThreshold.spentCents).toBe(110);
  const alertCall = AlertService.createAlert.mock.calls[0][0];
  expect(alertCall.message).toMatch(/incomplete/i);
  expect(alertCall.message).toMatch(/2 attempt\(s\)/);
  expect(alertCall.metadata).toMatchObject({ panelKnownCents: 50, panelUnknownCount: 2 });
});

test('never folds an unknown-outcome attempt cost into the total (fixture has a nonzero known total to prove suppression, not absence)', async () => {
  sql
    .mockResolvedValueOnce({ rows: [{ total_cost_cents: '0', request_count: 0 }] })
    .mockResolvedValueOnce({ rows: [{ panel_known_cost_cents: '200', panel_unknown_count: 5 }] });
  const res = response();
  await handler({ method: 'GET' }, res);
  expect(res.body.dailyThreshold.spentCents).toBe(200); // only the KNOWN 200 cents, the 5 unknown attempts contribute nothing
  expect(res.body.dailyThreshold.panelUnknownCount).toBe(5);
});
