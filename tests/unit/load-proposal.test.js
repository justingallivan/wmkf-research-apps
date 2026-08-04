/**
 * @jest-environment node
 */
/**
 * /api/reviewer-finder/load-proposal — contract test written BEFORE converting
 * the raw `DynamicsService.getRecord('akoya_requests', ...)` call to the
 * grant-request adapter's `getById` (Wave 5 conversion, data-access-layer
 * migration plan). Pins the golden-path response DTO shape and the
 * not-found failure path so the conversion is provably behavior-preserving.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: {} } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const getRecord = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: (...a) => getRecord(...a) },
}));

const listFiles = jest.fn();
const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    listFiles: (...a) => listFiles(...a),
    downloadFileByPath: (...a) => downloadFileByPath(...a),
  },
}));

const getRequestSharePointBuckets = jest.fn();
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...a) => getRequestSharePointBuckets(...a),
}));

const put = jest.fn();
const head = jest.fn();
jest.mock('@vercel/blob', () => ({
  put: (...a) => put(...a),
  head: (...a) => head(...a),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

import handler from '../../pages/api/reviewer-finder/load-proposal';
import { requireAppAccess } from '../../lib/utils/auth';

const VALID_GUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function res() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function post(body) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: {} } });
  // Default: cache miss, so pre-existing tests (all written against the
  // download+put path) are unaffected by the Step 1 blob-cache addition in
  // lib/services/reviewer-finder/load-proposal-service.js.
  head.mockRejectedValue(new Error('not found'));
});

test('rejects non-POST (405)', async () => {
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
});

test('stops when auth fails', async () => {
  requireAppAccess.mockImplementation(async (req, resp) => {
    resp.status(401).json({ error: 'Authentication required' });
    return null;
  });
  const r = res();
  await handler(post({ requestId: VALID_GUID }), r);
  expect(getRecord).not.toHaveBeenCalled();
  expect(r.statusCode).toBe(401);
  expect(r.body).toEqual({ error: 'Authentication required' });
});

test('400s when requestId is missing', async () => {
  const r = res();
  await handler(post({}), r);
  expect(r.statusCode).toBe(400);
});

test('400s on a non-GUID requestId', async () => {
  const r = res();
  await handler(post({ requestId: 'not-a-guid' }), r);
  expect(r.statusCode).toBe(400);
  expect(getRecord).not.toHaveBeenCalled();
});

test('404s when the request has no request number', async () => {
  getRecord.mockResolvedValue(null);
  const r = res();
  await handler(post({ requestId: VALID_GUID }), r);
  expect(getRecord).toHaveBeenCalledWith('akoya_requests', VALID_GUID, {
    select: 'akoya_requestid,akoya_requestnum',
  });
  expect(r.statusCode).toBe(404);
});

test('golden path: downloads the exact canonical reviewer proposal and uploads it to Blob', async () => {
  getRecord.mockResolvedValue({ akoya_requestid: VALID_GUID, akoya_requestnum: '1002836' });
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'FOLDER', source: 'dynamics' },
  ]);
  listFiles.mockResolvedValue([
    {
      name: 'Proposal_1002836.pdf',
      size: 100,
      mimeType: 'application/pdf',
      lastModified: '2026-01-01',
      folder: 'FOLDER/Reviewer Materials',
    },
  ]);
  downloadFileByPath.mockResolvedValue({
    buffer: Buffer.from('x'),
    filename: 'Proposal_1002836.pdf',
    mimeType: 'application/pdf',
    size: 100,
  });
  put.mockResolvedValue({ url: 'https://blob.example/proposal.pdf' });

  const r = res();
  await handler(post({ requestId: VALID_GUID }), r);

  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({
    success: true,
    blobUrl: 'https://blob.example/proposal.pdf',
    filename: 'Proposal_1002836.pdf',
    contentType: 'application/pdf',
    size: 100,
    requestNumber: '1002836',
  });
  expect(r.body.picked)
    .toBe('akoya_request::FOLDER/Reviewer Materials::Proposal_1002836.pdf');
  expect(r.body).toEqual({
    success: true,
    blobUrl: 'https://blob.example/proposal.pdf',
    filename: 'Proposal_1002836.pdf',
    contentType: 'application/pdf',
    size: 100,
    picked: 'akoya_request::FOLDER/Reviewer Materials::Proposal_1002836.pdf',
    requestNumber: '1002836',
    allFiles: [{
      name: 'Proposal_1002836.pdf',
      size: 100,
      mimeType: 'application/pdf',
      lastModified: '2026-01-01',
      library: 'akoya_request',
      folder: 'FOLDER/Reviewer Materials',
      source: 'dynamics',
      classification: 'proposal',
    }],
  });
});

test('404s with { error, libraries } when no SharePoint files are found for the request', async () => {
  getRecord.mockResolvedValue({ akoya_requestid: VALID_GUID, akoya_requestnum: '1002836' });
  getRequestSharePointBuckets.mockResolvedValue([{ library: 'akoya_request', folder: 'FOLDER' }]);
  listFiles.mockResolvedValue([]);

  const r = res();
  await handler(post({ requestId: VALID_GUID }), r);

  expect(r.statusCode).toBe(404);
  expect(r.body).toEqual({
    error: 'No SharePoint files found for this request.',
    requestNumber: '1002836',
    libraries: [{ library: 'akoya_request', folder: 'FOLDER', error: null }],
  });
});

test('400s with { error, allFiles } when an explicit fileKey override is not found', async () => {
  getRecord.mockResolvedValue({ akoya_requestid: VALID_GUID, akoya_requestnum: '1002836' });
  getRequestSharePointBuckets.mockResolvedValue([{ library: 'akoya_request', folder: 'FOLDER' }]);
  listFiles.mockResolvedValue([
    { name: 'Project Narrative.pdf', size: 100, mimeType: 'application/pdf', lastModified: '2026-01-01', folder: 'FOLDER' },
  ]);

  const r = res();
  await handler(post({ requestId: VALID_GUID, fileKey: 'nope::nope::nope' }), r);

  expect(r.statusCode).toBe(400);
  expect(r.body.error).toBe("fileKey not found in this request's libraries: nope::nope::nope");
  expect(Array.isArray(r.body.allFiles)).toBe(true);
});
