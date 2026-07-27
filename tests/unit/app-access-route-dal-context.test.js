/**
 * @jest-environment node
 *
 * Q9 Stage 1d: /api/app-access dispatch runs inside DAL context after auth
 * and role checks, covering admin reads and grant/revoke writes.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAuthWithProfile: jest.fn(async () => 7),
  isAuthRequired: jest.fn(() => true),
  clearAppAccessCache: jest.fn(),
  getUserRole: jest.fn(async () => 'superuser'),
}));
jest.mock('../../lib/services/app-access-service', () => ({
  listAppKeysForUser: jest.fn(),
  listAllGrantsForAdmin: jest.fn(),
  grantApps: jest.fn(),
  revokeApps: jest.fn(),
}));

import handler from '../../pages/api/app-access';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context';
import { getUserRole } from '../../lib/utils/auth';
import {
  grantApps,
  listAppKeysForUser,
  listAllGrantsForAdmin,
  revokeApps,
} from '../../lib/services/app-access-service';
import { assertDataverseAccess } from '../../lib/services/dynamics-context';

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
  getUserRole.mockResolvedValue('superuser');
  process.env.DATAVERSE_DAL_UNIVERSAL = 'on';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.DATAVERSE_DAL_UNIVERSAL;
});

test('admin grant read executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  listAllGrantsForAdmin.mockImplementation(async () => {
    assertDataverseAccess('app-access:read');
    seen.inside = hasTrustedDalContext();
    return [];
  });

  const res = mockRes();
  await handler({ method: 'GET', query: { all: 'true' }, body: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(listAllGrantsForAdmin).toHaveBeenCalledWith({ throwOnError: true });
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('ordinary-user display read executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  getUserRole.mockResolvedValue('user');
  listAppKeysForUser.mockImplementation(async () => {
    assertDataverseAccess('app-access:read');
    seen.inside = hasTrustedDalContext();
    return ['dynamics-explorer'];
  });

  const res = mockRes();
  await handler({ method: 'GET', query: {}, body: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    apps: ['dynamics-explorer'],
    isSuperuser: false,
  });
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('grant write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  grantApps.mockImplementation(async () => {
    assertDataverseAccess('app-access:write');
    seen.inside = hasTrustedDalContext();
    return { granted: ['dynamics-explorer'] };
  });

  const res = mockRes();
  await handler({
    method: 'POST',
    query: {},
    body: { userProfileId: 8, apps: ['dynamics-explorer'] },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, granted: ['dynamics-explorer'] });
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('revoke write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  revokeApps.mockImplementation(async () => {
    assertDataverseAccess('app-access:write');
    seen.inside = hasTrustedDalContext();
    return { revoked: ['dynamics-explorer'] };
  });

  const res = mockRes();
  await handler({
    method: 'DELETE',
    query: {},
    body: { userProfileId: 8, apps: ['dynamics-explorer'] },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, revoked: ['dynamics-explorer'] });
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('admin grant failure is fail-loud and reports only completed grants', async () => {
  grantApps.mockResolvedValue({
    granted: ['dynamics-explorer'],
    error: 'Dataverse write failed',
  });

  const res = mockRes();
  await handler({
    method: 'POST',
    query: {},
    body: {
      userProfileId: 8,
      apps: ['dynamics-explorer', 'literature-analyzer'],
    },
  }, res);

  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({
    error: 'Unable to grant all requested app access',
    granted: ['dynamics-explorer'],
  });
});

test('admin revoke failure is fail-loud and reports only completed revocations', async () => {
  revokeApps.mockResolvedValue({
    revoked: ['dynamics-explorer'],
    error: 'Dataverse delete failed',
  });

  const res = mockRes();
  await handler({
    method: 'DELETE',
    query: {},
    body: {
      userProfileId: 8,
      apps: ['dynamics-explorer', 'literature-analyzer'],
    },
  }, res);

  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({
    error: 'Unable to revoke all requested app access',
    revoked: ['dynamics-explorer'],
  });
});

test('admin grant-list failure is fail-loud instead of looking like zero grants', async () => {
  listAllGrantsForAdmin.mockRejectedValue(new Error('Dataverse read failed'));

  const res = mockRes();
  await handler({ method: 'GET', query: { all: 'true' }, body: {} }, res);

  expect(res.statusCode).toBe(502);
  expect(res.body).toEqual({
    error: 'Unable to load app access grants',
  });
});
