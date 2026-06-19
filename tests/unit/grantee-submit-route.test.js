/**
 * POST /api/external/grantee/[token]/submit — chunk 5 route.
 * Guard order (method/rate-limit/token/status), multipart parse → service call,
 * result mapping. The service (writeGranteeDeliverables) is unit-tested separately.
 *
 * @jest-environment node
 */
import { Readable } from 'stream';

jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/verify-grantee-token', () => ({ verifyGranteeToken: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));
jest.mock('../../lib/services/grantee-upload', () => ({
  writeGranteeDeliverables: jest.fn(),
  MAX_IMAGE_BYTES: 15 * 1024 * 1024,
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { writeGranteeDeliverables } from '../../lib/services/grantee-upload';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/external/grantee/[token]/submit';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

function plainReq(method = 'POST') {
  return { method, query: { token: 't' }, headers: {} };
}

function multipartReq({ fields = {}, file } = {}) {
  const boundary = '----tb';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.filename}"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const req = Readable.from(Buffer.concat(parts));
  req.method = 'POST';
  req.query = { token: 't' };
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return req;
}

const okVerify = (status = GRANTEE_DELIVERABLE_STATUS.INVITED) => ({
  ok: true, requestId: 'r1', request: { akoya_requestid: 'r1', akoya_requestnum: '1002794', wmkf_granteedeliverablestatus: status, _etag: 'W/"1"' },
});

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ ok: true });
  recordTokenOutcome.mockReset().mockResolvedValue(undefined);
  verifyGranteeToken.mockReset();
  writeGranteeDeliverables.mockReset().mockResolvedValue({ ok: true });
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler(plainReq('GET'), res);
  expect(res.statusCode).toBe(405);
});

test('rate-limited → 429 before verify', async () => {
  checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
  const res = mockRes();
  await handler(plainReq(), res);
  expect(res.statusCode).toBe(429);
  expect(verifyGranteeToken).not.toHaveBeenCalled();
});

test('invalid token → 401 + reason, outcome recorded', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'invalid_claim' });
  const res = mockRes();
  await handler(plainReq(), res);
  expect(res.statusCode).toBe(401);
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 't', false);
});

test('FAIL-CLOSED: non-editable status (Complete) → 409, service not called', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.COMPLETE));
  const res = mockRes();
  await handler(plainReq(), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.reason).toBe('not_editable');
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
});

test('FAIL-CLOSED: null status → 409', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(null));
  const res = mockRes();
  await handler(plainReq(), res);
  expect(res.statusCode).toBe(409);
});

test('happy path: parses multipart, calls service, returns 200', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'the approved abstract text', caption: 'A figure.' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  }), res);

  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true });
  const arg = writeGranteeDeliverables.mock.calls[0][0];
  expect(arg.editedAbstract).toBe('the approved abstract text');
  expect(arg.caption).toBe('A figure.');
  expect(arg.imageFile.filename).toBe('fig.png');
  expect(Buffer.isBuffer(arg.imageFile.buffer)).toBe(true);
  expect(arg.request.akoya_requestid).toBe('r1');
});

test('maps a service failure status/reason through (e.g. image_invalid 400)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  writeGranteeDeliverables.mockResolvedValue({ ok: false, reason: 'image_invalid', status: 400 });
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('image_invalid');
});
