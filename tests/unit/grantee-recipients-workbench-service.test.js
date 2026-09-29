/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/recipients-service —
 * logic-level tests (adapters mocked), Stage 4 series C extraction.
 * The Liaison is the Liaison of record (institution Primary Contact for
 * Research; docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 1).
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
}));

const getInviteRecipientById = jest.fn();
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({
  getInviteRecipientById: (...a) => getInviteRecipientById(...a),
}));

const queryAccounts = jest.fn();
jest.mock('../../lib/dataverse/adapters/account.js', () => ({
  __esModule: true,
  queryAccounts: (...a) => queryAccounts(...a),
}));

import { resolveGranteeInviteRecipients } from '../../lib/services/workbench/grantee-deliverables/recipients-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';

const GUID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT = '22222222-2222-2222-2222-222222222222';
const SOCAL = '33333333-3333-3333-3333-333333333333';

function requestRow(overrides = {}) {
  return {
    akoya_requestid: GUID,
    _wmkf_projectleader_value: 'pi-1',
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[0].toUpperCase(),
    _akoya_applicantid_value: ACCOUNT,
    _akoya_primarycontactid_value: 'copy-1',
    ...overrides,
  };
}

const CONTACTS = {
  'pi-1': { contactid: 'pi-1', fullname: 'Monika Raj', emailaddress1: 'monika.raj@emory.edu' },
  'li-1': { contactid: 'li-1', firstname: 'Lorena', lastname: 'McLaren', emailaddress1: null },
  'copy-1': { contactid: 'copy-1', fullname: 'Former Liaison', emailaddress1: 'former@emory.edu' },
};

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(requestRow());
  queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT, _primarycontactid_value: 'li-1' }], totalCount: 1, hasMore: false });
  getInviteRecipientById.mockImplementation(async (id) => CONTACTS[id]);
});

test('404 typed error when the request does not resolve', async () => {
  getById.mockRejectedValue(new Error('gone'));
  const err = await resolveGranteeInviteRecipients({ requestId: GUID }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
});

test('the Request projection selects every Liaison helper input', async () => {
  await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(getById.mock.calls[0][1].select).toEqual(expect.arrayContaining([
    '_wmkf_projectleader_value', '_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value',
  ]));
});

test('Research: the institution Primary Contact, never a differing Request copy; fullname preferred, first/last fallback', async () => {
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body).toEqual({
    pi: { contactId: 'pi-1', name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true },
    liaison: { contactId: 'li-1', name: 'Lorena McLaren', email: null, hasEmail: false },
  });
  expect(getInviteRecipientById).not.toHaveBeenCalledWith('copy-1');
});

test('Research: no institution Primary Contact → no Liaison, no fallback to the copy', async () => {
  queryAccounts.mockResolvedValue({ records: [{ accountid: ACCOUNT, _primarycontactid_value: null }], totalCount: 1, hasMore: false });
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body.liaison).toEqual({ contactId: null, name: null, email: null, hasEmail: false });
  expect(getInviteRecipientById).not.toHaveBeenCalledWith('copy-1');
});

test('SoCal keeps the Request copy', async () => {
  getById.mockResolvedValue(requestRow({ _akoya_programid_value: SOCAL }));
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body.liaison).toMatchObject({ contactId: 'copy-1', email: 'former@emory.edu' });
  expect(queryAccounts).not.toHaveBeenCalled();
});

test('an account read failure → 503, not "no Liaison"', async () => {
  queryAccounts.mockRejectedValue(new Error('dataverse 503'));
  const err = await resolveGranteeInviteRecipients({ requestId: GUID }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
});

test.each(['pi-1', 'li-1'])('an unreadable contact (%s) → 503, not a recipient without email', async (failing) => {
  getInviteRecipientById.mockImplementation(async (id) => {
    if (id === failing) throw Object.assign(new Error('403'), { status: 403 });
    return CONTACTS[id];
  });
  const err = await resolveGranteeInviteRecipients({ requestId: GUID }).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
});

test('missing PI lookup → null stub', async () => {
  getById.mockResolvedValue(requestRow({ _wmkf_projectleader_value: null }));
  const body = await resolveGranteeInviteRecipients({ requestId: GUID });
  expect(body.pi).toEqual({ contactId: null, name: null, email: null, hasEmail: false });
});
