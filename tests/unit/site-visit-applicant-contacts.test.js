/**
 * @jest-environment node
 *
 * Default fixtures are a non-Research program (the Request copy wins, the
 * organization contact is the fallback). Research takes the Liaison of record
 * from the recipients only (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 6).
 */
import { applicantAttendeeSuggestions, resolveSiteVisitApplicantContacts } from '../../lib/services/site-visit/applicant-contacts';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const SOCAL = '44444444-4444-4444-8444-444444444444';

function deps(overrides = {}) {
  return {
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_programid_value: SOCAL, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: null })),
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
  expect(contacts.liaisonStatus).toBe('found');
  expect(applicantAttendeeSuggestions(contacts)).toEqual([{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }]);
});

test('a set request primary contact wins over a different organization contact', async () => {
  const d = deps({
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_programid_value: SOCAL, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: CONTACT })),
    resolveRequestRecipients: jest.fn(async () => ({ pi: { name: 'PI', email: 'pi@example.edu' }, liaison: { contactId: CONTACT, name: 'Request Liaison', email: 'request@example.edu' } })),
  });
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(contacts.liaison.email).toBe('request@example.edu');
  expect(d.getAccount).not.toHaveBeenCalled();
  expect(applicantAttendeeSuggestions(contacts)).toHaveLength(2);
});

test('an email-less request primary contact does not silently use the organization contact', async () => {
  const d = deps({
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST, _akoya_programid_value: SOCAL, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: CONTACT })),
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

test('non-Research with no Request copy and no organization contact is liaisonStatus none', async () => {
  const d = deps({ getAccount: jest.fn(async () => ({ _primarycontactid_value: null })) });
  const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
  expect(contacts.liaisonStatus).toBe('none');
});

test('an omitted program field in a caller-supplied Request throws (projection bug)', async () => {
  const d = deps();
  const request = { akoya_requestid: REQUEST, _akoya_applicantid_value: ACCOUNT, _akoya_primarycontactid_value: null };
  await expect(resolveSiteVisitApplicantContacts({ requestId: REQUEST, request }, d)).rejects.toThrow(/_akoya_programid_value/);
  expect(d.resolveRequestRecipients).not.toHaveBeenCalled();
});

describe('Research', () => {
  const research = (over = {}) => jest.fn(async () => ({
    akoya_requestid: REQUEST,
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[0].toUpperCase(),
    _akoya_applicantid_value: ACCOUNT,
    _akoya_primarycontactid_value: null,
    ...over,
  }));

  test('uses the recipients\' institution Liaison and never the organization fallback read', async () => {
    const d = deps({
      getRequest: research({ _akoya_primarycontactid_value: '55555555-5555-4555-8555-555555555555' }),
      resolveRequestRecipients: jest.fn(async () => ({ pi: { name: 'PI', email: 'pi@example.edu' }, liaison: { contactId: CONTACT, name: 'Institution Liaison', email: 'inst@example.edu' } })),
    });
    const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
    expect(contacts.liaison.email).toBe('inst@example.edu');
    expect(contacts.liaisonStatus).toBe('found');
    expect(d.getAccount).not.toHaveBeenCalled();
  });

  test('none from the recipients stays none: no Request-copy or organization fallback', async () => {
    const d = deps({ getRequest: research() });
    const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
    expect(contacts.liaison).toEqual({ contactId: null, name: null, email: null });
    expect(contacts.liaisonStatus).toBe('none');
    expect(d.getAccount).not.toHaveBeenCalled();
    expect(applicantAttendeeSuggestions(contacts)).toEqual([{ kind: 'manual', name: 'Franklin Cat', email: 'franklin@example.edu' }]);
  });

  test('a found Liaison without an email is found, not none', async () => {
    const d = deps({
      getRequest: research(),
      resolveRequestRecipients: jest.fn(async () => ({ pi: { name: 'PI', email: 'pi@example.edu' }, liaison: { contactId: CONTACT, name: 'Institution Liaison', email: null } })),
    });
    const contacts = await resolveSiteVisitApplicantContacts({ requestId: REQUEST }, d);
    expect(contacts.liaisonStatus).toBe('found');
  });
});
