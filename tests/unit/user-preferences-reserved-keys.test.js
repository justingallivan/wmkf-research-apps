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
    getReviewerEmailTemplatesStrict: jest.fn(async () => null),
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
const MATERIALS_KEYS = [
  PREFERENCE_KEYS.SITE_VISIT_MATERIALS_INVITATION_TEMPLATE,
  PREFERENCE_KEYS.SITE_VISIT_MATERIALS_REMINDER_TEMPLATE,
];
const REMINDER_KEYS = [
  PREFERENCE_KEYS.SCHEDULED_GRANTEE_REMINDER_TEMPLATE,
  PREFERENCE_KEYS.REVIEWER_RESPOND_REMINDER_TEMPLATE,
  PREFERENCE_KEYS.REVIEWER_REVIEW_DUE_REMINDER_TEMPLATE,
  // Release courtesy copy shares the same private, dedicated-route contract.
  PREFERENCE_KEYS.REVIEWER_WITHDRAW_TEMPLATE,
  PREFERENCE_KEYS.REVIEWER_RELEASE_TEMPLATE,
  PREFERENCE_KEYS.REVIEWER_DEADLINE_UPDATE_TEMPLATE,
  PREFERENCE_KEYS.DELIBERATION_SHARE_TEMPLATE, PREFERENCE_KEYS.MEETING_AGENDA_TEMPLATE,
];

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

  it.each(MATERIALS_KEYS)('blocks single materials key %s through generic POST', async (reservedKey) => {
    const res = mockRes();
    await handler({ method: 'POST', body: { key: reservedKey, value: '{}' } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  });

  it('blocks a bulk POST containing either materials key', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { preferences: { safe: '1', [MATERIALS_KEYS[1]]: '{}' } } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreferences).not.toHaveBeenCalled();
  });

  it.each(MATERIALS_KEYS)('blocks single materials key %s through generic DELETE', async (reservedKey) => {
    const res = mockRes();
    await handler({ method: 'DELETE', body: { key: reservedKey } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });

  it('blocks a bulk DELETE containing either materials key', async () => {
    const res = mockRes();
    await handler({ method: 'DELETE', body: { keys: ['safe', MATERIALS_KEYS[0]] } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });

  it.each(REMINDER_KEYS)('blocks reviewer reminder key %s through generic POST and DELETE', async (reservedKey) => {
    const post = mockRes();
    await handler({ method: 'POST', body: { key: reservedKey, value: '{}' } }, post);
    expect(post.statusCode).toBe(403);
    const del = mockRes();
    await handler({ method: 'DELETE', body: { key: reservedKey } }, del);
    expect(del.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
    expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });

  it('blocks reviewer reminder keys in bulk generic writes and deletes', async () => {
    const post = mockRes();
    await handler({ method: 'POST', body: { preferences: { safe: '1', [REMINDER_KEYS[0]]: '{}' } } }, post);
    expect(post.statusCode).toBe(403);
    const del = mockRes();
    await handler({ method: 'DELETE', body: { keys: ['safe', REMINDER_KEYS[1]] } }, del);
    expect(del.statusCode).toBe(403);
    expect(DatabaseService.setUserPreferences).not.toHaveBeenCalled();
    expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });

  it.each(REMINDER_KEYS)('blocks generic reads of personal reminder key %s', async (reservedKey) => {
    const res = mockRes();
    await handler({ method: 'GET', query: { key: reservedKey } }, res);
    expect(res.statusCode).toBe(403);
    expect(DatabaseService.getUserPreferences).not.toHaveBeenCalled();
  });

  it('omits personal reminder keys from the generic bulk read', async () => {
    DatabaseService.getUserPreferences.mockResolvedValueOnce({ safe: 'visible', [REMINDER_KEYS[0]]: 'private A', [REMINDER_KEYS[1]]: 'private B' });
    const res = mockRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.preferences).toEqual({ safe: 'visible' });
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


test('legacy template GET uses a strict own read and preserves absence', async () => {
  const res = mockRes(); await handler({ method: 'GET', query: { key: EMAIL_TEMPLATES } }, res);
  expect(res.statusCode).toBe(200); expect(res.body.value).toBeNull();
  expect(DatabaseService.getReviewerEmailTemplatesStrict).toHaveBeenCalledWith(1);
  expect(DatabaseService.getUserPreferences).not.toHaveBeenCalled();
});
test.each([['preference_invalid', 409], ['preference_unavailable', 503]])('strict %s is not serialized as empty settings', async (code, status) => {
  DatabaseService.getReviewerEmailTemplatesStrict.mockRejectedValueOnce(Object.assign(new Error('failed'), { code }));
  const res = mockRes(); await handler({ method: 'GET', query: { key: EMAIL_TEMPLATES } }, res);
  expect(res.statusCode).toBe(status); expect(res.body).not.toHaveProperty('value');
});

describe('scheduled reminder key casing aliases', () => {
  const alias = PREFERENCE_KEYS.SCHEDULED_GRANTEE_REMINDER_TEMPLATE.toUpperCase();
  test('keyed and list GET cannot disclose an actual alias row', async () => {
    DatabaseService.getUserPreferences.mockResolvedValueOnce({ [alias]: 'private copy', safe: 'visible' });
    const list = mockRes(); await handler({ method: 'GET', query: {} }, list);
    expect(list.body.preferences).toEqual({ safe: 'visible' });
    const keyed = mockRes(); await handler({ method: 'GET', query: { key: alias } }, keyed); expect(keyed.statusCode).toBe(403);
  });
  test.each([['POST', { key: alias, value: '{}' }], ['POST', { preferences: { [alias]: '{}' } }], ['DELETE', { key: alias }], ['DELETE', { keys: [alias] }]])('%s refuses alias mutation %p', async (method, body) => {
    const res = mockRes(); await handler({ method, body }, res); expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled(); expect(DatabaseService.setUserPreferences).not.toHaveBeenCalled(); expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });
});

test.each([' scheduled_grantee_reminder_template ', '\tSCHEDULED_GRANTEE_REMINDER_TEMPLATE\n'])('scheduled reminder whitespace/casing alias %p cannot bypass privacy or mutations', async key => {
  DatabaseService.getUserPreferences.mockResolvedValueOnce({ [key]: 'private copy', safe: 'visible' });
  const list = mockRes(); await handler({ method: 'GET', query: {} }, list); expect(list.body.preferences).toEqual({ safe: 'visible' });
  const post = mockRes(); await handler({ method: 'POST', body: { key, value: '{}' } }, post); expect(post.statusCode).toBe(403);
  const del = mockRes(); await handler({ method: 'DELETE', body: { key } }, del); expect(del.statusCode).toBe(403);
});


describe.each(['reviewer_automatic_thankyou_template', 'REVIEWER_AUTOMATIC_THANKYOU_TEMPLATE', ' \tReviewer_Automatic_Thankyou_Template\n'])('automatic thank-you private key %p', key => {
  test('actual list/keyed rows cannot leak', async () => {
    DatabaseService.getUserPreferences.mockResolvedValueOnce({ [key]: 'private copy', safe: 'visible' });
    const list = mockRes(); await handler({ method: 'GET', query: {} }, list); expect(list.body.preferences).toEqual({ safe: 'visible' });
    const keyed = mockRes(); await handler({ method: 'GET', query: { key } }, keyed); expect(keyed.statusCode).toBe(403);
  });
  test.each([['POST', { key, value: '{}' }], ['POST', { preferences: { [key]: '{}' } }], ['DELETE', { key }], ['DELETE', { keys: [key] }]])('refuses %s mutation %p', async (method, body) => {
    const res = mockRes(); await handler({ method, body }, res); expect(res.statusCode).toBe(403);
    expect(DatabaseService.setUserPreference).not.toHaveBeenCalled(); expect(DatabaseService.setUserPreferences).not.toHaveBeenCalled(); expect(DatabaseService.deleteUserPreference).not.toHaveBeenCalled();
  });
});
