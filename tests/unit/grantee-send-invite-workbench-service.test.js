/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/send-invite-service —
 * logic-level tests (send + mint mocked), Stage 4 series C extraction. The
 * route suite pins the envelopes + guard order; this pins the service's
 * typed errors, mint-injection, and the partial-success statusPersisted
 * semantics (email out, durable status write failed), and the stale-Liaison
 * interlock (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 1).
 */

const createAndSendEmail = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  SELECT_PROFILES: { IDENTITY: ['akoya_requestid', 'akoya_requestnum'] },
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

const mintForRequest = jest.fn(async () => ({ url: 'https://app.example.org/external/grantee/JWT123' }));
jest.mock('../../lib/external/grantee-token-lifecycle', () => ({
  mintForRequest: (...a) => mintForRequest(...a),
}));

jest.mock('../../lib/external/grantee-invite-email', () => ({
  renderGranteeInviteHtml: ({ bodyText, url }) => `<html>${bodyText}\n${url}</html>`,
}));

jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Assigned PD' })),
  appendSignatureBlock: (bodyText, sig) => `${bodyText}\n\n${sig.signature}`,
}));

const ensureDeliverableForRequest = jest.fn();
const patchDeliverable = jest.fn(async () => {});
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  ensureDeliverableForRequest: (...a) => ensureDeliverableForRequest(...a),
  patchDeliverable: (...a) => patchDeliverable(...a),
}));

import { sendGranteeInvite } from '../../lib/services/workbench/grantee-deliverables/send-invite-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';

const GUID = '11111111-1111-1111-1111-111111111111';
const ACCOUNT = '22222222-2222-2222-2222-222222222222';
const LIAISON = '44444444-4444-4444-4444-444444444444';
const OTHER = '55555555-5555-5555-5555-555555555555';
const args = (over = {}) => ({
  requestId: GUID, toEmail: 'pi@x.edu', ccEmail: 'li@x.edu',
  subject: 'Deliverables', bodyText: 'Dear Dr. X, please submit.',
  fromEmail: 'pd@wmkeck.org', actingUserSystemId: 'sys-1',
  liaisonSeen: { contactId: LIAISON.toUpperCase(), email: ' Li@X.edu ' },
  ...over,
});
const institution = (primaryContact) => ({
  records: [{ accountid: ACCOUNT, _primarycontactid_value: primaryContact }], totalCount: 1, hasMore: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({
    akoya_requestid: GUID,
    akoya_requestnum: '1002794',
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[1],
    _akoya_applicantid_value: ACCOUNT,
    _akoya_primarycontactid_value: OTHER,
  });
  queryAccounts.mockResolvedValue(institution(LIAISON));
  getInviteRecipientById.mockImplementation(async (id) => ({ contactid: id, fullname: 'Liaison', emailaddress1: id === LIAISON ? 'li@x.edu' : 'other@x.edu' }));
  createAndSendEmail.mockResolvedValue({ emailId: 'email-1' });
  ensureDeliverableForRequest.mockResolvedValue({ wmkf_granteedeliverableid: 'd1', wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED, _etag: 'W/"2"' });
  mintForRequest.mockResolvedValue({ url: 'https://app.example.org/external/grantee/JWT123' });
});

