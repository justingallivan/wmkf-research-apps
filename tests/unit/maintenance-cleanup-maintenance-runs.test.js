/**
 * Tests for MaintenanceService.cleanupMaintenanceRuns + getRetentionConfig's
 * maintenance_runs_days default + Dataverse override path.
 *
 * Codebase eval 2026-05-29 #3 follow-up: the drain-submissions cron writes
 * maintenance_runs rows on every active/failed tick; the table had no
 * retention sweep. This adds one to the daily maintenance run.
 *
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@vercel/blob', () => ({ list: jest.fn(), del: jest.fn() }));
jest.mock('../../lib/utils/intake-blob', () => ({ getIntakeBlobToken: jest.fn() }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: {} }));
jest.mock('../../lib/services/settings-service', () => ({ listSettings: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/services/dynamics-context', () => ({ bypassDynamicsRestrictions: jest.fn() }));
jest.mock('../../lib/services/intake-draft-service', () => ({}));
jest.mock('../../lib/services/intake-audit-service', () => ({ log: jest.fn() }));

const { sql } = require('@vercel/postgres');
const { listSettings } = require('../../lib/services/settings-service');
const MaintenanceService = require('../../lib/services/maintenance-service');

beforeEach(() => {
  sql.mockReset();
  listSettings.mockReset();
});

describe('cleanupMaintenanceRuns', () => {
  it('issues DELETE on maintenance_runs by started_at with MAKE_INTERVAL parametrized on retentionDays', async () => {
    sql.mockResolvedValueOnce({ rowCount: 512 });
    const deleted = await MaintenanceService.cleanupMaintenanceRuns(90);
    expect(deleted).toBe(512);
    expect(sql).toHaveBeenCalledTimes(1);
    const [stringsArr, ...values] = sql.mock.calls[0];
    const template = Array.isArray(stringsArr) ? stringsArr.join('?') : '';
    expect(template).toMatch(/DELETE FROM maintenance_runs/i);
    expect(template).toMatch(/started_at\s*<\s*NOW\(\)\s*-\s*MAKE_INTERVAL\(days\s*=>\s*\?\)/i);
    expect(values).toContain(90);
  });

  it('returns 0 when rowCount is missing/null', async () => {
    sql.mockResolvedValueOnce({ rowCount: null });
    expect(await MaintenanceService.cleanupMaintenanceRuns(90)).toBe(0);
  });

  it('re-throws on SQL error so the cron try/catch records failure', async () => {
    sql.mockRejectedValueOnce(new Error('connection terminated'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(MaintenanceService.cleanupMaintenanceRuns(90)).rejects.toThrow('connection terminated');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('default arity uses 90 days when called with no args', async () => {
    sql.mockResolvedValueOnce({ rowCount: 0 });
    await MaintenanceService.cleanupMaintenanceRuns();
    const [, ...values] = sql.mock.calls[0];
    expect(values).toContain(90);
  });
});

describe('getRetentionConfig — maintenance_runs_days', () => {
  it('default is 90 when no Dataverse override exists', async () => {
    listSettings.mockResolvedValueOnce({});
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.maintenance_runs_days).toBe(90);
  });

  it('Dataverse override at retention:maintenance_runs_days replaces the default', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:maintenance_runs_days': '30' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.maintenance_runs_days).toBe(30);
  });

  it('zero override is rejected — preserves default 90', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:maintenance_runs_days': '0' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.maintenance_runs_days).toBe(90);
  });
});
