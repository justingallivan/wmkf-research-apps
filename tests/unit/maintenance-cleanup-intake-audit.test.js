/**
 * Tests for MaintenanceService.cleanupIntakeAudit + getRetentionConfig's
 * intake_audit_days default + Dataverse override path (S187 #11).
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

describe('cleanupIntakeAudit', () => {
  it('issues DELETE with MAKE_INTERVAL parametrized on retentionDays', async () => {
    sql.mockResolvedValueOnce({ rowCount: 42 });
    const deleted = await MaintenanceService.cleanupIntakeAudit(730);
    expect(deleted).toBe(42);
    expect(sql).toHaveBeenCalledTimes(1);
    const [stringsArr, ...values] = sql.mock.calls[0];
    const template = Array.isArray(stringsArr) ? stringsArr.join('?') : '';
    expect(template).toMatch(/DELETE FROM intake_audit/i);
    expect(template).toMatch(/created_at\s*<\s*NOW\(\)\s*-\s*MAKE_INTERVAL\(days\s*=>\s*\?\)/i);
    expect(values).toContain(730);
  });

  it('returns 0 when rowCount is missing/null', async () => {
    sql.mockResolvedValueOnce({ rowCount: null });
    expect(await MaintenanceService.cleanupIntakeAudit(730)).toBe(0);
  });

  it('re-throws on SQL error so the cron try/catch records failure', async () => {
    sql.mockRejectedValueOnce(new Error('connection terminated'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(MaintenanceService.cleanupIntakeAudit(730)).rejects.toThrow('connection terminated');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('default arity uses 730 days when called with no args', async () => {
    sql.mockResolvedValueOnce({ rowCount: 0 });
    await MaintenanceService.cleanupIntakeAudit();
    const [, ...values] = sql.mock.calls[0];
    expect(values).toContain(730);
  });
});

describe('getRetentionConfig — intake_audit_days', () => {
  it('default is 730 when no Dataverse override exists', async () => {
    listSettings.mockResolvedValueOnce({}); // no overrides at all
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.intake_audit_days).toBe(730);
  });

  it('Dataverse override at retention:intake_audit_days replaces the default', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:intake_audit_days': '365' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.intake_audit_days).toBe(365);
  });

  it('non-numeric Dataverse override is ignored — default 730 preserved', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:intake_audit_days': 'not-a-number' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.intake_audit_days).toBe(730);
  });

  it('zero override is rejected — preserves default 730 (Codex post-impl hardening)', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:intake_audit_days': '0' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.intake_audit_days).toBe(730);
  });

  it('negative override is rejected — preserves default 730', async () => {
    listSettings.mockResolvedValueOnce({ 'retention:intake_audit_days': '-30' });
    const config = await MaintenanceService.getRetentionConfig();
    expect(config.intake_audit_days).toBe(730);
  });

  it('listSettings failure falls through to defaults (intake_audit_days=730)', async () => {
    listSettings.mockRejectedValueOnce(new Error('dataverse outage'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const config = await MaintenanceService.getRetentionConfig();
      expect(config.intake_audit_days).toBe(730);
    } finally {
      errSpy.mockRestore();
    }
  });
});
