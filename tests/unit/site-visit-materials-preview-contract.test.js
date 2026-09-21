/** @jest-environment node */
// Exercise the actual route, service and signed proof together. Only storage,
// identity and transport are replaced; a successful preview has valid inputs.
let mockDeps;
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_label, fn) => fn() }));
jest.mock('../../shared/config/meetingTracker', () => ({ isMeetingTrackerSchemaReady: () => true }));
jest.mock('../../lib/utils/site-visit-materials-readiness', () => ({ isSiteVisitMaterialsSchemaReady: () => true }));
jest.mock('../../lib/services/database-service', () => ({ DatabaseService: { getUserPreferences: jest.fn(async () => ({})), setUserPreference: jest.fn() } }));
jest.mock('../../lib/services/site-visit-materials/collection-service', () => {
  const actual = jest.requireActual('../../lib/services/site-visit-materials/collection-service');
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name,
    typeof value === 'function' && ['previewMaterialsEmail', 'createMaterialsCollection', 'inviteMaterialsContributors', 'remindMaterialsContributors', 'getMaterialsCollection'].includes(name)
      ? (args) => value(args, mockDeps) : value]));
});

import handler from '../../pages/api/meeting-tracker/visits/[requestId]/materials';
import { requireAppAccess } from '../../lib/utils/auth';
import { DatabaseService } from '../../lib/services/database-service';
import { SITE_VISIT_MATERIALS_CHECKLIST } from '../../shared/config/siteVisitMaterials';
import { renderMaterialsEmailHtml } from '../../lib/external/site-visit-materials-email';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const VISIT = '33333333-3333-4333-8333-333333333333';
const COLLECTION = '44444444-4444-4444-8444-444444444444';
const invitation = { subject: 'Hello {{proposalTitle}}', body: 'Hello {{institution}}\n{{checklist}}\n{{uploadLink}}\n{{signature}}' };
const reminder = { subject: 'Reminder {{proposalTitle}}', body: '{{missingItems}}\n{{uploadLink}}\n{{signature}}' };
const session = (profileId = 7, actor = ACTOR, email = 'pc@example.org') => ({ profileId, session: { user: { dynamicsSystemuserId: actor, azureEmail: email } } });
const originalSecret = process.env.EXTERNAL_LINK_SECRET;

function fixture() {
  let row = null;
  const d = {
    schemaReady: () => true,
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, akoya_requestnum: '1003222', akoya_title: 'Study A', wmkf_meetingdate: '2030-12-11', akoya_requeststatus: 100000001, wmkf_triagestatus: 100000000 })),
    findActiveSiteVisit: jest.fn(async () => ({ activityid: VISIT, scheduledstart: '2030-10-07T16:00:00Z', scheduledend: '2030-10-07T19:00:00Z', wmkf_ianatimezone: 'America/Los_Angeles' })),
    resolveRecipients: jest.fn(async () => ({ pi: { name: 'Pat', email: 'pat@example.edu' }, liaison: null })),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    getOpenCollection: jest.fn(async () => row),
    getLatestCollection: jest.fn(async () => row),
    insertCollection: jest.fn(async (x) => { row = { id: x.id, request_id: x.requestId, status: 'open', site_visit_activity_id: x.siteVisitActivityId, due_at: x.dueAt, closes_at: x.closesAt, checklist: x.checklist, contacts: x.contacts, token_ciphertext: x.tokenCiphertext, created_at: new Date(), reminder_count: 0 }; return row; }),
    recordInvitation: jest.fn(async (_id, emailId) => { row = { ...row, invited_at: new Date(), invitation_email_id: emailId }; return row; }),
    claimManualReminder: jest.fn(async () => { row = { ...row, reminder_count: row.reminder_count + 1 }; return row; }),
    attachReminderEmailId: jest.fn(async () => row),
    mint: jest.fn(async () => ({ jwt: 'server-upload-token', jti: 'jti', hash: 'a'.repeat(64) })),
    seal: (token) => token,
    unseal: (token) => token,
    randomUUID: () => COLLECTION,
    now: () => new Date(),
    readEmailDefaults: jest.fn(async (keys) => ({ ok: true, values: Object.fromEntries(keys.map((key) => [key, key.includes('reminder') ? reminder[key.endsWith('.subject') ? 'subject' : 'body'] : invitation[key.endsWith('.subject') ? 'subject' : 'body']])) })),
    resolvePcSignature: jest.fn(async () => 'Duncan'),
    sendEmail: jest.fn(async () => '55555555-5555-4555-8555-555555555555'),
    buildContributorUrl: (token) => `https://example.test/external/materials/${token}`,
  };
  d.setRow = (value) => { row = value; };
  d.getRow = () => row;
  return d;
}

