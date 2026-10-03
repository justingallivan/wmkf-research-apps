/** @jest-environment node */
/** Manual materials paths resolve recipients before applying the Test Request gate. */

const refusal = Object.assign(new Error('Email is not allowed for this test request.'), {
  httpStatus: 409,
  code: 'test_request_email_denied',
});
const assertRequestEmailAllowed = jest.fn(async () => { throw refusal; });
jest.mock('../../lib/services/test-requests/request-test-state.js', () => ({
  assertRequestEmailAllowed: (...args) => assertRequestEmailAllowed(...args),
}));

import {
  createMaterialsCollection,
  inviteMaterialsContributors,
  remindMaterialsContributors,
  sendReminderEmail,
} from '../../lib/services/site-visit-materials/collection-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const CONTACTS = {
  pi: { name: 'Pat Investigator', email: 'PI@example.edu' },
  liaison: { name: 'Lee Liaison', email: 'liaison@example.edu' },
};
const VISIT = { activityid: '33333333-3333-4333-8333-333333333333', scheduledstart: '2026-10-07T16:00:00Z' };
const ROW = {
  id: 'collection-1', request_id: REQUEST_ID,
  checklist: [{ key: 'presentation_pdf', label: 'Presentation', required: true, waived: false }],
  contacts: CONTACTS, reminder_count: 0,
};

function dependencies() {
  return {
    schemaReady: () => true,
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1003222', akoya_title: 'Proposal', wmkf_meetingdate: '2026-12-11', akoya_requeststatus: 100000001, wmkf_triagestatus: 100000000 })),
    getOpenCollection: jest.fn(async () => ROW),
    findActiveSiteVisit: jest.fn(async () => VISIT),
    resolveRecipients: jest.fn(async () => CONTACTS),
    findDocumentsByRequest: jest.fn(async () => ({ records: [] })),
    updateContacts: jest.fn(),
    mint: jest.fn(),
    insertCollection: jest.fn(),
    claimManualReminder: jest.fn(),
    sendEmail: jest.fn(),
  };
}

beforeEach(() => assertRequestEmailAllowed.mockClear());

test.each([
  ['createMaterialsCollection', createMaterialsCollection],
  ['inviteMaterialsContributors', inviteMaterialsContributors],
  ['remindMaterialsContributors', remindMaterialsContributors],
])('%s checks the current PI and Liaison before side effects', async (name, fn) => {
  const deps = dependencies();
  if (name === 'createMaterialsCollection') deps.getOpenCollection.mockResolvedValue(null);
  await expect(fn({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps)).rejects.toBe(refusal);

  expect(assertRequestEmailAllowed).toHaveBeenCalledWith(REQUEST_ID, {
    recipients: ['PI@example.edu', 'liaison@example.edu'],
  });
  expect(deps.mint).not.toHaveBeenCalled();
  expect(deps.insertCollection).not.toHaveBeenCalled();
  expect(deps.updateContacts).not.toHaveBeenCalled();
  expect(deps.claimManualReminder).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.getRequest).toHaveBeenCalled();
  if (name === 'createMaterialsCollection') expect(deps.findActiveSiteVisit).toHaveBeenCalled();
});


test('sendReminderEmail does not repeat the service-level recipient check', async () => {
  const deps = { sendEmail: jest.fn(async () => 'email-1') };
  await expect(sendReminderEmail({
    row: { id: 7, request_id: REQUEST_ID, contacts: CONTACTS },
    prepared: { subject: 's', bodyText: 'b' },
    fromEmail: 'pd@example.org',
    actorId: ACTOR_ID,
    sequence: 1,
  }, deps)).resolves.toBe('email-1');
  expect(assertRequestEmailAllowed).not.toHaveBeenCalled();
});
