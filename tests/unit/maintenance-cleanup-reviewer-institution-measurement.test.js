/** @jest-environment node */

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

beforeEach(() => { sql.mockReset(); listSettings.mockReset(); });

test('retention and row cap both apply, and missing pre-rollout table is harmless', async () => {
  sql.mockResolvedValueOnce({ rowCount: 2 }).mockResolvedValueOnce({ rowCount: 3 });
  await expect(MaintenanceService.cleanupReviewerInstitutionMeasurement(45, 12000)).resolves.toBe(5);
  expect(sql.mock.calls[0][0].join(' ')).toContain('reviewer_institution_measurement_events');
  expect(sql.mock.calls[0].slice(1)).toContain(45);
  expect(sql.mock.calls[1][0].join(' ')).toContain('ORDER BY id DESC');
  expect(sql.mock.calls[1].slice(1)).toContain(12000);

  sql.mockReset();
  const missing = Object.assign(new Error('relation missing'), { code: '42P01' });
  sql.mockRejectedValueOnce(missing);
  await expect(MaintenanceService.cleanupReviewerInstitutionMeasurement()).resolves.toBe(0);
});

test('retention setting defaults to 90 and rejects zero', async () => {
  listSettings.mockResolvedValueOnce({});
  await expect(MaintenanceService.getRetentionConfig()).resolves.toMatchObject({ reviewer_institution_measurement_days: 90 });
  listSettings.mockResolvedValueOnce({ 'retention:reviewer_institution_measurement_days': '0' });
  await expect(MaintenanceService.getRetentionConfig()).resolves.toMatchObject({ reviewer_institution_measurement_days: 90 });
});