async function post(body) {
  const res = { statusCode: 200, body: null, setHeader: jest.fn() };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  await handler({ method: 'POST', query: { requestId: REQUEST }, body }, res);
  return res;
}
async function preview(action = 'create', emailTemplate = invitation) {
  const result = await post({ action: 'preview', sendAction: action, emailTemplate });
  expect(result.statusCode).toBe(200);
  expect(result.body.proof).toEqual(expect.any(String));
  return result.body;
}
function existingRow() {
  return { id: COLLECTION, request_id: REQUEST, status: 'open', site_visit_activity_id: VISIT, due_at: '2030-10-03T16:00:00Z', closes_at: '2030-10-14T19:00:00Z', checklist: SITE_VISIT_MATERIALS_CHECKLIST.map((x) => ({ ...x, waived: false })), contacts: { pi: { name: 'Pat', email: 'pat@example.edu' } }, token_ciphertext: 'existing-upload-token', created_at: new Date(), reminder_count: 0 };
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXTERNAL_LINK_SECRET = 'test-only-materials-preview-secret-with-32-plus-characters';
  requireAppAccess.mockResolvedValue(session());
  mockDeps = fixture();
});
afterAll(() => { if (originalSecret === undefined) delete process.env.EXTERNAL_LINK_SECRET; else process.env.EXTERNAL_LINK_SECRET = originalSecret; });

test('valid create preview is read-only; explicit send uses reviewed body and authoritative URL', async () => {
  const draft = await preview();
  for (const name of ['insertCollection', 'mint', 'claimManualReminder', 'sendEmail']) expect(mockDeps[name]).not.toHaveBeenCalled();
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
  const sent = await post({ action: 'create', emailTemplate: invitation, proof: draft.proof });
  expect(sent.statusCode).toBe(200);
  expect(sent.body.invitationSent).toBe(true);
  const email = mockDeps.sendEmail.mock.calls[0][0];
  expect(email.to).toEqual(['pat@example.edu']);
  expect(email.subject).toBe(draft.subject);
  expect(email.bodyText).toBe(draft.bodyText.replaceAll('[secure link generated when you send]', email.url));
  expect(email.url).toBe('https://example.test/external/materials/server-upload-token');
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
});

test.each(['recipients', 'visit', 'signature', 'profile', 'actor', 'sender', 'template'])('changed %s invalidates signed create preview before writes', async (change) => {
  const draft = await preview();
  let template = invitation;
  if (change === 'recipients') mockDeps.resolveRecipients.mockResolvedValue({ pi: { email: 'other@example.edu' } });
  if (change === 'visit') mockDeps.findActiveSiteVisit.mockResolvedValue({ activityid: VISIT, scheduledstart: '2030-11-07T16:00:00Z' });
  if (change === 'signature') mockDeps.resolvePcSignature.mockResolvedValue('Other Coordinator');
  if (change === 'profile') requireAppAccess.mockResolvedValue(session(8));
  if (change === 'actor') requireAppAccess.mockResolvedValue(session(7, '66666666-6666-4666-8666-666666666666'));
  if (change === 'sender') requireAppAccess.mockResolvedValue(session(7, ACTOR, 'other@example.org'));
  if (change === 'template') template = { ...invitation, subject: 'Different' };
  const result = await post({ action: 'create', emailTemplate: template, proof: draft.proof });
  expect(result.statusCode).toBe(409);
  expect(mockDeps.insertCollection).not.toHaveBeenCalled();
  expect(mockDeps.mint).not.toHaveBeenCalled();
  expect(mockDeps.sendEmail).not.toHaveBeenCalled();
});

