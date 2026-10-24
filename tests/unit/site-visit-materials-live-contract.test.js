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
jest.mock('../../lib/services/meeting-coordination/coordinator-access', () => ({ ...jest.requireActual('../../lib/services/meeting-coordination/coordinator-access'), getAssignedCoordinator: jest.fn() }));
jest.mock('../../lib/services/dataverse-identity-map', () => ({ resolveSystemUserToProfile: jest.fn(async () => 7) }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: { getUserPreferences: jest.fn(async () => ({})) } }));
jest.mock('../../lib/utils/encryption', () => ({ decrypt: () => 'sample-token', encrypt: (x) => x }));
import crypto from 'node:crypto';
import { getAssignedCoordinator } from '../../lib/services/meeting-coordination/coordinator-access';
import { prepareMaterialsReminderEmail, sendReminderEmail } from '../../lib/services/site-visit-materials/collection-service';
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
  getAssignedCoordinator.mockResolvedValue({ systemUserId: COORDINATOR, profileId: 7, name: 'Shared Coordinator', email: 'pc@wmkeck.org', revision: 'r1' });
  requestAdapter.getById.mockImplementation(async (_id, { select }) => Object.fromEntries(select.filter(k => k in currentRequest).map(k => [k, currentRequest[k]])));
  contactAdapter.getByIdWithSelect.mockImplementation(async (id) => CONTACTS[id]);
  contactAdapter.getInviteRecipientById.mockImplementation(async (id) => CONTACTS[id]);
  accountAdapter.queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT, _primarycontactid_value: INSTITUTION_LIAISON }], totalCount: 1, hasMore: false });
  userAdapter.getByIdWithSelect.mockImplementation(async (id) => ({ systemuserid: id, fullname: id === COORDINATOR ? 'Assigned Coordinator' : 'Wrong Actor', isdisabled: false, internalemailaddress: 'pc@wmkeck.org' }));
});

test('actual name resolver uses explicit surname and Shared Admin coordinator independently of the request field', async () => {
  const result = await collection.resolveMaterialNames({ request });
  expect(result).toMatchObject({ piLastName: 'de la Cruz', liaisonFullName: 'Lee Liaison', programCoordinatorName: 'Shared Coordinator' });
  expect(contactAdapter.getByIdWithSelect).toHaveBeenCalledWith(PI, expect.arrayContaining(['lastname', 'emailaddress1']));
  expect(getAssignedCoordinator).toHaveBeenCalled();
});

test('the callable retired sweep refuses before claiming or dispatching even for an enabled creator mailbox', async () => {
  const row = { id: 'collection', request_id: REQUEST, created_by: ACTOR, due_at: '2030-10-01T16:00:00Z', token_ciphertext: 'sealed', checklist: [{ key: 'participant_bios', label: 'Participant bios', required: true }], contacts: { pi: { email: 'pi@example.invalid' }, liaison: { email: 'liaison@example.invalid' } } };
  userAdapter.getById.mockResolvedValue({ internalemailaddress: 'creator@wmkeck.org', isdisabled: false });
  const claim = jest.fn();
  const result = await sweepMaterialsReminders({}, { ...cron, schemaReady: () => true, listDue: async () => [row], findDocumentsByRequest: async () => ({ records: [] }), canReadLink: () => true, claim, now: () => new Date('2030-10-02T12:00:00Z') });
  expect(result.skippedNoSender).toBe(1);
  expect(claim).not.toHaveBeenCalled();
  expect(emailAdapter.create).not.toHaveBeenCalled();
  expect(emailAdapter.send).not.toHaveBeenCalled();
});

test('the default materials sender refuses to create an activity without a valid Request GUID', async () => {
  await expect(collection.sendEmail({
    regardingId: 'bad-guid', subject: 'Materials', bodyText: 'Upload', from: 'pc@wmkeck.org',
    to: ['pi@example.invalid'], cc: [], url: 'https://apps.test/materials', buttonLabel: 'Upload',
  })).rejects.toMatchObject({ code: 'site_visit_materials_request_invalid', dispatched: false });
  expect(emailAdapter.create).not.toHaveBeenCalled();
});

