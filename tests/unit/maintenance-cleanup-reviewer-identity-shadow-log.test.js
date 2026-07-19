/**
 * Tests for reviewer identity shadow-log retention, row-cap cleanup, and
 * retention-setting configuration.
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

describe('cleanupReviewerIdentityShadowLog', () => {
  it('applies the retention window and hard row cap, returning both delete counts', async () => {
    sql
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 2 });

    await expect(
      MaintenanceService.cleanupReviewerIdentityShadowLog(45, 12_000),
    ).resolves.toBe(5);
    expect(sql).toHaveBeenCalledTimes(2);

    const [retentionStrings, ...retentionValues] = sql.mock.calls[0];
    expect(retentionStrings.join('?')).toMatch(
      /DELETE FROM reviewer_identity_shadow_log[\s\S]*MAKE_INTERVAL\(days\s*=>\s*\?\)/i,
    );
    expect(retentionValues).toContain(45);

    const [capStrings, ...capValues] = sql.mock.calls[1];
    expect(capStrings.join('?')).toMatch(
      /DELETE FROM reviewer_identity_shadow_log[\s\S]*ORDER BY id DESC[\s\S]*LIMIT\s*\?/i,
    );
    expect(capValues).toContain(12_000);
  });

  it('returns zero when migration 026 has not created the table yet', async () => {
    const missingTable = new Error('relation does not exist');
    missingTable.code = '42P01';
    sql.mockRejectedValueOnce(missingTable);

    await expect(MaintenanceService.cleanupReviewerIdentityShadowLog()).resolves.toBe(0);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('rethrows other SQL errors for cron failure accounting', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    sql.mockRejectedValueOnce(new Error('connection terminated'));

    await expect(MaintenanceService.cleanupReviewerIdentityShadowLog())
      .rejects.toThrow('connection terminated');
  });
});

describe('getRetentionConfig — reviewer_identity_shadow_log_days', () => {
  it('defaults to 90 days', async () => {
    listSettings.mockResolvedValueOnce({});
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.reviewer_identity_shadow_log_days).toBe(90);
  });

  it('accepts a positive Dataverse override and rejects zero', async () => {
    listSettings.mockResolvedValueOnce({
      'retention:reviewer_identity_shadow_log_days': '30',
    });
    await expect(MaintenanceService.getRetentionConfig())
      .resolves.toMatchObject({ reviewer_identity_shadow_log_days: 30 });

    listSettings.mockResolvedValueOnce({
      'retention:reviewer_identity_shadow_log_days': '0',
    });
    await expect(MaintenanceService.getRetentionConfig())
      .resolves.toMatchObject({ reviewer_identity_shadow_log_days: 90 });
  });
});
