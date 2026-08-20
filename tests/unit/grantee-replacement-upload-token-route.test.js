/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)),
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
}));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { STAFF_GRANTEE_IMAGE: 'staff_grantee_image' },
  PortalUploadStagingError: class PortalUploadStagingError extends Error {},
  createPortalUpload: jest.fn(),
  staffActorBinding: jest.fn(() => 'profile:7'),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { getDeliverableForRequest } from '../../lib/services/grantee-deliverable-record';
import { createPortalUpload } from '../../lib/services/portal-upload-staging';
import handler from '../../pages/api/workbench/grantee-deliverables/replacement-upload-token';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const ETAG = 'W/"d1"';

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function request(body = {}) { return { method: 'POST', body, headers: {}, query: {} }; }

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } });
  getDeliverableForRequest.mockResolvedValue({
    wmkf_granteedeliverableid: 'd1', wmkf_deliverablestatus: 100000003, _etag: ETAG,
  });
  createPortalUpload.mockResolvedValue({ stagingId: 'stage', pathname: 'portal-staging/x', clientToken: 'token' });
});

test('staff mint is profile-, request-, and ETag-bound', async () => {
  const res = response();
  await handler(request({ requestId: REQUEST_ID, filename: 'new.png', contentType: 'image/png', size: 100, etag: ETAG }), res);
  expect(res.statusCode).toBe(200);
  expect(createPortalUpload).toHaveBeenCalledWith(expect.objectContaining({
    scope: 'staff_grantee_image', resourceId: REQUEST_ID, actorBinding: 'profile:7', originalEtag: ETAG,
  }));
});

test('auth failure cannot mint', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = response();
  await handler(request({ requestId: REQUEST_ID }), res);
  expect(createPortalUpload).not.toHaveBeenCalled();
});

test('stale ETag cannot mint', async () => {
  const res = response();
  await handler(request({ requestId: REQUEST_ID, filename: 'new.png', contentType: 'image/png', size: 100, etag: 'W/"old"' }), res);
  expect(res.statusCode).toBe(409);
  expect(createPortalUpload).not.toHaveBeenCalled();
});
