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
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));

import handler from '../../pages/api/user-preferences';
import { DatabaseService } from '../../lib/services/database-service';
import { getSettingStrict } from '../../lib/services/settings-service';
import { PREFERENCE_KEYS } from '../../shared/config/reviewerFinderPreferences';

const RESERVED = PREFERENCE_KEYS.PROMPT_OVERRIDES;
const EMAIL_AUTOMATION_RESERVED = PREFERENCE_KEYS.EMAIL_AUTOMATION;
const EMAIL_TEMPLATES = PREFERENCE_KEYS.EMAIL_TEMPLATES;

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
  getSettingStrict.mockResolvedValue({ found: false, value: null });
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

  it('blocks automatic-email preference writes through the unvalidated generic route', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { key: EMAIL_AUTOMATION_RESERVED, value: '{"mode":"automatic"}' },
    }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  });

  it('rejects an invitation-template save without {{externalLink}} before persistence', async () => {
    const res = mockRes();
    await handler({
      method: 'POST',
      body: {
        key: EMAIL_TEMPLATES,
        value: JSON.stringify({ invitation: { subject: 'Invitation', body: 'Use this hardcoded link.' } }),
      },
    }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invitation templates must include {{externalLink}} in the subject or body.');
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  });

  it('accepts an invitation-template save containing {{externalLink}}', async () => {
    const value = JSON.stringify({
      invitation: { subject: 'Invitation', body: 'Use {{externalLink}} to respond.' },
    });
    const res = mockRes();
    await handler({ method: 'POST', body: { key: EMAIL_TEMPLATES, value } }, res);
    expect(res.statusCode).toBe(200);
    expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(1, EMAIL_TEMPLATES, value);
  });

  it('validates override-only saves against the current admin invitation default', async () => {
    getSettingStrict.mockImplementation(async (key) => ({
      found: true,
      value: key.endsWith('.body') ? 'Use {{externalLink}} to respond.' : 'Invitation',
    }));
    const value = JSON.stringify({ materials: { subject: 'My materials note' } });
    const res = mockRes();
    await handler({ method: 'POST', body: { key: EMAIL_TEMPLATES, value } }, res);
    expect(res.statusCode).toBe(200);
    expect(getSettingStrict).toHaveBeenCalledTimes(2);
    expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(1, EMAIL_TEMPLATES, value);
  });
});