test('typed guards: 404, request-number leak 400, corrupt status 500, generate-first 400, submitted 409 — nothing minted/sent', async () => {
  getById.mockRejectedValueOnce(new Error('gone'));
  let err = await sendGranteeInvite(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);

  err = await sendGranteeInvite(args({ subject: 'Grant 1002794' })).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Email subject/body cannot include the internal request number.');

  ensureDeliverableForRequest.mockResolvedValueOnce({ wmkf_deliverablestatus: 'abc' });
  err = await sendGranteeInvite(args()).catch((e) => e);
  expect(err.httpStatus).toBe(500);

  ensureDeliverableForRequest.mockResolvedValueOnce({ wmkf_deliverablestatus: null });
  err = await sendGranteeInvite(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);

  ensureDeliverableForRequest.mockResolvedValueOnce({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED });
  err = await sendGranteeInvite(args()).catch((e) => e);
  expect(err.httpStatus).toBe(409);

  expect(mintForRequest).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('happy path: server-minted link + signature injected; Drafted → Invited with invite date', async () => {
  const body = await sendGranteeInvite(args());
  expect(body).toEqual({ ok: true, emailId: 'email-1', status: GRANTEE_DELIVERABLE_STATUS.INVITED, statusPersisted: true });
  const sent = createAndSendEmail.mock.calls[0][0];
  expect(sent.body).toContain('JWT123');
  expect(sent.body).toContain('Assigned PD');
  expect(sent).toMatchObject({ from: 'pd@wmkeck.org', to: 'pi@x.edu', cc: 'li@x.edu', regardingId: GUID, regardingType: 'akoya_request' });
  const [, patch, opts] = patchDeliverable.mock.calls[0];
  expect(patch.wmkf_deliverablestatus).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
  expect(typeof patch.wmkf_inviteddate).toBe('string');
  expect(opts).toEqual({ ifMatch: 'W/"2"', actingUserSystemId: 'sys-1' });
});

test('forwards multiple route-validated Cc addresses to the mail transport', async () => {
  await sendGranteeInvite(args({ ccEmail: ['li@x.edu', 'assistant@x.edu'] }));
  expect(createAndSendEmail.mock.calls[0][0].cc).toEqual(['li@x.edu', 'assistant@x.edu']);
});

test('send failure → 502 typed, no status flip', async () => {
  createAndSendEmail.mockRejectedValue(Object.assign(new Error('graph 500'), { dispatched: false }));
  const err = await sendGranteeInvite(args()).catch((e) => e);
  expect(err.httpStatus).toBe(502);
  expect(patchDeliverable).not.toHaveBeenCalled();
});

test('PARTIAL SUCCESS: failed status write after a sent email resolves 200-shaped with the ACTUAL status', async () => {
  patchDeliverable.mockRejectedValue(new Error('etag race'));
  const body = await sendGranteeInvite(args());
  expect(body).toEqual({ ok: true, emailId: 'email-1', status: GRANTEE_DELIVERABLE_STATUS.DRAFTED, statusPersisted: false });
});

test('non-downgrade: re-send while Invited sends but never writes status; empty cc → undefined', async () => {
  ensureDeliverableForRequest.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED, _etag: 'W/"2"' });
  const body = await sendGranteeInvite(args({ ccEmail: '' }));
  expect(body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
  expect(patchDeliverable).not.toHaveBeenCalled();
  expect(createAndSendEmail.mock.calls[0][0].cc).toBeUndefined();
});

describe('Test Request isolation (Stage 1b)', () => {
  afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

  test('a test request is refused before any deliverable write, mint or send', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getById.mockImplementation(async (_id, { select } = {}) => (
      Array.isArray(select) && select.includes('wmkf_istestrequest')
        ? { wmkf_istestrequest: true, wmkf_testcreationrunid: '22222222-2222-4222-8222-222222222222' }
        : { akoya_requestid: GUID, akoya_requestnum: '1002794' }
    ));
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceHttpError);
    expect(err).toMatchObject({ httpStatus: 409, code: 'test_request_email_denied' });
    expect(ensureDeliverableForRequest).not.toHaveBeenCalled();
    expect(mintForRequest).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('an ordinary legacy-null request still sends with the switch on', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    getById.mockImplementation(async (_id, { select } = {}) => (
      Array.isArray(select) && select.includes('wmkf_istestrequest')
        ? { wmkf_istestrequest: null, wmkf_testcreationrunid: null }
        : {
          akoya_requestid: GUID,
          akoya_requestnum: '1002794',
          _akoya_programid_value: RESEARCH_PROGRAM_IDS[1],
          _akoya_applicantid_value: ACCOUNT,
          _akoya_primarycontactid_value: OTHER,
        }
    ));
    await sendGranteeInvite(args());
    expect(mintForRequest).toHaveBeenCalled();
    expect(createAndSendEmail).toHaveBeenCalled();
  });
});

describe('stale-Liaison interlock', () => {
  function expectNothingSent() {
    expect(mintForRequest).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  }

  test('the Request read selects every Liaison helper input', async () => {
    await sendGranteeInvite(args());
    expect(getById.mock.calls[0][1].select).toEqual(expect.arrayContaining([
      'akoya_requestid', 'akoya_requestnum', '_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value',
    ]));
  });

  test('a match (case and whitespace normalized) sends the Cc exactly as submitted', async () => {
    await sendGranteeInvite(args({ ccEmail: ['li@x.edu', 'assistant@x.edu'] }));
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'pi@x.edu', cc: ['li@x.edu', 'assistant@x.edu'] }));
  });

  test('staff removing the Liaison from Cc is deliberate and still sends', async () => {
    await sendGranteeInvite(args({ ccEmail: '' }));
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'pi@x.edu', cc: undefined }));
  });

  test('the Liaison contact changed after compose → 409 liaison_changed, nothing sent', async () => {
    queryAccounts.mockResolvedValue(institution(OTHER));
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceHttpError);
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe('liaison_changed');
    expectNothingSent();
  });

  test('a different contact with the same email (a duplicate contact row) → 409, nothing sent', async () => {
    queryAccounts.mockResolvedValue(institution(OTHER));
    getInviteRecipientById.mockResolvedValue({ contactid: OTHER, fullname: 'Liaison', emailaddress1: 'li@x.edu' });
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err.httpStatus).toBe(409);
    expectNothingSent();
  });

  test('the same contact\'s email changed after compose → 409, nothing sent', async () => {
    getInviteRecipientById.mockResolvedValue({ contactid: LIAISON, fullname: 'Liaison', emailaddress1: 'new@x.edu' });
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err.httpStatus).toBe(409);
    expectNothingSent();
  });

  test('staff saw no Liaison but one is now set → 409', async () => {
    const err = await sendGranteeInvite(args({ liaisonSeen: { contactId: null, email: null } })).catch((e) => e);
    expect(err.httpStatus).toBe(409);
    expectNothingSent();
  });

  test('a Liaison that disappeared → 409', async () => {
    queryAccounts.mockResolvedValue(institution(null));
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err.httpStatus).toBe(409);
    expectNothingSent();
  });

  test('no Liaison seen and none current → sends PI-only as submitted', async () => {
    queryAccounts.mockResolvedValue(institution(null));
    await sendGranteeInvite(args({ ccEmail: '', liaisonSeen: { contactId: null, email: null } }));
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'pi@x.edu', cc: undefined }));
  });

  test.each([
    ['the account read', () => queryAccounts.mockRejectedValue(new Error('dataverse 503'))],
    ['the contact read', () => getInviteRecipientById.mockRejectedValue(new Error('403'))],
  ])('a failure of %s → 503, nothing sent', async (_label, arrange) => {
    arrange();
    const err = await sendGranteeInvite(args()).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceHttpError);
    expect(err.httpStatus).toBe(503);
    expectNothingSent();
  });
});
