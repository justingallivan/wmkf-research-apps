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
import {
  grantApps,
  listAllGrantsForAdmin,
  revokeApps,
} from '../../lib/services/app-access-service';

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
});

test('admin grant read executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  listAllGrantsForAdmin.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return [];
  });

  const res = mockRes();
  await handler({ method: 'GET', query: { all: 'true' }, body: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('grant write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  grantApps.mockImplementation(async () => {
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
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('revoke write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  revokeApps.mockImplementation(async () => {
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
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});
