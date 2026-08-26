/**
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

test('scheduled-email cleanup deletes only finalized sends and explicit stops', async () => {
  sql.mockResolvedValueOnce({ rowCount: 5 });
  await expect(MaintenanceService.cleanupScheduledEmailMessages(365)).resolves.toBe(5);

  const [strings, ...values] = sql.mock.calls[0];
  const query = strings.join('?');
  expect(query).toMatch(/DELETE FROM scheduled_email_messages/i);
  expect(query).toMatch(/status = 'sent'\s+AND finalized_at IS NOT NULL/i);
  expect(query).toMatch(/status = 'stopped'\s+AND stopped_at IS NOT NULL/i);
  expect(query).not.toMatch(/status = 'failed'/i);
  expect(values).toEqual([365, 365]);
});

test('scheduled-email retention defaults to 365 days and accepts a positive override', async () => {
  listSettings.mockResolvedValueOnce({});
  await expect(MaintenanceService.getRetentionConfig())
    .resolves.toEqual(expect.objectContaining({ scheduled_email_messages_days: 365 }));

  listSettings.mockResolvedValueOnce({ 'retention:scheduled_email_messages_days': '180' });
  await expect(MaintenanceService.getRetentionConfig())
    .resolves.toEqual(expect.objectContaining({ scheduled_email_messages_days: 180 }));
});