test('reminder carries the reviewed body and valid server-owned CTA URL', async () => {
  mockDeps.setRow(existingRow());
  const draft = await preview('remind', reminder);
  expect(mockDeps.claimManualReminder).not.toHaveBeenCalled();
  const result = await post({ action: 'remind', emailTemplate: reminder, proof: draft.proof });
  expect(result.statusCode).toBe(200);
  const email = mockDeps.sendEmail.mock.calls[0][0];
  expect(email.bodyText).toBe(draft.bodyText);
  expect(email.url).toBe('https://example.test/external/materials/existing-upload-token');
  expect(renderMaterialsEmailHtml(email)).toContain(`href="${email.url}"`);
});

test('an item waived after reminder preview invalidates the proof before claim', async () => {
  mockDeps.setRow(existingRow());
  const draft = await preview('remind', reminder);
  const row = mockDeps.getRow();
  mockDeps.setRow({ ...row, checklist: row.checklist.map((item, index) => ({ ...item, waived: index === 0 })) });
  const result = await post({ action: 'remind', emailTemplate: reminder, proof: draft.proof });
  expect(result.statusCode).toBe(409);
  expect(mockDeps.claimManualReminder).not.toHaveBeenCalled();
  expect(mockDeps.sendEmail).not.toHaveBeenCalled();
});

test('recipient drift between revalidation and create is refused before collection/token creation', async () => {
  const draft = await preview();
  mockDeps.resolveRecipients.mockResolvedValueOnce({ pi: { name: 'Pat', email: 'pat@example.edu' } })
    .mockResolvedValue({ pi: { name: 'Other', email: 'other@example.edu' } });
  const result = await post({ action: 'create', emailTemplate: invitation, proof: draft.proof });
  // A single checked snapshot is also valid; the sent/inserted recipients must
  // then be the reviewed recipients. A second read must fail before insertion.
  if (mockDeps.resolveRecipients.mock.calls.length === 2) {
    expect(result.statusCode).toBe(200);
    expect(mockDeps.sendEmail.mock.calls[0][0].to).toEqual(['pat@example.edu']);
  } else {
    expect(result.statusCode).toBe(409);
    expect(mockDeps.insertCollection).not.toHaveBeenCalled();
    expect(mockDeps.mint).not.toHaveBeenCalled();
    expect(mockDeps.sendEmail).not.toHaveBeenCalled();
  }
});

test('reminder missing subset changing during final preparation is refused before claim', async () => {
  mockDeps.setRow(existingRow());
  const draft = await preview('remind', reminder);
  mockDeps.findDocumentsByRequest.mockResolvedValueOnce({ records: [] }).mockResolvedValue({ records: [{
    wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666', _wmkf_request_value: REQUEST,
    wmkf_artifacttype: 100000003, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000,
    wmkf_sharepointitemid: 'file', wmkf_filename: '1003222 Site Visit Presentation.pdf', modifiedon: '2030-10-02T00:00:00Z',
  }] });
  const result = await post({ action: 'remind', emailTemplate: reminder, proof: draft.proof });
  // One pre-claim snapshot avoids a contradictory second read; if the service
  // rereads, it must reject the changed missing set instead of sending old copy.
  if (mockDeps.claimManualReminder.mock.calls.length) {
    const callsBeforeClaim = mockDeps.findDocumentsByRequest.mock.invocationCallOrder.filter((order) => order < mockDeps.claimManualReminder.mock.invocationCallOrder[0]);
    expect(callsBeforeClaim).toHaveLength(2); // original preview + one send preparation
  } else {
    expect(result.statusCode).toBe(409);
    expect(mockDeps.sendEmail).not.toHaveBeenCalled();
  }
});

test('reviewed invitation needs no default or signature reread after proof verification', async () => {
  const draft = await preview();
  const defaults = mockDeps.readEmailDefaults.getMockImplementation();
  mockDeps.readEmailDefaults.mockImplementationOnce(defaults).mockRejectedValue(new Error('Admin read failed after preparation'));
  mockDeps.resolvePcSignature.mockResolvedValueOnce('Duncan').mockRejectedValue(new Error('Signature read after preparation'));
  const result = await post({ action: 'create', emailTemplate: invitation, proof: draft.proof });
  expect(result.statusCode).toBe(200);
  expect(result.body.invitationSent).toBe(true);
  expect(mockDeps.sendEmail.mock.calls[0][0].bodyText).toContain('Duncan');
});

