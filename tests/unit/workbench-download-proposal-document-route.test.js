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
const REVIEWER_FOLDER = `1002794_${GUID_SUFFIX}/Reviewer Materials`;
const REVIEWER_FILENAME = 'Proposal_1002794.pdf';
const AI_FOLDER = `1002794_${GUID_SUFFIX}/AI Materials`;
const AI_FILENAME = 'ProposalNarrative_1002794.pdf';

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
    reviewerMaterials: [{ library: 'Documents', folder: REVIEWER_FOLDER, name: REVIEWER_FILENAME }],
    aiMaterials: [{ found: true, library: 'Documents', folder: AI_FOLDER, name: AI_FILENAME }],
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

test('unauthenticated caller: short-circuit, no request/document work attempted', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler(reqOf(query()), res);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  expect(GraphService.downloadFileByPath).not.toHaveBeenCalled();
});

test('golden path: streams the requested file with proxied headers (full envelope pin)', async () => {
  const res = mockRes();
  await handler(reqOf(query()), res);
  expect(res.statusCode).toBe(200);
  expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', REQUEST_ID, {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
  });
  expect(res.headers).toEqual({
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="proposal.pdf"',
    'Content-Length': 9,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  expect(res.body).toEqual(Buffer.from('pdf-bytes'));
});

test('?disposition=inline on a safe MIME type serves inline; unsafe types stay attachment', async () => {
  const res = mockRes();
  await handler(reqOf({ ...query(), disposition: 'inline' }), res);
  expect(res.headers['Content-Disposition']).toBe('inline; filename="proposal.pdf"');
});

test('canonical AI Materials path passes request ownership and membership checks', async () => {
  GraphService.downloadFileByPath.mockResolvedValueOnce({
    buffer: Buffer.from('ai-pdf'),
    mimeType: 'application/pdf',
    filename: AI_FILENAME,
    size: 6,
  });
  const res = mockRes();
  await handler(reqOf(query({ folder: AI_FOLDER, filename: AI_FILENAME })), res);

  expect(res.statusCode).toBe(200);
  expect(GraphService.downloadFileByPath).toHaveBeenCalledWith('Documents', AI_FOLDER, AI_FILENAME);
  expect(res.headers['Content-Disposition']).toBe(`attachment; filename="${AI_FILENAME}"`);
  expect(res.body).toEqual(Buffer.from('ai-pdf'));
});

test('canonical Reviewer Materials path passes request ownership and membership checks', async () => {
  GraphService.downloadFileByPath.mockResolvedValueOnce({
    buffer: Buffer.from('reviewer-pdf'),
    mimeType: 'application/pdf',
    filename: REVIEWER_FILENAME,
    size: 12,
  });
  const res = mockRes();
  await handler(reqOf(query({ folder: REVIEWER_FOLDER, filename: REVIEWER_FILENAME })), res);

  expect(res.statusCode).toBe(200);
  expect(GraphService.downloadFileByPath).toHaveBeenCalledWith('Documents', REVIEWER_FOLDER, REVIEWER_FILENAME);
  expect(res.headers['Content-Disposition']).toBe(`attachment; filename="${REVIEWER_FILENAME}"`);
  expect(res.body).toEqual(Buffer.from('reviewer-pdf'));
});

test('folder GUID suffix mismatch → 403 before the wrapped scope check runs', async () => {
  const res = mockRes();
  await handler(reqOf(query({ folder: `1002794_${'0'.repeat(32)}/Phase I` })), res);
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({ error: 'Folder does not belong to the specified request' });
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
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
