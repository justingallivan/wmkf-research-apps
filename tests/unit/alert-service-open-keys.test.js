/**
 * @jest-environment node
 */

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockConnect = jest.fn(async () => mockClient);
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(),
  db: { connect: (...args) => mockConnect(...args) },
}));

const { sql } = require('@vercel/postgres');
const AlertService = require('../../lib/services/alert-service');

beforeEach(() => {
  sql.mockReset();
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockConnect.mockClear();
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

test('createAlert treats acknowledged alerts as open for deduplication', async () => {
  mockClient.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [{ id: 491 }] })
    .mockResolvedValueOnce({});

  await expect(AlertService.createAlert({
    type: 'reviewer_address_repair_requested',
    title: 'Reviewer address repair requested',
    autoResolveKey: 'reviewer-address-repair:key',
  })).resolves.toBeNull();

  expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
  expect(mockClient.query).toHaveBeenNthCalledWith(
    2,
    'SELECT pg_advisory_xact_lock(hashtext($1), 0)',
    ['reviewer-address-repair:key'],
  );
  expect(mockClient.query.mock.calls[2][0]).toContain("status IN ('active', 'acknowledged')");
  expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
  // Stage 3 conversion onto lib/postgres/client's withTransaction/withClient
  // (docs/plans/POSTGRES_ACCESS_LAYER_MIGRATION_PLAN_2026-09-23.md §4 item 1,
  // recorded difference): the success path calls `client.release()` with NO
  // arguments, not `client.release(null)`.
  expect(mockClient.release).toHaveBeenCalledWith();
  expect(sql).not.toHaveBeenCalled();
});

test('createAlert inserts under the same advisory-lock transaction', async () => {
  const created = { id: 492, status: 'active' };
  mockClient.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [created] })
    .mockResolvedValueOnce({});

  await expect(AlertService.createAlert({
    type: 'reviewer_address_repair_requested',
    title: 'Reviewer address repair requested',
    metadata: { requestId: 'request-id' },
    autoResolveKey: 'reviewer-address-repair:key',
  })).resolves.toEqual(created);

  expect(mockClient.query.mock.calls[3][0]).toContain('INSERT INTO system_alerts');
  expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
  // See the no-args note above: withClient's success path releases with no
  // arguments.
  expect(mockClient.release).toHaveBeenCalledWith();
});

test('createAlert discards the pooled client when rollback fails', async () => {
  const originalError = new Error('lock failed');
  const rollbackError = new Error('rollback failed');
  mockClient.query
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(originalError)
    .mockRejectedValueOnce(rollbackError);
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(AlertService.createAlert({
    type: 'reviewer_address_repair_requested',
    title: 'Reviewer address repair requested',
    autoResolveKey: 'reviewer-address-repair:key',
  })).rejects.toBe(originalError);

  expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
  // Stage 3 conversion recorded difference: a ROLLBACK failure no longer
  // masks the original error. lib/postgres/client's withTransaction
  // swallows the rollback failure internally and rethrows the ORIGINAL
  // error, which withClient's catch then releases (destroys) the client
  // with -- so release now sees originalError, never rollbackError.
  expect(mockClient.release).toHaveBeenCalledWith(originalError);
  consoleSpy.mockRestore();
});

test('returns open request-scoped alerts newest first and fails safe on missing scope', async () => {
  sql.mockResolvedValueOnce({
    rows: [{ id: 491, status: 'acknowledged', metadata: { requestId: 'REQUEST-ID' } }],
  });

  await expect(AlertService.getOpenAlertsByTypeAndRequestId(
    'reviewer_address_repair_requested',
    'request-id',
  )).resolves.toEqual([
    { id: 491, status: 'acknowledged', metadata: { requestId: 'REQUEST-ID' } },
  ]);

  const [strings, type, requestId] = sql.mock.calls[0];
  expect(strings.join(' ')).toContain("status IN ('active', 'acknowledged')");
  expect(strings.join(' ')).toContain("LOWER(metadata ->> 'requestId') = LOWER(");
  expect(type).toBe('reviewer_address_repair_requested');
  expect(requestId).toBe('request-id');

  sql.mockClear();
  await expect(AlertService.getOpenAlertsByTypeAndRequestId('', 'request-id')).resolves.toEqual([]);
  await expect(AlertService.getOpenAlertsByTypeAndRequestId('type', '')).resolves.toEqual([]);
  expect(sql).not.toHaveBeenCalled();
});
