/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireSuperuser: jest.fn(async () => ({ profileId: 42 })),
  requireAuthWithProfile: jest.fn(async () => 7),
}));

jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(),
  setSetting: jest.fn(),
}));

import adminHandler from '../../pages/api/admin/email-defaults';
import granteeInviteHandler from '../../pages/api/email-defaults/grantee-invite';
import { EDITABLE_TEXT_DEFAULTS } from '../../shared/config/editableTextDefaults';
import { requireAuthWithProfile, requireSuperuser } from '../../lib/utils/auth';
import { getSettingStrict, setSetting } from '../../lib/services/settings-service';

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

const subjectKey = 'email.grantee_invite.subject';
const bodyKey = 'email.grantee_invite.body';

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 42 });
  requireAuthWithProfile.mockResolvedValue(7);
  setSetting.mockResolvedValue(true);
});

describe('/api/admin/email-defaults', () => {
  test('GET returns catalog metadata, values, and per-entry unavailable state', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === subjectKey) return { found: true, value: 'Stored subject' };
      if (key === bodyKey) return { found: false, value: null };
      return { found: false, value: null };
    });

    const r = res();
    await adminHandler({ method: 'GET' }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body.defaults).toHaveLength(EDITABLE_TEXT_DEFAULTS.length);
    const byKey = Object.fromEntries(r.body.defaults.map((entry) => [entry.key, entry]));
    expect(byKey[subjectKey]).toMatchObject({
      key: subjectKey,
      label: expect.any(String),
      description: expect.any(String),
      multiline: false,
      placeholders: ['[title]'],
      value: 'Stored subject',
      unavailable: false,
    });
    expect(byKey[bodyKey]).toMatchObject({
      key: bodyKey,
      multiline: true,
      placeholders: ['[Name]', '[title]', 'COB [date]'],
      value: '',
      unavailable: false,
    });
  });

  test('GET marks only the failed strict read unavailable', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === subjectKey) throw new Error('Dynamics 503');
      return { found: true, value: 'Body' };
    });

    const r = res();
    await adminHandler({ method: 'GET' }, r);

    expect(r.statusCode).toBe(200);
    const byKey = Object.fromEntries(r.body.defaults.map((entry) => [entry.key, entry]));
    expect(byKey[subjectKey]).toMatchObject({ value: '', unavailable: true });
    expect(byKey[bodyKey]).toMatchObject({ value: 'Body', unavailable: false });
  });

  test('PUT rejects unknown keys', async () => {
    const r = res();
    await adminHandler({ method: 'PUT', body: { key: 'email.unknown', value: '' } }, r);

    expect(r.statusCode).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test('PUT allows an empty string for known keys', async () => {
    const r = res();
    await adminHandler({ method: 'PUT', body: { key: subjectKey, value: '' } }, r);

    expect(r.statusCode).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(subjectKey, '', 42);
    expect(r.body).toEqual({ key: subjectKey, value: '' });
  });

  test('requires the superuser gate', async () => {
    requireSuperuser.mockResolvedValueOnce(null);

    const r = res();
    await adminHandler({ method: 'GET' }, r);

    expect(getSettingStrict).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('/api/email-defaults/grantee-invite', () => {
  test('GET returns subject, body, configured, and unavailable=false when both values are non-empty', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === subjectKey) return { found: true, value: 'Stored subject' };
      if (key === bodyKey) return { found: true, value: 'Stored body' };
      return { found: false, value: null };
    });

    const r = res();
    await granteeInviteHandler({ method: 'GET' }, r);

    expect(requireAuthWithProfile).toHaveBeenCalled();
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      subject: 'Stored subject',
      body: 'Stored body',
      configured: true,
      unavailable: false,
    });
  });

  test('GET distinguishes confirmed blank from unavailable strict reads', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === subjectKey) throw new Error('Dynamics 503');
      if (key === bodyKey) return { found: true, value: 'Stored body' };
      throw new Error(`unexpected key ${key}`);
    });

    const r = res();
    await granteeInviteHandler({ method: 'GET' }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      subject: '',
      body: 'Stored body',
      configured: false,
      unavailable: true,
    });
  });
});
