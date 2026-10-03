/**
 * @jest-environment node
 *
 * Real collection and sweep dependencies over mocked adapters. The default
 * Request has a blank program (Request-copy Liaison); the Research block
 * proves recipients and {{liaisonFullName}} both come from the institution
 * (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md readers 4-5).
 */
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/contact', () => ({ getByIdWithSelect: jest.fn(), getInviteRecipientById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/account', () => ({ __esModule: true, queryAccounts: jest.fn(), getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({ getByIdWithSelect: jest.fn(), getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/email-activity', () => ({ create: jest.fn(async () => 'fake-email'), send: jest.fn() }));
jest.mock('../../lib/utils/encryption', () => ({ decrypt: () => 'sample-token', encrypt: (x) => x }));
import * as requestAdapter from '../../lib/dataverse/adapters/grant-request';
import * as contactAdapter from '../../lib/dataverse/adapters/contact';
import * as accountAdapter from '../../lib/dataverse/adapters/account';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';
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
const ACCOUNT = '66666666-6666-4666-8666-666666666666';
const INSTITUTION_LIAISON = '77777777-7777-4777-8777-777777777777';
const request = { akoya_requestid: REQUEST, akoya_requestnum: '123', akoya_title: 'Not in email', _wmkf_projectleader_value: PI, _akoya_primarycontactid_value: LIAISON, _wmkf_programcoordinator_value: COORDINATOR, _akoya_programid_value: null, _akoya_applicantid_value: null };
let currentRequest = request;
const CONTACTS = {
  [PI]: { contactid: PI, fullname: 'Wrong Surname Guess', lastname: 'de la Cruz', emailaddress1: 'pi@example.invalid' },
  [LIAISON]: { contactid: LIAISON, fullname: 'Lee Liaison', emailaddress1: 'liaison@example.invalid' },
  [INSTITUTION_LIAISON]: { contactid: INSTITUTION_LIAISON, fullname: 'Ivy Institution', emailaddress1: 'ivy@example.invalid' },
};
beforeEach(() => {
  jest.clearAllMocks();
  currentRequest = request;
  requestAdapter.getById.mockImplementation(async (_id, { select }) => Object.fromEntries(select.filter(k => k in currentRequest).map(k => [k, currentRequest[k]])));
  contactAdapter.getByIdWithSelect.mockImplementation(async (id) => CONTACTS[id]);
  contactAdapter.getInviteRecipientById.mockImplementation(async (id) => CONTACTS[id]);
  accountAdapter.queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT, _primarycontactid_value: INSTITUTION_LIAISON }], totalCount: 1, hasMore: false });
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
    expect(emailAdapter.create).toHaveBeenCalledWith(expect.objectContaining({
      subject, to: ['pi@example.invalid'], cc: ['liaison@example.invalid'],
      regardingId: REQUEST, regardingType: 'akoya_request',
    }));
    const html = emailAdapter.create.mock.calls[0][0].body;
    expect(html).toContain('Dear Dr. de la Cruz,');
    expect(html).toContain('Assigned Coordinator');
    expect(html).not.toContain('Wrong Actor');
    expect(html).not.toContain('{{');
  }
});

test('the default materials sender refuses to create an activity without a valid Request GUID', async () => {
  await expect(collection.sendEmail({
    regardingId: 'bad-guid', subject: 'Materials', bodyText: 'Upload', from: 'pc@wmkeck.org',
    to: ['pi@example.invalid'], cc: [], url: 'https://apps.test/materials', buttonLabel: 'Upload',
  })).rejects.toMatchObject({ code: 'site_visit_materials_request_invalid' });
  expect(emailAdapter.create).not.toHaveBeenCalled();
});

test('Research: the sweep sends to the institution Liaison and names that same person, never the divergent Request copy', async () => {
  currentRequest = { ...request, _akoya_programid_value: RESEARCH_PROGRAM_IDS[1], _akoya_applicantid_value: ACCOUNT };
  const liaisonTemplate = `${body}\n\nCc: {{liaisonFullName}}`;
  const saved = { pi: { role: 'pi', name: 'Pat de la Cruz', email: 'pi@example.invalid' }, liaison: { role: 'liaison', name: 'Lee Liaison', email: 'liaison@example.invalid' } };
  const row = { id: 'collection', request_id: REQUEST, created_by: ACTOR, due_at: '2030-10-01T16:00:00Z', token_ciphertext: 'sealed', checklist: [{ key: 'participant_bios', label: 'Participant bios', required: true }], contacts: saved };
  const claim = jest.fn(async (_id, _now, _expected, contacts) => ({ ...row, contacts, reminder_count: 1 }));
  const deps = { ...cron, schemaReady: () => true, listDue: async () => [row], findDocumentsByRequest: async () => ({ records: [] }), canReadLink: () => true, getSender: async () => ({ email: 'actor@example.invalid', systemUserId: ACTOR }), findActiveSiteVisit: async () => ({ scheduledstart: '2030-10-03T16:00:00Z' }), readEmailDefaults: async (keys) => ({ ok: true, values: Object.fromEntries(keys.map(k => [k, k.endsWith('.subject') ? subject : liaisonTemplate])) }), claim, attachEmailId: jest.fn(), now: () => new Date('2030-10-02T12:00:00Z') };
  const result = await sweepMaterialsReminders({}, deps);
  expect(result.sent).toBe(1);
  expect(claim).toHaveBeenCalledWith('collection', expect.any(Date), saved, expect.objectContaining({
    liaison: expect.objectContaining({ email: 'ivy@example.invalid' }), liaisonStatus: 'found',
  }));
  expect(emailAdapter.create).toHaveBeenCalledWith(expect.objectContaining({ to: ['pi@example.invalid'], cc: ['ivy@example.invalid'] }));
  const html = emailAdapter.create.mock.calls[0][0].body;
  expect(html).toContain('Ivy Institution');
  expect(html).not.toContain('Lee Liaison');
});
