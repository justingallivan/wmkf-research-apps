/**
 * GET /api/workbench/proposal-documents — characterization test written BEFORE
 * converting the route's raw `DynamicsService.getRecord('akoya_requests', ...)`
 * call to the grant-request adapter (Wave 5 conversion). Asserts the golden-path
 * DTO shape and the "request not found" 404 failure path, against CURRENT
 * behavior.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  listProposalDocuments: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { listProposalDocuments } from '../../lib/services/workbench-proposal-documents';
import handler from '../../pages/api/workbench/proposal-documents';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (query) => ({ method: 'GET', query });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.getRecord.mockReset().mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002794',
    wmkf_meetingdate: '2026-06-01',
  });
  listProposalDocuments.mockReset().mockResolvedValue({
    slots: [{ found: true, library: 'Documents', folder: 'x', name: 'proposal.pdf' }],
    aiMaterials: [],
    otherDocuments: [],
    libraries: ['Documents'],
    errors: [],
  });
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('unauthenticated caller: short-circuit, no request/document work attempted', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(listProposalDocuments).not.toHaveBeenCalled();
});

test('missing/invalid requestId → 400, no read attempted', async () => {
  let res = mockRes();
  await handler(reqOf({}), res);
  expect(res.statusCode).toBe(400);

  res = mockRes();
  await handler(reqOf({ requestId: 'not-a-guid' }), res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('golden path: resolves scope from the record, not the raw query param', async () => {
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
  });
  expect(listProposalDocuments).toHaveBeenCalledWith(REQUEST_ID, '1002794', 'J26');
  expect(res.body).toEqual({
    success: true,
    slots: [{ found: true, library: 'Documents', folder: 'x', name: 'proposal.pdf' }],
    aiMaterials: [],
    otherDocuments: [],
    libraries: ['Documents'],
    errors: [],
  });
});

test('request not found → 404, no document listing attempted', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('not found'));
  const res = mockRes();
  await handler(reqOf({ requestId: REQUEST_ID }), res);
  expect(res.statusCode).toBe(404);
  expect(listProposalDocuments).not.toHaveBeenCalled();
});
