/**
 * GET /api/workbench/download-proposal-document — characterization test written
 * BEFORE converting the route's raw `DynamicsService.getRecord('akoya_requests', ...)`
 * call to the grant-request adapter (Wave 5 conversion). Asserts the golden-path
 * response (proxied file stream + headers) and the "request not found" 404
 * failure path, against CURRENT behavior.
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
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: jest.fn() },
}));
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  listProposalDocuments: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { GraphService } from '../../lib/services/graph-service';
import { listProposalDocuments } from '../../lib/services/workbench-proposal-documents';
import handler from '../../pages/api/workbench/download-proposal-document';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const GUID_SUFFIX = REQUEST_ID.replace(/-/g, '').toUpperCase();

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}

function reqOf(query) {
  return { method: 'GET', query };
}

const query = (over = {}) => ({
  requestId: REQUEST_ID,
  library: 'Documents',
  folder: `1002794_${GUID_SUFFIX}/Phase I`,
  filename: 'proposal.pdf',
  ...over,
});

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.getRecord.mockReset().mockResolvedValue({
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002794',
    wmkf_meetingdate: '2026-06-01',
  });
  listProposalDocuments.mockReset().mockResolvedValue({
    slots: [{ found: true, library: 'Documents', folder: `1002794_${GUID_SUFFIX}/Phase I`, name: 'proposal.pdf' }],
    otherDocuments: [],
  });
  GraphService.downloadFileByPath.mockReset().mockResolvedValue({
    buffer: Buffer.from('pdf-bytes'),
    mimeType: 'application/pdf',
    filename: 'proposal.pdf',
    size: 9,
  });
});

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('golden path: streams the requested file with proxied headers', async () => {
  const res = mockRes();
  await handler(reqOf(query()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
  });
  expect(res.headers['Content-Type']).toBe('application/pdf');
  expect(res.headers['Content-Length']).toBe(9);
  expect(res.body).toEqual(Buffer.from('pdf-bytes'));
});

test('request not found → 404, no download attempted', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('not found'));
  const res = mockRes();
  await handler(reqOf(query()), res);
  expect(res.statusCode).toBe(404);
  expect(GraphService.downloadFileByPath).not.toHaveBeenCalled();
});

test('file not in the resolved slot/other-document set → 403', async () => {
  const res = mockRes();
  await handler(reqOf(query({ filename: 'not-listed.pdf' })), res);
  expect(res.statusCode).toBe(403);
  expect(GraphService.downloadFileByPath).not.toHaveBeenCalled();
});
