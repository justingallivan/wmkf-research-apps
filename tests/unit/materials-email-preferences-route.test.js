/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, callback) => callback()) }));
jest.mock('../../lib/services/database-service', () => ({
  DatabaseService: {
    getUserPreferences: jest.fn(async () => ({})),
    setUserPreference: jest.fn(async () => true),
    deleteUserPreference: jest.fn(async () => true),
  },
}));
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: jest.fn(async () => ({ ok: true, values: {
    'email.site_visit_materials_invite.subject': 'Materials for {{proposalTitle}}',
    'email.site_visit_materials_invite.body': 'Hello {{institution}}\n{{checklist}}\n{{signature}}',
    'email.site_visit_materials_reminder.subject': 'Reminder {{proposalTitle}}',
    'email.site_visit_materials_reminder.body': 'Please provide {{missingItems}} {{signature}}',
  } })),
}));

import handler from '../../pages/api/meeting-tracker/materials-email-preferences';
import { requireAppAccess } from '../../lib/utils/auth';
import { DatabaseService } from '../../lib/services/database-service';

const SHARED = {
  subject: 'Materials for {{proposalTitle}}',
  body: 'Hello {{institution}}\n{{checklist}}\n{{signature}}',
};

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = jest.fn();
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 17, session: { user: { id: 'actor' } } });
  DatabaseService.getUserPreferences.mockResolvedValue({});
});

test('GET uses the authenticated session profile and layers a validated override', async () => {
  DatabaseService.getUserPreferences.mockResolvedValue({
    site_visit_materials_invitation_template: JSON.stringify({ subject: 'Mine {{proposalTitle}}' }),
  });
  const res = mockRes();
  await handler({ method: 'GET', query: { kind: 'invitation' }, body: undefined }, res);
  expect(res.statusCode).toBe(200);
  expect(DatabaseService.getUserPreferences).toHaveBeenCalledWith(17, false);
  expect(res.body.template).toEqual({ subject: 'Mine {{proposalTitle}}', body: SHARED.body });
});

test('rejects client identity fields and allows saving an unchanged shared template as a clear', async () => {
  const forged = mockRes();
  await handler({ method: 'PUT', body: { kind: 'invitation', profileId: 999, template: SHARED } }, forged);
  expect(forged.statusCode).toBe(400);
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();

  const clear = mockRes();
  await handler({ method: 'PUT', body: { kind: 'invitation', template: SHARED } }, clear);
  expect(clear.statusCode).toBe(200);
  expect(DatabaseService.deleteUserPreference).toHaveBeenCalledWith(17, 'site_visit_materials_invitation_template');
});

test('PUT persists only changed validated raw fields, and DELETE clears the kind', async () => {
  const put = mockRes();
  await handler({ method: 'PUT', body: {
    kind: 'invitation',
    template: { subject: 'Mine {{proposalTitle}}', body: SHARED.body },
  } }, put);
  expect(put.statusCode).toBe(200);
  expect(DatabaseService.setUserPreference).toHaveBeenCalledWith(
    17,
    'site_visit_materials_invitation_template',
    JSON.stringify({ subject: 'Mine {{proposalTitle}}' }),
  );

  const del = mockRes();
  await handler({ method: 'DELETE', body: { kind: 'invitation' } }, del);
  expect(del.statusCode).toBe(200);
  expect(DatabaseService.deleteUserPreference).toHaveBeenCalledWith(17, 'site_visit_materials_invitation_template');
});

test('rejects invalid kind, invalid tokens, and persistence failures without success', async () => {
  const badKind = mockRes();
  await handler({ method: 'GET', query: { kind: 'other' } }, badKind);
  expect(badKind.statusCode).toBe(400);

  const badTemplate = mockRes();
  await handler({ method: 'PUT', body: { kind: 'reminder', template: { subject: 'x', body: '{{unknown}}' } } }, badTemplate);
  expect(badTemplate.statusCode).toBe(400);
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();

  DatabaseService.setUserPreference.mockRejectedValueOnce(new Error('dataverse down'));
  const failure = mockRes();
  await handler({ method: 'PUT', body: { kind: 'invitation', template: { ...SHARED, subject: 'Mine {{proposalTitle}}' } } }, failure);
  expect(failure.statusCode).toBe(500);
  expect(failure.body.error).toBe('Materials email preferences are unavailable.');
});
