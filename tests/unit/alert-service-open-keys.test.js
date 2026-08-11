/**
 * @jest-environment node
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

const { sql } = require('@vercel/postgres');
const AlertService = require('../../lib/services/alert-service');

beforeEach(() => {
  sql.mockReset();
});

test('returns non-empty open auto-resolve keys for exactly one alert type', async () => {
  sql.mockResolvedValue({
    rows: [
      { auto_resolve_key: 'reviewer-email-reconcile:one' },
      { auto_resolve_key: null },
      { auto_resolve_key: '' },
      { auto_resolve_key: 'reviewer-email-reconcile:two' },
    ],
  });

  await expect(AlertService.getOpenAutoResolveKeysByType('reviewer_email_reconcile_needs_merge'))
    .resolves.toEqual([
      'reviewer-email-reconcile:one',
      'reviewer-email-reconcile:two',
    ]);

  const [strings, type] = sql.mock.calls[0];
  expect(strings.join(' ')).toContain("status IN ('active', 'acknowledged')");
  expect(type).toBe('reviewer_email_reconcile_needs_merge');
});

test('does not query without an alert type', async () => {
  await expect(AlertService.getOpenAutoResolveKeysByType('')).resolves.toEqual([]);
  expect(sql).not.toHaveBeenCalled();
});

test('preserves Postgres failures so callers can fail safe', async () => {
  const error = new Error('connection unavailable');
  sql.mockRejectedValue(error);
  await expect(AlertService.getOpenAutoResolveKeysByType('reviewer_email_reconcile_needs_merge'))
    .rejects.toBe(error);
});
