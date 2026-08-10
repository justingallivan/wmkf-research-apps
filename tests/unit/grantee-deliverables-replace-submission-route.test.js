/**
 * POST /api/workbench/grantee-deliverables/replace-submission — S412.
 *
 * Direct thin-shell coverage with real multipart request streams. The service is
 * mocked; these tests pin auth, parsed-input guards, DAL context, propagation,
 * and busboy's file-count/size limits at the route trust boundary.
 *
 * @jest-environment node
 */
import { Readable } from 'stream';

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)),
}));
jest.mock('../../lib/services/grantee-upload', () => ({
  MAX_IMAGE_BYTES: 16,
}));
jest.mock('../../lib/services/workbench/grantee-deliverables/replace-submission-service', () => ({
  replaceGranteeSubmission: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { replaceGranteeSubmission } from '../../lib/services/workbench/grantee-deliverables/replace-submission-service';
import handler from '../../pages/api/workbench/grantee-deliverables/replace-submission';

const GUID = '22222222-2222-2222-2222-222222222222';
const ETAG = 'W/"d1"';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, sends: 0 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.sends += 1; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  return res;
}

function multipartReq({ fields = {}, files = [] } = {}) {
  const boundary = '----wmkf-replace-route-test';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }
  for (const file of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.mimeType || 'image/png'}\r\n\r\n`,
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const req = Readable.from([body]);
  req.method = 'POST';
  req.query = {};
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  return req;
}

function malformedMultipartReq() {
  const req = Readable.from([Buffer.from('not a multipart body')]);
  req.method = 'POST';
  req.query = {};
  req.headers = { 'content-type': 'multipart/form-data' };
  return req;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 'profile-1',
    session: { user: { dynamicsSystemuserId: 'system-user-1' } },
  });
  replaceGranteeSubmission.mockResolvedValue({ ok: true, etag: 'W/"d2"' });
});

test('auth gate short-circuits before multipart parsing or service work', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler(multipartReq({ fields: { requestId: GUID, caption: 'Revised.', etag: ETAG } }), res);
  expect(res.sends).toBe(0);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('valid multipart fields and file reach the service inside a trusted DAL context', async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const res = mockRes();
  await handler(multipartReq({
    fields: { requestId: ` ${GUID} `, caption: 'Revised caption.', etag: ` ${ETAG} ` },
    files: [{ filename: 'replacement.png', mimeType: 'image/png', buffer: bytes }],
  }), res);

  expect(withDalContext).toHaveBeenCalledWith('grantee-submission-replace', expect.any(Function));
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(replaceGranteeSubmission).toHaveBeenCalledWith({
    requestId: GUID,
    caption: 'Revised caption.',
    imageFile: { filename: 'replacement.png', mimeType: 'image/png', buffer: bytes },
    clientEtag: ETAG,
    actingUserSystemId: 'system-user-1',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true, etag: 'W/"d2"' });
});

test.each([
  ['missing', undefined],
  ['invalid', 'not-a-guid'],
])('%s requestId returns 400 before DAL context or service work', async (_label, requestId) => {
  const fields = { caption: 'Revised.', etag: ETAG };
  if (requestId !== undefined) fields.requestId = requestId;
  const res = mockRes();
  await handler(multipartReq({ fields }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('an overlong caption returns 400 before DAL context or service work', async () => {
  const res = mockRes();
  await handler(multipartReq({
    fields: { requestId: GUID, caption: 'x'.repeat(2001), etag: ETAG },
  }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('an oversized file returns 400 before DAL context or service work', async () => {
  const res = mockRes();
  await handler(multipartReq({
    fields: { requestId: GUID, etag: ETAG },
    files: [{ filename: 'too-large.png', buffer: Buffer.alloc(17, 1) }],
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'The image is too large.' });
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('more than one file returns 400 before DAL context or service work', async () => {
  const res = mockRes();
  await handler(multipartReq({
    fields: { requestId: GUID, etag: ETAG },
    files: [
      { filename: 'one.png', buffer: Buffer.from([1]) },
      { filename: 'two.png', buffer: Buffer.from([2]) },
    ],
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'Only one image can be uploaded.' });
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('neither caption nor file returns 400 before DAL context or service work', async () => {
  const res = mockRes();
  await handler(multipartReq({ fields: { requestId: GUID, etag: ETAG } }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});

test('malformed multipart returns 400 before DAL context or service work', async () => {
  const res = mockRes();
  await handler(malformedMultipartReq(), res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'Could not read the upload.' });
  expect(withDalContext).not.toHaveBeenCalled();
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});
