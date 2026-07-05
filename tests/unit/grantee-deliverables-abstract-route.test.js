/**
 * GET/PUT /api/workbench/grantee-deliverables/abstract — S278 PD edit/save.
 * Covers: method/GUID/auth guards, GET effective-field resolution + editable
 * gate, PUT happy (formatted + approved), provenance guard (never approved when
 * empty), status allowlist (Safe default), stale baseField flip → 409, 412 →
 * 409, empty/too-long/missing-etag input guards, status untouched.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return Promise.resolve().then(() => fn());
  },
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { getDeliverableForRequest } from '../../lib/services/grantee-deliverable-record';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/workbench/grantee-deliverables/abstract';

const GUID = '22222222-2222-2222-2222-222222222222';
const DRAFT = 'The team will measure the thing across the next three years in a long enough draft abstract.';
const APPROVED = 'The team will measure the thing; the grantee approved this version for the website.';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const getReq = (query) => ({ method: 'GET', query, body: {}, headers: {} });
const putReq = (body) => ({ method: 'PUT', body, query: {}, headers: {} });

function row(over = {}) {
  return {
    akoya_requestid: GUID,
    wmkf_abstractformatted: DRAFT,
    wmkf_abstractapproved: null,
    _etag: 'W/"1"',
    ...over,
  };
}
const deliverable = (status = null) => ({ wmkf_granteedeliverableid: 'd1', wmkf_deliverablestatus: status });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p1', session: { user: { dynamicsSystemuserId: 'sys-1' } } });
  DynamicsService.getRecord.mockReset();
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  getDeliverableForRequest.mockReset().mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.DRAFTED));
});

// ── guards ──
test('unsupported method → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: {}, query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('GET invalid requestId → 400 (no Dataverse read)', async () => {
  const res = mockRes();
  await handler(getReq({ requestId: 'nope' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('PUT invalid requestId → 400 (no Dataverse read)', async () => {
  const res = mockRes();
  await handler(putReq({ requestId: 'nope', text: DRAFT, etag: 'W/"1"' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('auth gate short-circuits', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

// ── GET ──
test('GET resolves the DRAFT as effective when approved is empty (full envelope pin)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row());
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    abstractFormatted: DRAFT,
    abstractApproved: '',
    effective: DRAFT,
    effectiveField: 'formatted',
    etag: 'W/"1"',
    status: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
    statusLabel: 'Drafted',
    editable: true,
  });
});

test('GET resolves the APPROVED version as effective once present', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.SUBMITTED));
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.body).toMatchObject({ effective: APPROVED, effectiveField: 'approved', editable: true });
});

test('GET marks approved NON-editable in Revision Requested', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED));
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.body.effectiveField).toBe('approved');
  expect(res.body.editable).toBe(false);
});

test('GET request not found → 404', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('boom'));
  const res = mockRes();
  await handler(getReq({ requestId: GUID }), res);
  expect(res.statusCode).toBe(404);
});

// ── PUT input guards ──
test('PUT empty text → 400, no write', async () => {
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: '   ', etag: 'W/"1"' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('PUT missing etag → 400 fail-closed, no write', async () => {
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: DRAFT }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('PUT over-long text → 400', async () => {
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'x'.repeat(20001), etag: 'W/"1"' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

// ── PUT happy paths ──
test('PUT writes the DRAFT field with the client etag, leaves status untouched', async () => {
  DynamicsService.getRecord
    .mockResolvedValueOnce(row())                 // initial read
    .mockResolvedValueOnce({ _etag: 'W/"2"' });   // re-read for new etag
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'edited draft text that is plenty long enough', etag: 'W/"1"', baseField: 'formatted' }), res);
  expect(res.statusCode).toBe(200);
  const [entity, id, patch, opts] = DynamicsService.updateRecord.mock.calls[0];
  expect(entity).toBe('akoya_requests');
  expect(id).toBe(GUID);
  expect(patch).toEqual({ wmkf_abstractformatted: 'edited draft text that is plenty long enough' });
  expect(opts).toMatchObject({ ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
  // never touches deliverable status
  expect(patch).not.toHaveProperty('wmkf_deliverablestatus');
  // Full 200 envelope pin.
  expect(res.body).toEqual({
    ok: true,
    field: 'formatted',
    etag: 'W/"2"',
    status: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
    statusLabel: 'Drafted',
  });
});

test('PUT writes the APPROVED field once the grantee has submitted', async () => {
  DynamicsService.getRecord
    .mockResolvedValueOnce(row({ wmkf_abstractapproved: APPROVED }))
    .mockResolvedValueOnce({ _etag: 'W/"2"' });
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.STAFF_REVIEW));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'PD-corrected approved abstract for publication', etag: 'W/"1"', baseField: 'approved' }), res);
  expect(res.statusCode).toBe(200);
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch).toEqual({ wmkf_abstractapproved: 'PD-corrected approved abstract for publication' });
  expect(res.body.field).toBe('approved');
});

// ── PUT guards: provenance, status, concurrency ──
test('PROVENANCE/STALE: client loaded the draft but approved now exists → 409, no write', async () => {
  // grantee submitted between load and save: approved is now non-empty, so the
  // effective target flipped formatted→approved; a draft edit must not land.
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.SUBMITTED));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'stale draft edit', etag: 'W/"1"', baseField: 'formatted' }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('stale');
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('STATUS GATE: approved edit blocked in Revision Requested → 409, no write', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'a fix that would be clobbered on resubmit', etag: 'W/"1"', baseField: 'approved' }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('not_editable');
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('STATUS GATE: approved edit blocked when Complete → 409', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractapproved: APPROVED }));
  getDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.COMPLETE));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'post-complete edit', etag: 'W/"1"', baseField: 'approved' }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('not_editable');
});

test('CONCURRENCY: a 412 from the conditional write → 409 stale', async () => {
  DynamicsService.getRecord.mockResolvedValue(row());
  DynamicsService.updateRecord.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: 'edit racing another writer', etag: 'W/"1"', baseField: 'formatted' }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('stale');
});

test('PUT request not found → 404', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('gone'));
  const res = mockRes();
  await handler(putReq({ requestId: GUID, text: DRAFT, etag: 'W/"1"', baseField: 'formatted' }), res);
  expect(res.statusCode).toBe(404);
});
