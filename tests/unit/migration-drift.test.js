/**
 * Unit tests for lib/utils/migration-drift.js.
 *
 * Covers the S464 drift-direction split: extra-only (tracker ahead of the
 * running build — the normal apply-before-merge window) records a WARNING
 * with its own autoResolveKey and never emails; missing entries stay an
 * ERROR under the original key; a clean pass resolves both keys; and the
 * two keys resolve each other's opposite state so a stale ahead-warning can
 * never dedup-suppress a missing-drift email.
 *
 * @jest-environment node
 */

const sqlMock = jest.fn();
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => sqlMock(strings, ...values),
}));

const notifyMock = jest.fn().mockResolvedValue({ id: 1 });
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: (...args) => notifyMock(...args) },
}));

const autoResolveMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: { autoResolve: (...args) => autoResolveMock(...args) },
}));

const manifest = require('../../lib/db/migrations-manifest.json');
const { detectMigrationDrift } = require('../../lib/utils/migration-drift');

function trackerRows(names) {
  return { rows: names.map((name) => ({ name })) };
}

beforeEach(() => {
  sqlMock.mockReset();
  notifyMock.mockClear();
  autoResolveMock.mockClear();
});

test('clean pass resolves both drift keys and does not notify', async () => {
  sqlMock.mockResolvedValue(trackerRows(manifest.files));

  await detectMigrationDrift();

  expect(notifyMock).not.toHaveBeenCalled();
  const resolvedKeys = autoResolveMock.mock.calls.map(([key]) => key);
  expect(resolvedKeys).toEqual(
    expect.arrayContaining(['migration-tracker-missing', 'migration-drift', 'migration-drift-ahead']),
  );
});

test('extra-only drift notifies at warning severity under the ahead key and resolves the error key', async () => {
  sqlMock.mockResolvedValue(trackerRows([...manifest.files, '999_future_applied_first.sql']));

  await detectMigrationDrift();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  const notification = notifyMock.mock.calls[0][0];
  expect(notification.severity).toBe('warning');
  expect(notification.type).toBe('migration_drift_ahead');
  expect(notification.autoResolveKey).toBe('migration-drift-ahead');
  expect(notification.metadata.extra).toEqual(['999_future_applied_first.sql']);
  expect(notification.metadata.missing).toEqual([]);
  const resolvedKeys = autoResolveMock.mock.calls.map(([key]) => key);
  expect(resolvedKeys).toContain('migration-drift');
  expect(resolvedKeys).not.toContain('migration-drift-ahead');
});

test('missing drift stays an error under the original key and resolves the ahead key', async () => {
  sqlMock.mockResolvedValue(trackerRows(manifest.files.slice(0, -1)));

  await detectMigrationDrift();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  const notification = notifyMock.mock.calls[0][0];
  expect(notification.severity).toBe('error');
  expect(notification.type).toBe('migration_drift');
  expect(notification.autoResolveKey).toBe('migration-drift');
  expect(notification.metadata.missing).toEqual([manifest.files[manifest.files.length - 1]]);
  const resolvedKeys = autoResolveMock.mock.calls.map(([key]) => key);
  expect(resolvedKeys).toContain('migration-drift-ahead');
  expect(resolvedKeys).not.toContain('migration-drift');
});

test('mixed missing and extra reports the error path with both lists', async () => {
  sqlMock.mockResolvedValue(
    trackerRows([...manifest.files.slice(0, -1), '999_future_applied_first.sql']),
  );

  await detectMigrationDrift();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  const notification = notifyMock.mock.calls[0][0];
  expect(notification.severity).toBe('error');
  expect(notification.metadata.missing).toEqual([manifest.files[manifest.files.length - 1]]);
  expect(notification.metadata.extra).toEqual(['999_future_applied_first.sql']);
});

test('missing tracker table notifies migration_tracker_missing and never throws', async () => {
  const err = new Error('relation "schema_migrations" does not exist');
  err.code = '42P01';
  sqlMock.mockRejectedValue(err);

  await expect(detectMigrationDrift()).resolves.toBeUndefined();

  expect(notifyMock).toHaveBeenCalledTimes(1);
  expect(notifyMock.mock.calls[0][0].type).toBe('migration_tracker_missing');
  expect(notifyMock.mock.calls[0][0].severity).toBe('error');
});
