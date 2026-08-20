/** @jest-environment node */

jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  recordTokenOutcome: jest.fn(),
}));
jest.mock('../../lib/external/verify-grantee-token', () => ({ verifyGranteeToken: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)),
}));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { GRANTEE_IMAGE: 'grantee_image' },
  PortalUploadStagingError: class PortalUploadStagingError extends Error {},
  createPortalUpload: jest.fn(),
  externalGranteeActorBinding: jest.fn(() => 'grantee:hash'),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyGranteeToken } from '../../lib/external/verify-grantee-token';
import { createPortalUpload } from '../../lib/services/portal-upload-staging';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/external/grantee/[token]/upload-token';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function res() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function req(body = {}, method = 'POST') {
  return { method, body, query: { token: 'external-token' }, headers: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  recordTokenOutcome.mockResolvedValue(undefined);
  verifyGranteeToken.mockResolvedValue({
    ok: true,
    requestId: REQUEST_ID,
    deliverable: { wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED, _etag: 'W/"1"' },
  });
  createPortalUpload.mockResolvedValue({
    stagingId: 'stage', pathname: 'portal-staging/x', clientToken: 'client-token', access: 'private',
  });
});

test('mints only after external token verification and server-derived binding', async () => {
  const response = res();
  await handler(req({ filename: 'figure.png', contentType: 'image/png', size: 1024 }), response);
  expect(response.statusCode).toBe(200);
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 'external-token', true);
  expect(createPortalUpload).toHaveBeenCalledWith(expect.objectContaining({
    scope: 'grantee_image',
    resourceId: REQUEST_ID,
    actorBinding: 'grantee:hash',
    filename: 'figure.png',
    contentType: 'image/png',
    originalEtag: 'W/"1"',
  }));
});

test('invalid token cannot mint', async () => {
  verifyGranteeToken.mockResolvedValue({ ok: false, reason: 'invalid_claim' });
  const response = res();
  await handler(req({ filename: 'figure.png', contentType: 'image/png', size: 1024 }), response);
  expect(response.statusCode).toBe(401);
  expect(createPortalUpload).not.toHaveBeenCalled();
});

test('non-editable package cannot mint', async () => {
  verifyGranteeToken.mockResolvedValue({
    ok: true, requestId: REQUEST_ID,
    deliverable: { wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.COMPLETE },
  });
  const response = res();
  await handler(req({ filename: 'figure.png', contentType: 'image/png', size: 1024 }), response);
  expect(response.statusCode).toBe(409);
  expect(createPortalUpload).not.toHaveBeenCalled();
});

test('oversize declaration is rejected before mint', async () => {
  const response = res();
  await handler(req({ filename: 'figure.png', contentType: 'image/png', size: 10 * 1024 * 1024 + 1 }), response);
  expect(response.statusCode).toBe(400);
  expect(createPortalUpload).not.toHaveBeenCalled();
});
