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
  // Small cap so a tiny over-cap file exercises the busboy fileSize limit branch.
  MAX_IMAGE_BYTES: 16,
}));
jest.mock('../../lib/services/external-token', () => ({ verifyWaiverRenderToken: jest.fn() }));
jest.mock('../../lib/services/notification-service', () => ({ __esModule: true, default: { notify: jest.fn() } }));
// The submitted-notification path re-reads the request for the PD/PI lookup values
// (verify-grantee-token's projection carries neither) and then reads the PD user.
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user.js', () => ({ getByIdWithSelect: jest.fn() }));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { writeGranteeDeliverables } from '../../lib/services/grantee-upload';
import { verifyWaiverRenderToken } from '../../lib/services/external-token';
import NotificationService from '../../lib/services/notification-service';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as systemUserAdapter from '../../lib/dataverse/adapters/system-user.js';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/external/grantee/[token]/submit';

const VER = '33333333-3333-3333-3333-333333333333';

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

function multipartReq({ fields = {}, file, files } = {}) {
  const boundary = '----tb';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const fileList = files || (file ? [file] : []);
  for (const f of fileList) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${f.filename}"\r\nContent-Type: image/png\r\n\r\n`));
    parts.push(f.buffer);
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
  ok: true,
  requestId: 'r1',
  request: { akoya_requestid: 'r1', akoya_requestnum: '1002794', _etag: 'W/"1"' },
  deliverable: status === undefined ? null : {
    wmkf_granteedeliverableid: 'd1',
    wmkf_deliverablestatus: status,
    _etag: 'W/"2"',
  },
});

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue({ ok: true });
  recordTokenOutcome.mockReset().mockResolvedValue(undefined);
  verifyGranteeToken.mockReset();
  writeGranteeDeliverables.mockReset().mockResolvedValue({ ok: true });
  // Default: a valid render token bound to this request (r1) with a GUID version.
  verifyWaiverRenderToken.mockReset().mockResolvedValue({ valid: true, requestId: 'r1', versionId: VER, bodyHash: 'bodyhash-abc' });
  NotificationService.notify.mockReset().mockResolvedValue({});
  grantRequestAdapter.getById.mockReset().mockResolvedValue({
    _wmkf_programdirector_value: 'pd-1',
    _wmkf_projectleader_value: 'pi-1',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
  });
  systemUserAdapter.getByIdWithSelect.mockReset().mockResolvedValue({
    systemuserid: 'pd-1', internalemailaddress: 'pd@wmkf.example', isdisabled: false,
  });
});

/** The multipart body every success-path test uses. */
const successReq = () => multipartReq({
  fields: { editedAbstract: 'x', caption: 'A figure.', waiverToken: 'signed.tok' },
  file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
});

/** The notify() payload from the single expected call. */
const notifyArg = () => NotificationService.notify.mock.calls[0][0];

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

test('FAIL-CLOSED: missing deliverable row → 409', async () => {
  const v = okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED);
  v.deliverable = null;
  verifyGranteeToken.mockResolvedValue(v);
  const res = mockRes();
  await handler(plainReq(), res);
  expect(res.statusCode).toBe(409);
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
});

test('happy path: parses multipart, calls service, returns 200', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'the approved abstract text', caption: 'A figure.', waiverToken: 'signed.tok' },
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
  expect(arg.deliverable.wmkf_granteedeliverableid).toBe('d1');
  // The server-resolved (verified) version id + body hash are passed through.
  expect(arg.waiverVersionId).toBe(VER);
  expect(arg.waiverBodyHash).toBe('bodyhash-abc');
});

