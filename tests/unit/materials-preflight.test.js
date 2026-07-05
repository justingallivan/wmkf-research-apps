/**
 * GET /api/review-manager/materials-preflight
 *
 * Covers: auth gate, requestId GUID rejection, fileCount mapping from
 * listReviewerMaterials, request-not-found, and sanitized upstream failure
 * (no raw Graph/Dataverse error text reaches the client — 'materials_unavailable').
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { listReviewerMaterials } from '../../lib/external/reviewer-materials';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/external/reviewer-materials', () => ({
  listReviewerMaterials: jest.fn(),
}));

const REQUEST_ID = '550e8400-e29b-41d4-a716-446655440000';

let handler;
beforeAll(async () => {
  handler = (await import('../../pages/api/review-manager/materials-preflight')).default;
});

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'user-1' } } });
  DynamicsService.getRecord.mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'REQ-1',
  });
});

function get(query) {
  const req = createMockReq({ method: 'GET', query });
  const res = createMockRes();
  return { req, res };
}

test('rejects non-GET methods', async () => {
  const req = createMockReq({ method: 'POST' });
  const res = createMockRes();
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(405);
});

test('non-GET rejection sets Allow: GET and the full envelope', async () => {
  const req = createMockReq({ method: 'POST' });
  const res = createMockRes();
  await handler(req, res);
  expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
  expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'method_not_allowed' });
});

test('is app-gated (requireAppAccess denial short-circuits)', async () => {
  requireAppAccess.mockResolvedValue(null);
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(res.status).not.toHaveBeenCalledWith(200);
});

test('unauthenticated request passes through requireAppAccess\'s 401 untouched', async () => {
  // requireAppAccess writes its own response for the unauthenticated case
  // (lib/utils/auth.js: res.status(401).json({ error: 'Authentication required' }); return null).
  // The route itself does nothing further once it gets a falsy return — pin that pass-through.
  requireAppAccess.mockImplementation(async (_req, resArg) => {
    resArg.status(401).json({ error: 'Authentication required' });
    return null;
  });
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('rejects a non-GUID requestId before it reaches Dataverse', async () => {
  const { req, res } = get({ requestId: 'not-a-guid' });
  await handler(req, res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, reason: 'validation' }));
});

test('maps listReviewerMaterials length to fileCount', async () => {
  listReviewerMaterials.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(listReviewerMaterials).toHaveBeenCalledWith(REQUEST_ID, 'REQ-1');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ ok: true, fileCount: 3 });
});

test('empty folder maps to fileCount 0', async () => {
  listReviewerMaterials.mockResolvedValue([]);
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.json).toHaveBeenCalledWith({ ok: true, fileCount: 0 });
});

test('unknown requestId (no matching request) returns not_found, not a 500', async () => {
  DynamicsService.getRecord.mockResolvedValue(null);
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(listReviewerMaterials).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'not_found' });
});

test('upstream listing failure is sanitized — no raw error text to the client', async () => {
  listReviewerMaterials.mockRejectedValue(new Error('Graph 503: secret-internal-detail'));
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  const payload = res.json.mock.calls[0][0];
  expect(payload).toEqual({ ok: false, reason: 'materials_unavailable' });
  expect(JSON.stringify(payload)).not.toMatch(/secret-internal-detail/);
});

test('upstream Dataverse lookup failure is also sanitized', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('Dataverse 500: internal'));
  const { req, res } = get({ requestId: REQUEST_ID });
  await handler(req, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'materials_unavailable' });
});
