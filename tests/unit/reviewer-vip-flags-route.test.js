/** @jest-environment node */

/**
 * /api/review-manager/reviewer-vip-flags — per-(lead PD, reviewer person)
 * VIP flags. The PD is resolved server-side from the request row, never from
 * client input; both client-supplied ids are GUID-validated before any
 * Dataverse selector.
 */

import handler from '../../pages/api/review-manager/reviewer-vip-flags';
import { requireAppAccess } from '../../lib/utils/auth';
import { getById as getRequestById } from '../../lib/dataverse/adapters/grant-request';
import * as store from '../../lib/services/scheduled-email-store';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_name, fn) => fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn() }));
jest.mock('../../lib/services/scheduled-email-store', () => ({
  setReviewerVipFlag: jest.fn(),
  clearReviewerVipFlag: jest.fn(),
  listReviewerVipFlags: jest.fn(),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const PR = '22222222-2222-4222-8222-222222222222';
const PD = '33333333-3333-4333-8333-333333333333';

function mockRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'staff-1' } } });
  getRequestById.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: PD });
  store.listReviewerVipFlags.mockResolvedValue([{ potential_reviewer_id: PR, created_at: 'now' }]);
});

test('unauthenticated callers never reach the store', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQ } }, res);
  expect(store.listReviewerVipFlags).not.toHaveBeenCalled();
});

test('a non-GUID requestId is rejected before any Dataverse read', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: "1' or 1eq1" } }, res);
  expect(res.statusCode).toBe(400);
  expect(getRequestById).not.toHaveBeenCalled();
});

test('GET resolves the lead PD server-side and lists that PD\'s flags', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQ } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ pdSystemUserId: PD, flaggedPotentialReviewerIds: [PR] });
  expect(store.listReviewerVipFlags).toHaveBeenCalledWith(PD);
});

test('a request without an assigned PD is a 409, not an empty success', async () => {
  getRequestById.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: null });
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQ } }, res);
  expect(res.statusCode).toBe(409);
});

test('PUT ignores any client-supplied PD and keys the write on the request\'s lead PD', async () => {
  const res = mockRes();
  await handler({
    method: 'PUT',
    body: { requestId: REQ, potentialReviewerId: PR, flagged: true, pdSystemUserId: 'attacker-pd' },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(store.setReviewerVipFlag).toHaveBeenCalledWith(PD, PR);
});

test('PUT flagged:false clears; non-GUID reviewer id is rejected', async () => {
  const res = mockRes();
  await handler({ method: 'PUT', body: { requestId: REQ, potentialReviewerId: PR, flagged: false } }, res);
  expect(store.clearReviewerVipFlag).toHaveBeenCalledWith(PD, PR);
  const bad = mockRes();
  await handler({ method: 'PUT', body: { requestId: REQ, potentialReviewerId: 'not-a-guid', flagged: true } }, bad);
  expect(bad.statusCode).toBe(400);
  expect(store.setReviewerVipFlag).not.toHaveBeenCalled();
  expect(store.clearReviewerVipFlag).toHaveBeenCalledTimes(1);
});