describe('submitted notification (best-effort, post-commit)', () => {
  test('success → one grantee_deliverable_submitted notification', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    expect(notifyArg().type).toBe('grantee_deliverable_submitted');
    expect(notifyArg().severity).toBe('info');
    // 'info' only emails when emailAdmins is set — without this the PD gets nothing.
    expect(notifyArg().emailAdmins).toBe(true);
    expect(notifyArg().category).toBe('grantee-deliverables');
    expect(notifyArg().metadata).toMatchObject({
      requestId: 'r1', requestNumber: '1002794', pi: 'Dr. Ada Lovelace',
      hasImage: true, captionPresent: true,
    });
  });

  // REGRESSION: the PD/PI fields are absent from verify-grantee-token's projection,
  // so reading them off `verified.request` yields undefined → empty recipients and a
  // silently undelivered notification. Assert the resolved ADDRESS, not just the call.
  test('PD address actually lands in explicitRecipients', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    await handler(successReq(), mockRes());

    expect(notifyArg().explicitRecipients).toEqual(['pd@wmkf.example']);
    // Resolved from a FRESH request read, not the token-verified request object.
    expect(grantRequestAdapter.getById).toHaveBeenCalledWith('r1', expect.objectContaining({
      select: expect.stringContaining('_wmkf_programdirector_value'),
    }));
  });

  test('notify throws → submit still 200 (a completed submission must not fail)', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    NotificationService.notify.mockRejectedValue(new Error('smtp down'));
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('PD read throws → still notifies, empty explicitRecipients', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    systemUserAdapter.getByIdWithSelect.mockRejectedValue(new Error('dataverse 503'));
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    expect(notifyArg().explicitRecipients).toEqual([]);
  });

  test('disabled PD is not a recipient', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    systemUserAdapter.getByIdWithSelect.mockResolvedValue({
      systemuserid: 'pd-1', internalemailaddress: 'pd@wmkf.example', isdisabled: true,
    });
    await handler(successReq(), mockRes());

    expect(notifyArg().explicitRecipients).toEqual([]);
  });

  test('no PD assigned → still notifies, no PD lookup', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    grantRequestAdapter.getById.mockResolvedValue({ _wmkf_programdirector_value: null });
    await handler(successReq(), mockRes());

    expect(notifyArg().explicitRecipients).toEqual([]);
    expect(systemUserAdapter.getByIdWithSelect).not.toHaveBeenCalled();
  });

  test('deep link is absolute against NEXTAUTH_URL (staff origin)', async () => {
    const prev = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://apps.wmkf.example/';
    try {
      verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
      await handler(successReq(), mockRes());
      expect(notifyArg().metadata.awardeeTabUrl).toBe('https://apps.wmkf.example/workbench/r1?tab=awardee');
      expect(notifyArg().message).toContain('https://apps.wmkf.example/workbench/r1?tab=awardee');
    } finally {
      if (prev === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = prev;
    }
  });

  test('no NEXTAUTH_URL → relative path, never a malformed https:/// URL', async () => {
    const prev = process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_URL;
    try {
      verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
      await handler(successReq(), mockRes());
      expect(notifyArg().metadata.awardeeTabUrl).toBe('/workbench/r1?tab=awardee');
      expect(notifyArg().message).not.toContain('https:///');
    } finally {
      if (prev !== undefined) process.env.NEXTAUTH_URL = prev;
    }
  });

  test('the raw caption never reaches the notification', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    await handler(multipartReq({
      fields: {
        editedAbstract: 'x',
        caption: '<img src=x onerror=alert(1)>',
        waiverToken: 'signed.tok',
      },
      file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
    }), mockRes());

    expect(JSON.stringify(notifyArg())).not.toContain('onerror');
    expect(notifyArg().metadata.captionPresent).toBe(true);
  });

  test('no image / no caption → flags false, still notifies', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    await handler(multipartReq({
      fields: { editedAbstract: 'x', caption: '   ', waiverToken: 'signed.tok' },
    }), mockRes());

    expect(notifyArg().metadata.hasImage).toBe(false);
    expect(notifyArg().metadata.captionPresent).toBe(false);
  });

  test('service failure → NO submitted notification', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    writeGranteeDeliverables.mockResolvedValue({ ok: false, reason: 'stale_row', status: 409 });
    await handler(successReq(), mockRes());

    expect(NotificationService.notify).not.toHaveBeenCalled();
  });
});

test('missing/expired render token (client stale) → 409 waiver_invalid, service NOT called, no alert', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  verifyWaiverRenderToken.mockResolvedValue({ valid: false, reason: 'expired' });
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c', waiverToken: 'stale' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
  }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.reason).toBe('waiver_invalid');
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
  expect(NotificationService.notify).not.toHaveBeenCalled(); // plain staleness is not alert-worthy
});

test('render token for a DIFFERENT request → 409 + operator alert (suspicious), service NOT called', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  verifyWaiverRenderToken.mockResolvedValue({ valid: true, requestId: 'SOMEONE_ELSE', versionId: VER });
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c', waiverToken: 'foreign' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
  }), res);
  expect(res.statusCode).toBe(409);
  expect(res.body.reason).toBe('waiver_invalid');
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledTimes(1);
});

test('render token version is not a GUID → 409 + alert (defensive; would be a bad selector)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  verifyWaiverRenderToken.mockResolvedValue({ valid: true, requestId: 'r1', versionId: "not-a-guid') or 1=1--" });
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c', waiverToken: 'x' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
  }), res);
  expect(res.statusCode).toBe(409);
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledTimes(1);
});

test('busboy FILE_TOO_LARGE → 400 image_too_large, service not called', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c' },
    file: { filename: 'fig.png', buffer: Buffer.alloc(64, 1) }, // > 16-byte mock cap
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('image_too_large');
  expect(writeGranteeDeliverables).not.toHaveBeenCalled();
});

test('busboy TOO_MANY_FILES → 400 too_many_files', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c' },
    files: [
      { filename: 'a.png', buffer: Buffer.from([1, 2]) },
      { filename: 'b.png', buffer: Buffer.from([3, 4]) },
    ],
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('too_many_files');
});

test('maps a service failure status/reason through (e.g. image_invalid 400)', async () => {
  verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
  writeGranteeDeliverables.mockResolvedValue({ ok: false, reason: 'image_invalid', status: 400 });
  const res = mockRes();
  await handler(multipartReq({
    fields: { editedAbstract: 'x', caption: 'c', waiverToken: 'signed.tok' },
    file: { filename: 'fig.png', buffer: Buffer.from([0x89, 0x50]) },
  }), res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('image_invalid');
});
