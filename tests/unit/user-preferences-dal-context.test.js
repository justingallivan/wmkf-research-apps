/**
 * @jest-environment node
 *
 * Q9 Stage 1c: /api/user-preferences dispatch runs inside DAL context after
 * authenticated profile resolution, covering both reads and writes.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAuthWithProfile: jest.fn(async () => 7),
}));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    ENCRYPTED_PREFERENCE_KEYS: [],
    getUserPreferences: jest.fn(),
    setUserPreference: jest.fn(),
    setUserPreferences: jest.fn(),
    deleteUserPreference: jest.fn(),
  },
}));

import handler from '../../pages/api/user-preferences';
import { hasTrustedDalContext } from '../../lib/dataverse/core/context';
import { DatabaseService } from '../../lib/services/database-service';

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

test('GET preference read executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  DatabaseService.getUserPreferences.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return {};
  });

  const res = mockRes();
  await handler({ method: 'GET', query: {}, body: {} }, res);

  expect(res.statusCode).toBe(200);
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('POST preference write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  DatabaseService.setUserPreference.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return true;
  });

  const res = mockRes();
  await handler({ method: 'POST', query: {}, body: { key: 'some_key', value: 'v' } }, res);

  expect(res.statusCode).toBe(200);
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});

test('DELETE preference write executes inside trusted DAL context', async () => {
  const seen = { inside: null };
  DatabaseService.deleteUserPreference.mockImplementation(async () => {
    seen.inside = hasTrustedDalContext();
    return true;
  });

  const res = mockRes();
  await handler({ method: 'DELETE', query: {}, body: { key: 'some_key' } }, res);

  expect(res.statusCode).toBe(200);
  expect(seen.inside).toBe(true);
  expect(hasTrustedDalContext()).toBe(false);
});
