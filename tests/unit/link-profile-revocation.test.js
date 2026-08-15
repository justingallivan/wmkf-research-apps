/**
 * Tests for pages/api/auth/link-profile.js — live-active caller guard and
 * TOCTOU write-ordering backstop added against the accepted security audit
 * (docs/audits/claude-auth-side-effect-security-audit-2026-08-15.md §1).
 *
 * Uses sequence-based sql mocks (sql.mockResolvedValueOnce chains) rather
 * than tests/helpers/auth-mock.js's text-matching mock, because these
 * queries contain 'is_active' and would mis-match its preset responses.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
// Decouple from builder A's concurrent edits to [...nextauth].js.
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));

import { sql } from '@vercel/postgres';
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

// Returns the joined query text for a given sql.mock.calls[i] entry.
function queryTextAt(i) {
  const args = sql.mock.calls[i];
  return args[0].join(' ');
}

function writeQueryTexts() {
  return sql.mock.calls
    .map((_, i) => queryTextAt(i))
    .filter((text) => /^\s*(DELETE|INSERT|UPDATE)/i.test(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('/api/auth/link-profile', () => {
  test('no session -> 401 (pin)', async () => {
    getServerSession.mockResolvedValueOnce(null);
    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(401);
    expect(sql).not.toHaveBeenCalled();
  });

  test('needsLinking false -> 403 (pin)', async () => {
    getServerSession.mockResolvedValueOnce({
      user: { ...activeSession.user, needsLinking: false },
    });
    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account is already linked' });
    expect(sql).not.toHaveBeenCalled();
  });

  test('disabled caller, createNew branch -> 403 disabled, zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    // caller live check: row present but is_active = false
    sql.mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });
    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account has been disabled' });
    expect(writeQueryTexts()).toEqual([]);
  });

  test('disabled caller, profileId claim branch -> 403 disabled, zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql.mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });
    const res = mockResponse();

    await handler(mockReq({ profileId: 42 }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account has been disabled' });
    expect(writeQueryTexts()).toEqual([]);
  });

  test('missing caller row (zero rows), createNew branch -> 403, zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql.mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account has been disabled' });
    expect(writeQueryTexts()).toEqual([]);
  });

  test('missing caller row (zero rows), claim branch -> 403, zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql.mockResolvedValueOnce({ rows: [] });
    const res = mockResponse();

    await handler(mockReq({ profileId: 42 }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account has been disabled' });
    expect(writeQueryTexts()).toEqual([]);
  });

  test('caller-check DB error -> 503, zero writes', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Unable to verify account status; please retry' });
    expect(writeQueryTexts()).toEqual([]);
  });

  test('race backstop (claim branch): caller active but UPDATE returns 0 rows -> 409, not success', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] }) // caller live check
      .mockResolvedValueOnce({
        rows: [{ id: 42, azure_id: null, name: 'Target', display_name: 'Target' }],
      }) // existing (target profile) SELECT
      .mockResolvedValueOnce({ rows: [] }) // temp-profile DELETE
      .mockResolvedValueOnce({ rows: [] }); // UPDATE ... RETURNING id -> 0 rows

    const res = mockResponse();

    await handler(mockReq({ profileId: 42 }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Profile could not be linked' });
    expect(res.body.success).toBeUndefined();
  });

  test('non-regression createNew: active caller -> DELETE (is_active=true) + INSERT run, 200 success', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] }) // caller live check
      .mockResolvedValueOnce({ rows: [] }) // temp-profile DELETE
      .mockResolvedValueOnce({
        rows: [{ id: 99, name: 'caller@example.com', display_name: 'Caller Name' }],
      }); // INSERT

    const res = mockResponse();

    await handler(mockReq({ createNew: true }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.profile).toEqual({
      id: 99,
      name: 'caller@example.com',
      display_name: 'Caller Name',
    });

    const writes = writeQueryTexts();
    expect(writes.length).toBe(2);
    expect(writes[0]).toMatch(/DELETE/);
    expect(writes[0]).toMatch(/is_active\s*=\s*true/);
    expect(writes[1]).toMatch(/INSERT/);
  });

  test('non-regression claim: active caller + active email-matched target -> 200 success, UPDATE has is_active = true', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] }) // caller live check
      .mockResolvedValueOnce({
        rows: [{ id: 42, azure_id: null, name: 'Target', display_name: 'Target Display' }],
      }) // existing (target profile) SELECT
      .mockResolvedValueOnce({ rows: [] }) // temp-profile DELETE
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }); // UPDATE ... RETURNING id -> success

    const res = mockResponse();

    await handler(mockReq({ profileId: 42 }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      profile: { id: 42, azure_id: null, name: 'Target', display_name: 'Target Display' },
      message: 'Profile linked successfully',
    });

    const updateText = queryTextAt(3);
    expect(updateText).toMatch(/UPDATE/);
    expect(updateText).toMatch(/is_active\s*=\s*true/);
  });

  test('existing guard intact: target profile already linked to another azure_id -> 400, no UPDATE', async () => {
    getServerSession.mockResolvedValueOnce(activeSession);
    sql
      .mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }] }) // caller live check
      .mockResolvedValueOnce({
        rows: [{ id: 42, azure_id: 'someone-else', name: 'Target', display_name: 'Target' }],
      }); // existing (target profile) SELECT, linked elsewhere

    const res = mockResponse();

    await handler(mockReq({ profileId: 42 }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Profile is already linked to another account' });
    expect(writeQueryTexts()).toEqual([]);
  });
});

// Mutation check performed manually (not committed as a test): the pre-fix
// handler (git show c87e2a34:pages/api/auth/link-profile.js) was swapped in
// temporarily and this suite re-run against it. Result: 9 of 12 tests failed
// (only the pre-existing 401 and needsLinking-403 pins passed, since those
// don't touch the new logic) — including every disabled-caller,
// missing-caller-row, DB-error, and race-backstop case, each of which the
// old code answered with 200/404 and executed the DELETE/INSERT/UPDATE
// writes instead of the required 403/503/409 with zero writes. The fixed
// handler was restored afterward and this suite re-confirmed green.
