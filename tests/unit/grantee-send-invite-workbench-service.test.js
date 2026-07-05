/**
 * @jest-environment node
 *
 * lib/services/workbench/grantee-deliverables/send-invite-service —
 * logic-level tests (send + mint mocked), Stage 4 series C extraction. The
 * route suite pins the envelopes + guard order; this pins the service's
 * typed errors, mint-injection, and the partial-success statusPersisted
 * semantics (email out, durable status write failed).
 */

const createAndSendEmail = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getById(...a),
  SELECT_PROFILES: { IDENTITY: 'akoya_requestid,akoya_requestnum' },
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

const GUID = '11111111-1111-1111-1111-111111111111';
const args = (over = {}) => ({
  requestId: GUID, toEmail: 'pi@x.edu', ccEmail: 'li@x.edu',
  subject: 'Deliverables', bodyText: 'Dear Dr. X, please submit.',
  fromEmail: 'pd@wmkeck.org', actingUserSystemId: 'sys-1', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue({ akoya_requestid: GUID, akoya_requestnum: '1002794' });
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

test('send failure → 502 typed, no status flip', async () => {
  createAndSendEmail.mockRejectedValue(new Error('graph 500'));
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
