/**
 * POST /api/workbench/grantee-deliverables/generate — chunk 3.
 * Covers: method/GUID/auth guards, reuse-existing, missing source, no-etag
 * fail-closed, happy persist + status stamp, status non-downgrade, 412 handling
 * (re-read → 200 reused / 409), and strict-boolean regenerate.
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
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(async () => {}),
}));
jest.mock('../../lib/services/grantee-abstract-service', () => ({
  generateGranteeAbstract: jest.fn(),
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  ensureDeliverableForRequest: jest.fn(),
  patchDeliverable: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { generateGranteeAbstract } from '../../lib/services/grantee-abstract-service';
import { ensureDeliverableForRequest, patchDeliverable } from '../../lib/services/grantee-deliverable-record';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/workbench/grantee-deliverables/generate';

const GUID = '22222222-2222-2222-2222-222222222222';
const SOURCE = 'We will measure the thing. Our team has prior data and we believe it generalizes to humans over the next three years.';
const FORMATTED = 'The team will measure the thing; prior data showed it works and the work will test generalization to humans.';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (body) => ({ method: 'POST', body, headers: {} });

function row(over = {}) {
  return {
    akoya_requestid: GUID,
    akoya_requestnum: '1002794',
    wmkf_abstract: SOURCE,
    wmkf_abstractformatted: null,
    _etag: 'W/"1"',
    ...over,
  };
}
function deliverable(status = null) {
  return {
    wmkf_granteedeliverableid: 'deliv-1',
    wmkf_deliverablestatus: status,
    _etag: 'W/"2"',
  };
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p1', session: { user: { dynamicsSystemuserId: 'sys-1' } } });
  DynamicsService.getRecord.mockReset();
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  loadModelOverrides.mockReset().mockResolvedValue();
  generateGranteeAbstract.mockReset().mockResolvedValue({ abstractFormatted: FORMATTED, runId: 'r1', model: 'm1' });
  ensureDeliverableForRequest.mockReset().mockResolvedValue(deliverable(null));
  patchDeliverable.mockReset().mockResolvedValue({});
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('invalid requestId → 400 (no Dataverse read)', async () => {
  const res = mockRes();
  await handler(reqOf({ requestId: 'not-a-guid' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('auth gate short-circuits (requireAppAccess returns falsy)', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('happy path: generate, persist, stamp Drafted from null status', async () => {
  DynamicsService.getRecord.mockResolvedValue(row());
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(loadModelOverrides).toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.body.abstractFormatted).toBe(FORMATTED);
  expect(res.body.persisted).toBe(true);
  const [, , patch, opts] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch).toEqual({ wmkf_abstractformatted: FORMATTED });
  expect(opts).toMatchObject({ ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
  expect(patchDeliverable).toHaveBeenCalledWith(GUID, {
    wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.DRAFTED,
  }, { ifMatch: 'W/"2"', actingUserSystemId: 'sys-1' });
});

test('reuse-existing: populated abstract + no regenerate → no paid call', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractformatted: 'already here' }));
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body.reused).toBe(true);
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  // Reuse path must not do pre-generation work either (Codex post-impl #5).
  expect(loadModelOverrides).not.toHaveBeenCalled();
});

test('regenerate is honored only for strict boolean true (string "true" still reuses)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractformatted: 'already here' }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID, regenerate: 'true' }), res);
  expect(res.body.reused).toBe(true);
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
});

test('regenerate=true overwrites an existing abstract', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractformatted: 'old' }));
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.DRAFTED));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID, regenerate: true }), res);
  expect(generateGranteeAbstract).toHaveBeenCalled();
  expect(res.body.regenerated).toBe(true);
});

test('STATUS NON-DOWNGRADE: regenerate at Invited keeps Invited (patch omits status)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstractformatted: 'old' }));
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID, regenerate: true }), res);
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patch.wmkf_abstractformatted).toBe(FORMATTED);
  expect(patchDeliverable).not.toHaveBeenCalled();
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
});

test('missing source abstract → 400 (before generation)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ wmkf_abstract: 'too short' }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(400);
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
});

test('no _etag (undefined) → 503 fail-closed, before the paid generation', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ _etag: undefined }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(503);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  // 503 must fire BEFORE the paid LLM call (Codex post-impl).
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
});

test('null _etag also → 503 (guard treats null as missing)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row({ _etag: null }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(503);
  expect(generateGranteeAbstract).not.toHaveBeenCalled();
});

test('STATUS NON-DOWNGRADE handles a numeric-STRING status from the API', async () => {
  // Dataverse may return the option value as a string; normStatus must coerce it
  // so an Invited row (as "100000001") still omits the status from the patch.
  DynamicsService.getRecord.mockResolvedValue(row({
    wmkf_abstractformatted: 'old',
  }));
  ensureDeliverableForRequest.mockResolvedValue(deliverable(String(GRANTEE_DELIVERABLE_STATUS.INVITED)));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID, regenerate: true }), res);
  const [, , patch] = DynamicsService.updateRecord.mock.calls[0];
  expect(patchDeliverable).not.toHaveBeenCalled();
  expect(res.body.status).toBe(GRANTEE_DELIVERABLE_STATUS.INVITED);
});

test('a non-412 update failure → 500 (not swallowed as success)', async () => {
  DynamicsService.getRecord.mockResolvedValue(row());
  DynamicsService.updateRecord.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(500);
});

test('request not found → 404', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('boom'));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(404);
});

test('412 + now-populated → 200 reused/concurrent (no raw 412)', async () => {
  DynamicsService.getRecord
    .mockResolvedValueOnce(row())  // first read
    .mockResolvedValueOnce({ wmkf_abstractformatted: 'peer wrote this' }); // re-read after 412
  ensureDeliverableForRequest.mockResolvedValue(deliverable(GRANTEE_DELIVERABLE_STATUS.DRAFTED));
  DynamicsService.updateRecord.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body.reused).toBe(true);
  expect(res.body.concurrent).toBe(true);
  expect(res.body.abstractFormatted).toBe('peer wrote this');
});

test('412 + still empty → 409', async () => {
  DynamicsService.getRecord
    .mockResolvedValueOnce(row())
    .mockResolvedValueOnce({ wmkf_abstractformatted: null });
  DynamicsService.updateRecord.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = mockRes();
  await handler(reqOf({ requestId: GUID }), res);
  expect(res.statusCode).toBe(409);
});