test('concurrent first-create uniqueness conflict is a 409 without email transport', async () => {
  const draft = await preview();
  mockDeps.insertCollection.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
  const result = await post({ action: 'create', emailTemplate: invitation, proof: draft.proof });
  expect(result.statusCode).toBe(409);
  expect(mockDeps.sendEmail).not.toHaveBeenCalled();
});

test.each(['invite', 'remind'])('%s cannot use a different collection after proof validation', async (action) => {
  mockDeps.setRow(existingRow());
  const template = action === 'remind' ? reminder : invitation;
  const draft = await preview(action, template);
  mockDeps.getOpenCollection.mockResolvedValueOnce(existingRow()).mockResolvedValue({ ...existingRow(), id: '77777777-7777-4777-8777-777777777777', token_ciphertext: 'new-upload-token' });
  const result = await post({ action, emailTemplate: template, proof: draft.proof });
  if (mockDeps.getOpenCollection.mock.calls.length === 2) {
    expect(result.statusCode).toBe(200);
    expect(mockDeps.sendEmail.mock.calls[0][0].url).toContain('existing-upload-token');
  } else {
    expect(result.statusCode).toBe(409);
    expect(mockDeps.claimManualReminder).not.toHaveBeenCalled();
    expect(mockDeps.sendEmail).not.toHaveBeenCalled();
  }
});

test('same raw reusable template resolves different request details on each preview', async () => {
  const first = await preview();
  mockDeps.getRequest.mockResolvedValue({ ...(await mockDeps.getRequest()), akoya_title: 'Study B' });
  const second = await preview();
  expect(first.subject).toBe('Hello Study A');
  expect(second.subject).toBe('Hello Study B');
  expect(invitation.subject).toBe('Hello {{proposalTitle}}');
  expect(DatabaseService.setUserPreference).not.toHaveBeenCalled();
});

test('visit date drift during create preparation cannot persist a window different from reviewed copy', async () => {
  const draft = await preview();
  const currentVisit = await mockDeps.findActiveSiteVisit();
  mockDeps.findActiveSiteVisit.mockClear();
  mockDeps.findActiveSiteVisit.mockResolvedValueOnce(currentVisit).mockResolvedValue({ ...currentVisit, scheduledstart: '2030-11-07T16:00:00Z', scheduledend: '2030-11-07T19:00:00Z' });
  const result = await post({ action: 'create', emailTemplate: invitation, proof: draft.proof });
  if (mockDeps.findActiveSiteVisit.mock.calls.length === 1) {
    expect(result.statusCode).toBe(200);
    expect(new Date(mockDeps.insertCollection.mock.calls[0][0].closesAt).toISOString()).toBe('2030-10-14T19:00:00.000Z');
  } else {
    expect(result.statusCode).toBe(409);
    expect(mockDeps.insertCollection).not.toHaveBeenCalled();
    expect(mockDeps.mint).not.toHaveBeenCalled();
    expect(mockDeps.sendEmail).not.toHaveBeenCalled();
  }
});

test('reminder recipient drift is rejected before consuming the reminder claim', async () => {
  mockDeps.setRow(existingRow());
  const draft = await preview('remind', reminder);
  mockDeps.getOpenCollection.mockResolvedValueOnce(existingRow()).mockResolvedValue({ ...existingRow(), contacts: { pi: { email: 'other@example.edu' } } });
  const result = await post({ action: 'remind', emailTemplate: reminder, proof: draft.proof });
  expect(result.statusCode).toBe(409);
  expect(mockDeps.claimManualReminder).not.toHaveBeenCalled();
  expect(mockDeps.sendEmail).not.toHaveBeenCalled();
});

test.each(['absent', 'identity'])('a %s visit after reminder validation cannot consume a claim', async (change) => {
  mockDeps.setRow(existingRow());
  const draft = await preview('remind', reminder);
  const visit = await mockDeps.findActiveSiteVisit();
  mockDeps.findActiveSiteVisit.mockResolvedValueOnce(visit).mockResolvedValue(change === 'absent' ? null : { ...visit, activityid: '88888888-8888-4888-8888-888888888888' });
  const result = await post({ action: 'remind', emailTemplate: reminder, proof: draft.proof });
  expect(result.statusCode).toBe(409);
  expect(mockDeps.claimManualReminder).not.toHaveBeenCalled();
  expect(mockDeps.sendEmail).not.toHaveBeenCalled();
});
