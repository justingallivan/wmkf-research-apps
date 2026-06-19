/**
 * GET /api/external/grantee/[token]/context — method guard, rate-limit, ordering,
 * fail-closed editable-status allowlist, and view derivation.
 *
 * @jest-environment node
 */
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/verify-grantee-token', () => ({
  verifyGranteeToken: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/external/grantee/[token]/context';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function okVerify(status) {
  return {
    ok: true,
    requestId: 'req-1',
    request: {
      akoya_title: 'Test grant',
      akoya_requestnum: '1002794',
      wmkf_meetingdate: '2026-06-01',
      wmkf_abstractformatted: 'formatted',
      wmkf_abstractapproved: null,
      wmkf_granteeimagecaption: null,
      wmkf_granteeimagefileref: null,
      wmkf_granteedeliverablestatus: status,
    },
  };
}

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ ok: true });
  recordTokenOutcome.mockReset().mockResolvedValue(undefined);
  verifyGranteeToken.mockReset();
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(verifyGranteeToken).not.toHaveBeenCalled();
});

test('rate-limited → 429 with Retry-After, before token verify', async () => {
  checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(429);
  expect(res.headers['Retry-After']).toBe('42');
  expect(verifyGranteeToken).not.toHaveBeenCalled();
});

test('invalid token → 401 + reason, outcome recorded', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'invalid_claim' });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ ok: false, reason: 'invalid_claim' });
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 't', false);
});

test('not_found → 404', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'not_found' });
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(404);
});

test('editable status (Invited) → editable:true, view:edit', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.editable).toBe(true);
  expect(res.body.view).toBe('edit');
  expect(res.body.deliverable.hasImage).toBe(false);
  // raw SharePoint ref must NOT leak to the external client
  expect(res.body.deliverable.imageFileRef).toBeUndefined();
});

test('submitted status (Complete) → editable:false, view:submitted', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.COMPLETE));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('submitted');
});

test('FAIL-CLOSED: null status → not editable, view:closed', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(null));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('closed');
});

test('FAIL-CLOSED: unknown status value → not editable, view:closed', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(999999));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(false);
  expect(res.body.view).toBe('closed');
});

test('numeric-string status from the API is coerced (Revision Requested → editable)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(String(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED)));
  const res = mockRes();
  await handler({ method: 'GET', query: { token: 't' }, headers: {} }, res);
  expect(res.body.editable).toBe(true);
  expect(res.body.view).toBe('edit');
});
