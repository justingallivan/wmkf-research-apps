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
// lib/services/grantee-submit-notification (called by the route) re-reads the request
// for the PI name — verify-grantee-token's projection does not carry it — and resolves
// the PD email through the shared program-director-resolver, which normalizes and
// caches. Mocked here so the route test drives the real notification service.
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveProgramDirectorEmailForRequest: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { writeGranteeDeliverables } from '../../lib/services/grantee-upload';
import { verifyWaiverRenderToken } from '../../lib/services/external-token';
import NotificationService from '../../lib/services/notification-service';
import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import { resolveProgramDirectorEmailForRequest } from '../../lib/services/program-director-resolver';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import { NOTIFY_BUDGET_MS, notifyGranteeSubmission } from '../../lib/services/grantee-submit-notification';
import handler from '../../pages/api/external/grantee/[token]/submit';

const VER = '33333333-3333-3333-3333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  // The success path responds BEFORE notifying, so the route checks headersSent
  // before any late error re-send. Mirror that here, and count sends so a
  // double-response would be visible rather than silently overwriting body.
  res.sends = 0;
  res.headersSent = false;
  const json = res.json;
  res.json = (b) => { res.sends += 1; res.headersSent = true; return json(b); };
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
    _wmkf_projectleader_value: 'pi-1',
    _wmkf_projectleader_value_formatted: 'Dr. Ada Lovelace',
  });
  resolveProgramDirectorEmailForRequest.mockReset().mockResolvedValue('pd@wmkf.example');
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
    // Resolved by request id through the shared resolver — NOT read off the
    // token-verified request object, whose projection carries no PD field.
    expect(resolveProgramDirectorEmailForRequest).toHaveBeenCalledWith('r1');
    // And the PI name comes from a FRESH request read for the same reason.
    expect(grantRequestAdapter.getById).toHaveBeenCalledWith('r1', expect.objectContaining({
      select: expect.stringContaining('_wmkf_projectleader_value'),
    }));
  });

  test('notify throws → submit still 200 (a completed submission must not fail)', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    NotificationService.notify.mockRejectedValue(new Error('smtp down'));
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.sends).toBe(1);
  });

  // The 200 must be on the wire BEFORE the notification is waited on: the platform
  // can end the invocation any time after the changeset, and an in-service budget
  // cannot know how much of the deadline the scan + upload + changeset already used.
  // (The notification promise is *started* just before the send, then handed to the
  // runtime via keepAlive — so what matters is that notify never blocks the 200.)
  test('the 200 is written before the notification is awaited', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    const res = mockRes();
    let sentBeforeNotifyResolved = null;
    NotificationService.notify.mockImplementation(async () => {
      // Yield once so the handler reaches res.json() while this is still pending.
      await new Promise((r) => setTimeout(r, 5));
      sentBeforeNotifyResolved = { sends: res.sends, status: res.statusCode, body: res.body };
      return {};
    });
    await handler(successReq(), res);

    expect(sentBeforeNotifyResolved).toEqual({ sends: 1, status: 200, body: { ok: true } });
    expect(res.sends).toBe(1); // and never re-sent afterwards
  });

  test('a throw after the response is not re-sent as a 500', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    // Force a post-response throw past the service's own swallow.
    grantRequestAdapter.getById.mockImplementation(() => { throw new Error('boom'); });
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.sends).toBe(1);
  });

  test('PD resolution yields nothing → still notifies, empty explicitRecipients, PI name KEPT', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    // The shared resolver swallows its own failures and returns null.
    resolveProgramDirectorEmailForRequest.mockResolvedValue(null);
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    expect(notifyArg().explicitRecipients).toEqual([]);
    // The two reads degrade independently — a failed PD lookup must not discard a
    // PI name the request read already produced.
    expect(notifyArg().metadata.pi).toBe('Dr. Ada Lovelace');
    expect(notifyArg().message).toContain('Dr. Ada Lovelace');
  });

  test('request read throws → still notifies, nothing resolved', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    grantRequestAdapter.getById.mockRejectedValue(new Error('dataverse 503'));
    const res = mockRes();
    await handler(successReq(), res);

    expect(res.statusCode).toBe(200);
    expect(notifyArg().metadata.pi).toBeNull();
    // The PD lookup is independent of the PI read, so it still ran and still landed.
    expect(notifyArg().explicitRecipients).toEqual(['pd@wmkf.example']);
  });

  // A committed submit must not be held hostage by a hanging notification: the
  // platform could kill the invocation before the 200 is written, and the grantee
  // would see a timeout on a package that DID commit (their retry then 409s).
  // Driven on the service directly with a tiny budget — fake timers deadlock the
  // route's multipart stream, and the route does not thread budgetMs through.
  test('hanging notify → the service still resolves, bounded by its budget', async () => {
    NotificationService.notify.mockReturnValue(new Promise(() => {})); // never settles
    const started = Date.now();
    await expect(notifyGranteeSubmission({
      requestId: 'r1', requestNum: '1002794', title: 't',
      hasImage: true, captionPresent: true, budgetMs: 25,
    })).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  // The budget is a leak stop, not a delivery deadline: the route already responded
  // and handed the promise to the runtime, so cutting off too early would abandon
  // sends that were about to succeed. Bounded, but generous.
  test('the shipped default budget is bounded but not tight', () => {
    expect(NOTIFY_BUDGET_MS).toBeGreaterThanOrEqual(10000);
    expect(NOTIFY_BUDGET_MS).toBeLessThanOrEqual(30000);
  });

  // Disabled PD / no PD assigned both surface as a null from the shared resolver,
  // whose own suite covers those branches. Here: a null must not become a recipient.
  test('no resolvable PD → still notifies, no empty-string recipient', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    resolveProgramDirectorEmailForRequest.mockResolvedValue(null);
    await handler(successReq(), mockRes());

    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
    expect(notifyArg().explicitRecipients).toEqual([]);
  });

  // REGRESSION: AlertRecipients lowercases category recipients and sendAdminEmail
  // dedupes the union with a case-SENSITIVE Set, so an un-normalized PD address
  // would survive as a second entry and email the PD twice. The shared resolver
  // trims + lowercases; this pins that we go through it rather than round our own.
  test('the PD address is the normalized one from the shared resolver', async () => {
    verifyGranteeToken.mockResolvedValue(okVerify(GRANTEE_DELIVERABLE_STATUS.INVITED));
    resolveProgramDirectorEmailForRequest.mockResolvedValue('pd@wmkf.example');
    await handler(successReq(), mockRes());

    expect(resolveProgramDirectorEmailForRequest).toHaveBeenCalledWith('r1');
    const [addr] = notifyArg().explicitRecipients;
    expect(addr).toBe(addr.trim().toLowerCase());
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

  // A resubmit from REVISION_REQUESTED (an editable status) with no new file keeps
  // the existing image: the writer patches wmkf_imagefileref only when it uploaded
  // something. hasImage describes the package after the submit, not the multipart.
  test('resubmit with no new file but a retained image → hasImage true', async () => {
    const v = okVerify(GRANTEE_DELIVERABLE_STATUS.REVISION_REQUESTED);
    v.deliverable.wmkf_imagefileref = 'https://wmkf.sharepoint.com/x/fig.png';
    verifyGranteeToken.mockResolvedValue(v);
    await handler(multipartReq({
      fields: { editedAbstract: 'x', caption: 'kept', waiverToken: 'signed.tok' },
    }), mockRes());

    expect(notifyArg().metadata.hasImage).toBe(true);
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
