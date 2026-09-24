/** @jest-environment node */
import { applicantAttendeeSuggestions, resolveSiteVisitApplicantContacts } from '../../lib/services/site-visit/applicant-contacts';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: null })),
    resolveRequestRecipients: jest.fn(async () => ({ pi: { contactId: CONTACT, name: 'Franklin Cat', email: 'franklin@example.edu' }, liaison: { contactId: null, name: null, email: null } })),
    getAccount: jest.fn(async () => ({ _primarycontactid_value: CONTACT })),
    getContact: jest.fn(async () => ({ contactid: CONTACT, fullname: 'Franklin Cat', emailaddress1: 'franklin@example.edu' })),
    ...overrides,
  };
}

test('a blank request contact uses the applicant organization primary contact; a shared address becomes one calendar attendee', async () => {
  const d = deps();
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(d.getAccount).toHaveBeenCalledWith(ACCOUNT);
  expect(d.getContact).toHaveBeenCalledWith(CONTACT);
  expect(contacts.liaison).toMatchObject({ contactId: CONTACT, name: 'Franklin Cat', email: 'franklin@example.edu' });
  expect(applicantAttendeeSuggestions(contacts)).toEqual([{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }]);
});

test('a set request primary contact wins over a different organization contact', async () => {
  const d = deps({
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: CONTACT })),
    resolveRequestRecipients: jest.fn(async () => ({ pi: { name: 'PI', email: 'pi@example.edu' }, liaison: { contactId: CONTACT, name: 'Request Liaison', email: 'request@example.edu' } })),
  });
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(contacts.liaison.email).toBe('request@example.edu');
  expect(d.getAccount).not.toHaveBeenCalled();
  expect(applicantAttendeeSuggestions(contacts)).toHaveLength(2);
});

test('an email-less request primary contact does not silently use the organization contact', async () => {
  const d = deps({
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: CONTACT })),
    resolveRequestRecipients: jest.fn(async () => ({ pi: { name: 'PI', email: 'pi@example.edu' }, liaison: { contactId: CONTACT, name: 'Request Liaison', email: null } })),
  });
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(contacts.liaison.email).toBeNull();
  expect(d.getAccount).not.toHaveBeenCalled();
});

test('an email-less organization contact remains missing rather than falling back to the PI', async () => {
  const d = deps({ getContact: jest.fn(async () => ({ fullname: 'Franklin Cat', emailaddress1: null })) });
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(contacts.liaison.email).toBeNull();
  expect(applicantAttendeeSuggestions(contacts)).toHaveLength(1);
});

test.each(['getAccount', 'getContact'])('a failed %s read reports an unavailable contact', async (method) => {
  const d = deps({ [method]: jest.fn(async () => { throw new Error('Dataverse read failed'); }) });
  await expect(resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d)).rejects.toMatchObject({
    httpStatus: 503,
    code: 'site_visit_primary_contact_unavailable',
  });
});