test('Research: manual preparation uses the institution Liaison and Shared Admin coordinator; transport disables fallback at both seams', async () => {
  currentRequest = { ...request, _akoya_programid_value: RESEARCH_PROGRAM_IDS[1], _akoya_applicantid_value: ACCOUNT };
  const contacts = await collection.resolveRecipients(REQUEST, currentRequest);
  const row = { id: 'collection', request_id: REQUEST, due_at: '2030-10-01T16:00:00Z', token_ciphertext: 'sealed', contacts };
  const prepared = await prepareMaterialsReminderEmail({ row, request: currentRequest, visit: { scheduledstart: '2030-10-03T16:00:00Z' }, missing: [{ label: 'Participant bios' }], actorId: COORDINATOR, profileId: 7, emailTemplate: { subject, body: `${body}\nCc: {{liaisonFullName}}` } }, { ...collection, readEmailDefaults: async keys => ({ ok: true, values: Object.fromEntries(keys.map(key => [key, key.endsWith('.subject') ? subject : body])) }), resolvePcSignature: async () => 'Shared Coordinator' });
  await sendReminderEmail({ row, prepared, fromEmail: 'pc@wmkeck.org', actorId: COORDINATOR, profileId: 7, sequence: 1 });
  expect(emailAdapter.create).toHaveBeenCalledWith(expect.objectContaining({ to: ['pi@example.invalid'], cc: ['ivy@example.invalid'], regardingId: REQUEST, actingUserSystemId: COORDINATOR, noFallback: true }));
  expect(emailAdapter.send).toHaveBeenCalledWith('fake-email', { actingUserSystemId: COORDINATOR, noFallback: true });
  const html = emailAdapter.create.mock.calls[0][0].body;
  expect(html).toContain('Ivy Institution');
  expect(html).toContain('Shared Coordinator');
  expect(html).not.toContain('Lee Liaison');
});

test('assignment changes after email creation prevent the final SendEmail call', async () => {
  const coordinator = await getAssignedCoordinator();
  getAssignedCoordinator.mockResolvedValueOnce(coordinator).mockResolvedValueOnce({ ...coordinator, revision: 'r2' });
  await expect(collection.sendEmail({ regardingId: REQUEST, subject: 'Materials', bodyText: 'Upload', from: coordinator.email, to: ['pi@example.invalid'], cc: [], actingUserSystemId: COORDINATOR, profileId: 7, coordinatorSnapshot: coordinator })).rejects.toMatchObject({ code: 'site_visit_materials_preview_stale', emailId: 'fake-email' });
  expect(emailAdapter.create).toHaveBeenCalledTimes(1);
  expect(emailAdapter.send).not.toHaveBeenCalled();
});


test('a changed signature after activity creation leaves the draft unsent', async () => {
  const coordinator = await getAssignedCoordinator();
  const signature = await collection.resolvePcSignature(COORDINATOR);
  const snapshot = { ...coordinator, signatureFingerprint: crypto.createHash('sha256').update(signature).digest('hex') };
  emailAdapter.create.mockImplementationOnce(async () => {
    userAdapter.getByIdWithSelect.mockResolvedValue({ fullname: 'New Signature', isdisabled: false, internalemailaddress: 'pc@wmkeck.org' });
    return 'draft-email';
  });
  await expect(collection.sendEmail({ regardingId: REQUEST, subject: 'Materials', bodyText: 'Upload', from: coordinator.email, to: ['pi@example.invalid'], cc: [], actingUserSystemId: COORDINATOR, profileId: 7, coordinatorSnapshot: snapshot })).rejects.toMatchObject({ code: 'site_visit_materials_preview_stale', emailId: 'draft-email', dispatched: false });
  expect(emailAdapter.create).toHaveBeenCalledTimes(1);
  expect(emailAdapter.send).not.toHaveBeenCalled();
});
