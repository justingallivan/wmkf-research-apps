/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const MaintenanceService = require('../../lib/services/maintenance-service');

beforeEach(() => {
  sql.mockReset();
});

test('deletes request lifecycle rows by started_at and configured retention', async () => {
  sql.mockResolvedValueOnce({ rowCount: 6 });

  await expect(MaintenanceService.cleanupDynamicsExplorerRequests(365)).resolves.toBe(6);

  const [strings, ...values] = sql.mock.calls[0];
  expect(strings.join('?')).toMatch(/DELETE FROM dynamics_explorer_requests/i);
  expect(strings.join('?')).toMatch(/started_at\s*<\s*NOW\(\)/i);
  expect(values).toContain(365);
});

test('treats a pre-migration missing table as a zero-row cleanup', async () => {
  sql.mockRejectedValueOnce(Object.assign(new Error('missing relation'), { code: '42P01' }));

  await expect(MaintenanceService.cleanupDynamicsExplorerRequests(365)).resolves.toBe(0);
});

test('rethrows other cleanup failures', async () => {
  sql.mockRejectedValueOnce(new Error('connection terminated'));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(MaintenanceService.cleanupDynamicsExplorerRequests(365))
    .rejects.toThrow('connection terminated');

  errorSpy.mockRestore();
});
