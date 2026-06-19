/**
 * POST /api/workbench/grantee-deliverables/send-invite — chunk 3c.
 * PI in To, liaison in Cc; generate-first guard; already-submitted 409; server
 * mints + injects the magic-link; status Drafted→Invited (non-downgrade).
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), updateRecord: jest.fn(), createAndSendEmail: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));
jest.mock('../../lib/external/grantee-token-lifecycle', () => ({
  mintForRequest: jest.fn(async () => ({ url: 'https://app.example.org/external/grantee/JWT123' })),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { mintForRequest } from '../../lib/external/grantee-token-lifecycle';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/workbench/grantee-deliverables/send-invite';

const GUID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const body = (over = {}) => ({
  requestId: GUID, toEmail: 'monika.raj@emory.edu', ccEmail: 'lorena.mclaren@emory.edu',
  subject: 'Your Keck grant deliverables', bodyText: 'Dear Dr. Raj, please submit your deliverables.',
  ...over,
});
const reqOf = (b) => ({ method: 'POST', body: b, headers: {} });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({
    profileId: 'p', session: { user: { azureEmail: 'pd@wmkeck.org', dynamicsSystemuserId: 'sys-1' } },
  });
  DynamicsService.getRecord.mockReset().mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED });
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  DynamicsService.createAndSendEmail.mockReset().mockResolvedValue({ emailId: 'email-1' });
  mintForRequest.mockClear();
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('invalid requestId → 400', async () => {
  const res = mockRes();
  await handler(reqOf(body({ requestId: 'nope' })), res);
  expect(res.statusCode).toBe(400);
});

test('happy path: PI To, liaison Cc, server-injected link, status Drafted→Invited', async () => {
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);

  expect(mintForRequest).toHaveBeenCalledWith({ requestId: GUID });
  const sent = DynamicsService.createAndSendEmail.mock.calls[0][0];
  expect(sent).toMatchObject({
    from: 'pd@wmkeck.org', to: 'monika.raj@emory.edu', cc: 'lorena.mclaren@emory.edu',
    regardingId: GUID, regardingType: 'akoya_request', actingUserSystemId: 'sys-1',
  });
  // the magic-link was injected server-side into the HTML body
  expect(sent.body).toContain('https://app.example.org/external/grantee/JWT123');

  // status flip Drafted -> Invited
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch).toEqual({ wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED });
});

test('generate-first guard: null status → 400, nothing sent', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: null });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('already submitted → 409, nothing sent', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(409);
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('NON-DOWNGRADE: re-send while Invited keeps Invited (no status write)', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.createAndSendEmail).toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
});

test('invalid To email → 400', async () => {
  const res = mockRes();
  await handler(reqOf(body({ toEmail: 'not-an-email' })), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('invalid Cc email → 400', async () => {
  const res = mockRes();
  await handler(reqOf(body({ ccEmail: 'bad' })), res);
  expect(res.statusCode).toBe(400);
});

test('missing azureEmail (no sender) → 400', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 'p', session: { user: { dynamicsSystemuserId: 'sys-1' } } });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(400);
});

test('send failure → 502, status not flipped', async () => {
  DynamicsService.createAndSendEmail.mockRejectedValue(new Error('graph 500'));
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(502);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('a failed status write after a successful send returns 200 but reports the ACTUAL status (not Invited)', async () => {
  DynamicsService.updateRecord.mockRejectedValue(new Error('etag race'));
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  // The email sent, but the durable status stayed Drafted — must NOT claim Invited.
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.DRAFTED);
  expect(res.body.statusPersisted).toBe(false);
});

test('happy path reports statusPersisted true', async () => {
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.body.statusPersisted).toBe(true);
});

test('SECURITY: a corrupt non-numeric status → 500, nothing minted or sent', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: 'abc' });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(500);
  expect(mintForRequest).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('a numeric-STRING Drafted status from the API still sends + flips to Invited', async () => {
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID, wmkf_granteedeliverablestatus: String(GRANTEE_DELIVERABLE_STATUS.DRAFTED) });
  const res = mockRes();
  await handler(reqOf(body()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.createAndSendEmail).toHaveBeenCalled();
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
});

test('omitting ccEmail passes cc: undefined to the send (no CC party)', async () => {
  const res = mockRes();
  await handler(reqOf(body({ ccEmail: '' })), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].cc).toBeUndefined();
});
