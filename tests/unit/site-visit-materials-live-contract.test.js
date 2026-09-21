/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getByIdWithSelect: jest.fn(), getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/email-activity', () => ({ create: jest.fn(async () => 'fake-email'), send: jest.fn() }));
jest.mock('../../lib/utils/encryption', () => ({ decrypt: () => 'sample-token', encrypt: (x) => x }));
import * as requestAdapter from '../../lib/dataverse/adapters/grant-request';
import * as contactAdapter from '../../lib/dataverse/adapters/contact';
import * as userAdapter from '../../lib/dataverse/adapters/system-user';
import * as emailAdapter from '../../lib/dataverse/adapters/email-activity';
import { DEFAULT_DEPENDENCIES as collection } from '../../lib/services/site-visit-materials/collection-service';
import { DEFAULT_DEPENDENCIES as cron, sweepMaterialsReminders } from '../../lib/services/site-visit-materials/reminder-sweep';
import { SITE_VISIT_MATERIALS_REMINDER_SEED_BODY as body, SITE_VISIT_MATERIALS_REMINDER_SEED_SUBJECT as subject } from '../../lib/seed/email-defaults/site-visit-materials';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const PI = '22222222-2222-4222-8222-222222222222';
const LIAISON = '33333333-3333-4333-8333-333333333333';
const COORDINATOR = '44444444-4444-4444-8444-444444444444';
const ACTOR = '55555555-5555-4555-8555-555555555555';
const request = { akoya_requestid: REQUEST, akoya_requestnum: '123', akoya_title: 'Not in email', _wmkf_projectleader_value: PI, _akoya_primarycontactid_value: LIAISON, _wmkf_programcoordinator_value: COORDINATOR };
beforeEach(() => {
  jest.clearAllMocks();
  requestAdapter.getById.mockImplementation(async (_id, { select }) => Object.fromEntries(select.filter(k => k in request).map(k => [k, request[k]])));
  contactAdapter.getByIdWithSelect.mockImplementation(async (id) => id === PI
    ? { contactid: PI, fullname: 'Wrong Surname Guess', lastname: 'de la Cruz', emailaddress1: 'pi@example.invalid' }
    : { contactid: LIAISON, fullname: 'Lee Liaison', emailaddress1: 'liaison@example.invalid' });
  userAdapter.getByIdWithSelect.mockImplementation(async (id) => ({ systemuserid: id, fullname: id === COORDINATOR ? 'Assigned Coordinator' : 'Wrong Actor', isdisabled: false }));
});

test('actual name resolver uses explicit surname and request-assigned system user', async () => {
  const result = await collection.resolveMaterialNames({ request });
  expect(result).toMatchObject({ piLastName: 'de la Cruz', liaisonFullName: 'Lee Liaison', programCoordinatorName: 'Assigned Coordinator' });
  expect(contactAdapter.getByIdWithSelect).toHaveBeenCalledWith(PI, expect.arrayContaining(['lastname', 'emailaddress1']));
  expect(userAdapter.getByIdWithSelect).toHaveBeenCalledWith(COORDINATOR, expect.any(String));
});

test.each([false, true])('real cron projection and preparation resolve names before claim (missing coordinator: %s)', async (missing) => {
  if (missing) userAdapter.getByIdWithSelect.mockResolvedValue({ fullname: '' });
  const row = { id: 'collection', request_id: REQUEST, created_by: ACTOR, due_at: '2030-10-01T16:00:00Z', token_ciphertext: 'sealed', checklist: [{ key: 'participant_bios', label: 'Participant bios', required: true }], contacts: { pi: { name: 'Pat de la Cruz', email: 'pi@example.invalid' }, liaison: { name: 'Lee Liaison', email: 'liaison@example.invalid' } } };
  const claim = jest.fn(async () => ({ ...row, reminder_count: 1 }));
  const deps = { ...cron, schemaReady: () => true, listDue: async () => [row], findDocumentsByRequest: async () => ({ records: [] }), canReadLink: () => true, getSender: async () => ({ email: 'actor@example.invalid', systemUserId: ACTOR }), findActiveSiteVisit: async () => ({ scheduledstart: '2030-10-03T16:00:00Z' }), readEmailDefaults: async (keys) => ({ ok: true, values: Object.fromEntries(keys.map(k => [k, k.endsWith('.subject') ? subject : body])) }), claim, attachEmailId: jest.fn(), now: () => new Date('2030-10-02T12:00:00Z') };
  const result = await sweepMaterialsReminders({}, deps);
  if (missing) {
    expect(result.sent).toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect(emailAdapter.create).not.toHaveBeenCalled();
  } else {
    expect(result.sent).toBe(1);
    expect(emailAdapter.create).toHaveBeenCalledWith(expect.objectContaining({ subject, to: ['pi@example.invalid'], cc: ['liaison@example.invalid'] }));
    const html = emailAdapter.create.mock.calls[0][0].body;
    expect(html).toContain('Dear Dr. de la Cruz,');
    expect(html).toContain('Assigned Coordinator');
    expect(html).not.toContain('Wrong Actor');
    expect(html).not.toContain('{{');
  }
});
