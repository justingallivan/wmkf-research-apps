/**
 * @jest-environment node
 */
/**
 * /api/user-preferences must REJECT writes/deletes of reserved keys (S222 Codex
 * post-impl P1) — the reviewer-finder PROMPT_OVERRIDES key has a dedicated,
 * grant-gated write path, so the generic (auth-only) endpoint must block it.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAuthWithProfile: jest.fn(async () => 1),
}));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    setUserPreference: jest.fn(async () => true),
    setUserPreferences: jest.fn(async () => true),
    deleteUserPreference: jest.fn(async () => true),
    getUserPreferences: jest.fn(async () => ({})),
    ENCRYPTED_PREFERENCE_KEYS: [],
  },
}));

import handler from '../../pages/api/user-preferences';
import { DatabaseService } from '../../lib/services/database-service';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';

const RESERVED = PREFERENCE_KEYS.PROMPT_OVERRIDES;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  DatabaseService.setUserPreference.mockClear();
  DatabaseService.setUserPreferences.mockClear();
  DatabaseService.deleteUserPreference.mockClear();
});

describe('reserved-key guard', () => {
  it('POST single reserved key → 403, no write', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { key: RESERVED, value: 'x' } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  });

  it('POST preferences object containing the reserved key → 403, no write', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { preferences: { some_other: '1', [RESERVED]: 'x' } } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreferences).not.toHaveBeenCalled();
  });

  it('DELETE reserved key → 403, no delete', async () => {
    const res = mockRes();
    await handler({ method: 'DELETE', body: { key: RESERVED } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });

  it('POST a normal key still works (not over-blocking)', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { key: 'reviewer_finder_sender_info', value: 'x' } }, res);
    expect(res.statusCode).toBe(200);
    expect(DatabaseService.setUserPreference).toHaveBeenCalled();
  });
});
