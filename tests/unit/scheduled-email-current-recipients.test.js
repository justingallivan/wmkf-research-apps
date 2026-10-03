/** @jest-environment node */
// Part B (B1/B4): the default current-recipient reader used before a send.
const mockGetRequest = jest.fn();
const mockGetContact = jest.fn();
const mockResolveLiaison = jest.fn();
const mockPreference = jest.fn();
const mockVip = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: (...a) => mockGetRequest(...a) }));
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({ getByIdWithSelect: (...a) => mockGetContact(...a) }));
jest.mock('../../lib/services/contacts/request-liaison.js', () => ({
  REQUEST_LIAISON_FIELDS: ['_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value'],
  resolveRequestLiaison: (...a) => mockResolveLiaison(...a),
}));
jest.mock('../../lib/services/email-automation-preferences.js', () => ({
  getEmailAutomationPreferenceForSystemUser: (...a) => mockPreference(...a),
}));
jest.mock('../../lib/services/scheduled-email-store.js', () => ({
  SCHEDULED_EMAIL_ERROR_CODES: {},
  filterVipFlaggedContacts: (...a) => mockVip(...a),
}));

const { readCurrentRecipients } = require('../../lib/services/scheduled-email-service');

const PI = '11111111-1111-4111-8111-111111111111';
const LIAISON = '22222222-2222-4222-8222-222222222222';
const PD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const row = { request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', pd_systemuser_id: PD, recipient_contact_ids: [PI, LIAISON] };

beforeEach(() => {
  jest.resetAllMocks();
  mockGetRequest.mockResolvedValue({ _wmkf_projectleader_value: PI, _akoya_programid_value: null, _akoya_applicantid_value: null, _akoya_primarycontactid_value: LIAISON });
  mockResolveLiaison.mockResolvedValue({ status: 'found', contactId: LIAISON });
  mockGetContact.mockResolvedValue({ contactid: LIAISON, emailaddress1: 'liaison@example.edu' });
  mockPreference.mockResolvedValue(null);
  mockVip.mockResolvedValue(new Set());
});

test('reads the request with the Liaison projection, the Liaison contact, review-all and VIP flags for [PI, Liaison]', async () => {
  await expect(readCurrentRecipients(row)).resolves.toEqual({
    piContactId: PI, liaison: { contactId: LIAISON, email: 'liaison@example.edu' }, approvalRequiredNow: false,
  });
  expect(mockGetRequest.mock.calls[0][1].select).toContain('_akoya_applicantid_value');
  expect(mockVip).toHaveBeenCalledWith(PD, [PI, LIAISON]);
});

test('review-all requires approval without consulting VIP flags; a VIP flag also requires it', async () => {
  mockPreference.mockResolvedValueOnce({ reviewAll: true });
  expect((await readCurrentRecipients(row)).approvalRequiredNow).toBe(true);
  expect(mockVip).not.toHaveBeenCalled();
  mockVip.mockResolvedValueOnce(new Set([LIAISON]));
  expect((await readCurrentRecipients(row)).approvalRequiredNow).toBe(true);
});

test('a confirmed none is no Liaison, not a failure', async () => {
  mockResolveLiaison.mockResolvedValue({ status: 'none' });
  await expect(readCurrentRecipients(row)).resolves.toMatchObject({ liaison: null });
  expect(mockGetContact).not.toHaveBeenCalled();
  expect(mockVip).toHaveBeenCalledWith(PD, [PI]);
});

test.each([
  ['request read', () => mockGetRequest.mockRejectedValue(new Error('503'))],
  ['request not returned', () => mockGetRequest.mockResolvedValue(null)],
  ['Liaison resolution', () => mockResolveLiaison.mockRejectedValue(new Error('account read failed'))],
  ['Liaison contact read', () => mockGetContact.mockRejectedValue(new Error('timeout'))],
  ['Liaison without email', () => mockGetContact.mockResolvedValue({ contactid: LIAISON, emailaddress1: null })],
  ['review-all preference', () => mockPreference.mockRejectedValue(new Error('Stored email automation preference is invalid'))],
  ['VIP flags', () => mockVip.mockRejectedValue(new Error('pg down'))],
])('a failed %s is a retryable recipient-read failure, never "no Liaison" or "no approval"', async (_label, arrange) => {
  arrange();
  await expect(readCurrentRecipients(row)).rejects.toMatchObject({ code: 'scheduled_email_recipient_read_failed', retryable: true });
});

test('a row without stored ids falls back to the Project Leader for the VIP check', async () => {
  await readCurrentRecipients({ ...row, recipient_contact_ids: [] });
  expect(mockVip).toHaveBeenCalledWith(PD, [PI, LIAISON]);
});
