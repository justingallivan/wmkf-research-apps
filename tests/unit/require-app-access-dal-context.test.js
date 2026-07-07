/**
 * @jest-environment node
 *
 * Q9 Stage 1a: requireAppAccess must establish DAL context around the
 * app-access lookup. This is the auth hot path that will read through
 * DynamicsService after the app-access transport swap.
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth', () => jest.fn(() => ({})));
jest.mock('next-auth/providers/azure-ad', () => jest.fn(() => ({})));
jest.mock('../../lib/services/notification-service', () => ({ notifyNewUser: jest.fn() }));
jest.mock('../../lib/services/dynamics-identity-service', () => ({ reconcileProfile: jest.fn() }));
jest.mock('../../lib/services/app-access-service', () => ({
  listAppKeysForUser: jest.fn(),
  grantApps: jest.fn(),
}));

import { sql } from '@vercel/postgres';
import { getServerSession } from 'next-auth/next';
import { listAppKeysForUser } from '../../lib/services/app-access-service';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context';
import { clearAppAccessCache, requireAppAccess } from '../../lib/utils/auth';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearAppAccessCache();
  process.env.AUTH_REQUIRED = 'true';
  process.env.AZURE_AD_CLIENT_ID = 'test-client-id';
  process.env.AZURE_AD_CLIENT_SECRET = 'test-client-secret';
  process.env.AZURE_AD_TENANT_ID = 'test-tenant-id';
  getServerSession.mockResolvedValue({ user: { profileId: 42 } });
  sql
    .mockResolvedValueOnce({ rows: [{ is_active: true }] })
    .mockResolvedValueOnce({ rows: [] });
});

afterEach(() => {
  delete process.env.AUTH_REQUIRED;
  delete process.env.AZURE_AD_CLIENT_ID;
  delete process.env.AZURE_AD_CLIENT_SECRET;
  delete process.env.AZURE_AD_TENANT_ID;
});

test('requireAppAccess wraps listAppKeysForUser in trusted DAL context', async () => {
  const seen = { inside: null };
  listAppKeysForUser.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return ['dynamics-explorer'];
  });

  const access = await requireAppAccess(
    { method: 'GET', headers: {} },
    mockRes(),
    'dynamics-explorer',
  );

  expect(access).toMatchObject({ profileId: 42 });
  expect(listAppKeysForUser).toHaveBeenCalledWith(42, { throwOnError: true });
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('requireAppAccess fails closed (503) and does not cache when the grant lookup errors', async () => {
  listAppKeysForUser.mockRejectedValue(new Error('Dataverse 503'));
  const res = mockRes();

  const access = await requireAppAccess(
    { method: 'GET', headers: {} },
    res,
    'dynamics-explorer',
  );

  // Denied via a retryable 503 rather than a cached empty grant set.
  expect(access).toBeNull();
  expect(res.statusCode).toBe(503);

  // The error result must NOT be cached: a recovered next request re-queries
  // and succeeds instead of serving a stale empty set for the full TTL.
  listAppKeysForUser.mockResolvedValue(['dynamics-explorer']);
  sql
    .mockResolvedValueOnce({ rows: [{ is_active: true }] })
    .mockResolvedValueOnce({ rows: [] });
  const retry = await requireAppAccess(
    { method: 'GET', headers: {} },
    mockRes(),
    'dynamics-explorer',
  );
  expect(retry).toMatchObject({ profileId: 42 });
  expect(listAppKeysForUser).toHaveBeenCalledTimes(2);
});
