/**
 * Tests for pages/api/auth/link-profile.js — live revocation checks and the
 * transactional identity-transfer contract.
 *
 * The discriminating cases exercise the prior race shape: createNew must not
 * delete/reinsert the durable caller row, and a failed target claim after the
 * temporary-row DELETE must ROLLBACK rather than commit a rowless identity.
 */

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock('@vercel/postgres', () => ({
  db: { connect: (...args) => mockConnect(...args) },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

import { getServerSession } from 'next-auth';
import handler from '../../pages/api/auth/link-profile';

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function mockReq(body) {
  return { method: 'POST', body };
}

const activeSession = {
  user: {
    needsLinking: true,
    azureId: 'azure-123',
    azureEmail: 'caller@example.com',
    name: 'Caller Name',
  },
};

function queryTextAt(i) {
  return mockQuery.mock.calls[i]?.[0] || '';
}

function writeQueryTexts() {
  return mockQuery.mock.calls
    .map((args) => args[0])
    .filter((text) => /^\s*(DELETE|INSERT|UPDATE)/i.test(text));
}

function expectRollbackAndRelease() {
  expect(mockQuery.mock.calls.some((args) => args[0] === 'ROLLBACK')).toBe(true);
  expect(mockQuery.mock.calls.some((args) => args[0] === 'COMMIT')).toBe(false);
  expect(mockRelease).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('/api/auth/link-profile', () => {
  test('no session -> 401 without opening a transaction', async () => {
    getServerSession.mockResolvedValueOnce(null);
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('needsLinking false -> 403 without opening a transaction', async () => {
    getServerSession.mockResolvedValueOnce({ user: { ...activeSession.user, needsLinking: false } });
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account is already linked' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('claim without profileId -> 400 without opening a transaction', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    const res = mockResponse();
    await handler(mockReq({}), res);
    expect(res.statusCode).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test.each([['disabled', false], ['NULL', null]])(
    '%s caller, createNew -> 403 and zero writes',
    async (_label, isActive) => {
      getServerSession.mockResolvedValueOnce(activeSession);
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, is_active: isActive, needs_linking: true }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = mockResponse();
      await handler(mockReq({ createNew: true }), res);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'Account has been disabled' });
      expect(writeQueryTexts()).toEqual([]);
      expectRollbackAndRelease();
    },
  );

  test('disabled caller, profileId claim -> 403 and zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: false, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(403);
    expect(writeQueryTexts()).toEqual([]);
    expectRollbackAndRelease();
  });

  test.each([['createNew', { createNew: true }], ['claim', { profileId: 42 }]])(
    'missing caller row, %s -> 403 and zero writes',
    async (_label, body) => {
      getServerSession.mockResolvedValueOnce(activeSession);
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const res = mockResponse();
      await handler(mockReq(body), res);
      expect(res.statusCode).toBe(403);
      expect(writeQueryTexts()).toEqual([]);
      expectRollbackAndRelease();
    },
  );

  test('live caller row no longer needs linking -> 403 and zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account is already linked' });
    expect(writeQueryTexts()).toEqual([]);
    expectRollbackAndRelease();
  });

  test('caller verification DB error -> 503, rollback, and release', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Unable to verify account status; please retry' });
    expect(writeQueryTexts()).toEqual([]);
    expectRollbackAndRelease();
  });

  test('rollback failure destroys the pooled connection instead of reusing it', async () => {
    const firstRollbackError = new Error('rollback failed');
    const retryRollbackError = new Error('rollback retry failed');
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: false, needs_linking: true }] })
      .mockRejectedValueOnce(firstRollbackError)
      .mockRejectedValueOnce(retryRollbackError);
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(503);
    expect(mockRelease).toHaveBeenCalledWith(retryRollbackError);
  });

  test('createNew finalizes the locked temp row in place — no DELETE or INSERT', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'caller@example.com', display_name: 'Caller Name' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.profile.id).toBe(1);
    const writes = writeQueryTexts();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^\s*UPDATE/i);
    expect(writes[0]).toMatch(/id\s*=\s*\$4/);
    expect(writes[0]).toMatch(/is_active\s*=\s*true/);
    expect(writes[0]).toMatch(/needs_linking\s*=\s*true/);
    expect(writes[0]).not.toMatch(/DELETE|INSERT/i);
    expect(mockQuery.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('createNew conditional update losing its guard -> 409 and rollback', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ createNew: true }), res);
    expect(res.statusCode).toBe(409);
    expectRollbackAndRelease();
  });

  test('claim locks caller and target, transfers in one transaction, and commits', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, azure_id: null, name: 'Target', display_name: 'Target Display' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, azure_id: 'azure-123', name: 'Target', display_name: 'Target Display' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.profile.azure_id).toBe('azure-123');
    expect(queryTextAt(1)).toMatch(/FOR UPDATE/);
    expect(queryTextAt(2)).toMatch(/FOR UPDATE/);
    expect(queryTextAt(3)).toMatch(/^\s*DELETE/i);
    expect(queryTextAt(4)).toMatch(/^\s*UPDATE/i);
    expect(queryTextAt(5)).toBe('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('target disabled before its row lock -> 404 and caller temp row is not deleted', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(404);
    expect(writeQueryTexts()).toEqual([]);
    expectRollbackAndRelease();
  });

  test('failed target UPDATE after temp DELETE rolls the DELETE back — no COMMIT', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, azure_id: null, name: 'Target', display_name: 'Target' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(409);
    expect(queryTextAt(3)).toMatch(/^\s*DELETE/i);
    expect(queryTextAt(4)).toMatch(/^\s*UPDATE/i);
    expect(queryTextAt(5)).toBe('ROLLBACK');
    expectRollbackAndRelease();
  });

  test('failed temp DELETE aborts before target UPDATE and rolls back', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, azure_id: null, name: 'Target', display_name: 'Target' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(409);
    expect(writeQueryTexts()).toHaveLength(1);
    expect(writeQueryTexts()[0]).toMatch(/^\s*DELETE/i);
    expectRollbackAndRelease();
  });

  test('target already linked to another azure_id -> 400, zero writes, rollback', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true, needs_linking: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, azure_id: 'someone-else', name: 'Target', display_name: 'Target' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();
    await handler(mockReq({ profileId: 42 }), res);
    expect(res.statusCode).toBe(400);
    expect(writeQueryTexts()).toEqual([]);
    expectRollbackAndRelease();
  });
});
