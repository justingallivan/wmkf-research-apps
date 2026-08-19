/**
 * Unit tests for MaintenanceService.cleanupOperationalEvents and the
 * retention-config default, plus AlertService.autoResolve recovery
 * propagation into operational_events.
 *
 * @jest-environment node
 */

const sqlMock = jest.fn();
sqlMock.query = jest.fn();
jest.mock('@vercel/postgres', () => ({
  sql: Object.assign((strings, ...values) => sqlMock(strings, ...values), {
    query: (...args) => sqlMock.query(...args),
  }),
}));
jest.mock('../../lib/services/settings-service', () => ({
  listSettings: jest.fn().mockResolvedValue({}),
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn(),
}));

const MaintenanceService = require('../../lib/services/maintenance-service');
const AlertService = require('../../lib/services/alert-service');

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.query.mockReset();
});

describe('cleanupOperationalEvents', () => {
  test('deletes settled rows at the window, open rows at 2x, and enforces the cap', async () => {
    sqlMock
      .mockResolvedValueOnce({ rowCount: 10 }) // settled
      .mockResolvedValueOnce({ rowCount: 2 })  // stale open
      .mockResolvedValueOnce({ rowCount: 1 }); // cap overflow
    const deleted = await MaintenanceService.cleanupOperationalEvents(90);
    expect(deleted).toBe(13);

    const settledText = sqlMock.mock.calls[0][0].join(' ');
    expect(settledText).toContain("status <> 'open'");
    expect(sqlMock.mock.calls[0].slice(1)).toContain(90);

    const openText = sqlMock.mock.calls[1][0].join(' ');
    expect(openText).toContain("status = 'open'");
    expect(sqlMock.mock.calls[1].slice(1)).toContain(180); // 2x window

    const capText = sqlMock.mock.calls[2][0].join(' ');
    // The cap must rank by OPERATIONAL recency: folded/reopened events keep
    // their original low id while recurrence refreshes last_occurred_at, so
    // an id-ordered cap would delete a still-current open incident (Codex
    // adversarial finding, cycle 2). An old-id row with a fresh
    // last_occurred_at must survive the cap window.
    expect(capText).toContain('ORDER BY last_occurred_at DESC, id DESC');
    expect(capText).toContain('OFFSET');
    expect(capText).not.toMatch(/ORDER BY id DESC(?!.*last_occurred_at)/);
  });

  test('missing table (42P01) is silent — cron may run before migration 030', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    sqlMock.mockRejectedValue(err);
    await expect(MaintenanceService.cleanupOperationalEvents()).resolves.toBe(0);
  });

  test('other SQL failures rethrow so the cron reports the subtask failure', async () => {
    sqlMock.mockRejectedValue(new Error('permission denied'));
    await expect(MaintenanceService.cleanupOperationalEvents()).rejects.toThrow('permission denied');
  });
});

test('getRetentionConfig includes operational_events_days default of 90', async () => {
  const config = await MaintenanceService.getRetentionConfig();
  expect(config.operational_events_days).toBe(90);
});

describe('AlertService.autoResolve recovery propagation', () => {
  test('marks matching operational events recovered after resolving alerts', async () => {
    sqlMock
      .mockResolvedValueOnce({ rowCount: 1 })   // system_alerts UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 4 }] }); // operational_events UPDATE
    const count = await AlertService.autoResolve('honorarium_onboard_failed:sugg-1');
    expect(count).toBe(1);
    const eventText = sqlMock.mock.calls[1][0].join(' ');
    expect(eventText).toContain('operational_events');
    expect(sqlMock.mock.calls[1].slice(1)).toContain('recovered');
  });

  test('event-recovery failure never breaks alert auto-resolve', async () => {
    sqlMock
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockRejectedValueOnce(new Error('events table down'));
    await expect(AlertService.autoResolve('key')).resolves.toBe(2);
  });
});
