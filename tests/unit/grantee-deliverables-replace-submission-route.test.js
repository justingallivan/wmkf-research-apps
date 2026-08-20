/**
 * JSON finalizer coverage for staff grantee image/caption replacement.
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)),
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn(),
}));
jest.mock('../../lib/services/workbench/grantee-deliverables/replace-submission-service', () => ({
  replaceGranteeSubmission: jest.fn(),
}));
jest.mock('../../lib/services/portal-upload-staging', () => {
  class PortalUploadStagingError extends Error {
    constructor(code, { httpStatus = 400 } = {}) {
      super(code); this.code = code; this.httpStatus = httpStatus;
    }
  }
  return {
    PORTAL_UPLOAD_SCOPES: { STAFF_GRANTEE_IMAGE: 'staff_grantee_image' },
    PortalUploadStagingError,
    claimPortalUpload: jest.fn(),
    clearPortalUploadCandidate: jest.fn(),
    completePortalUpload: jest.fn(),
    discardPortalUploadCandidate: jest.fn(),
    loadClaimedPortalImage: jest.fn(),
    recordPortalUploadCandidate: jest.fn(),
    rejectPortalUpload: jest.fn(),
    releasePortalUpload: jest.fn(),
    staffActorBinding: jest.fn(() => 'profile:profile-1'),
  };
});

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { getDeliverableForRequest } from '../../lib/services/grantee-deliverable-record';
import { replaceGranteeSubmission } from '../../lib/services/workbench/grantee-deliverables/replace-submission-service';
import {
  PortalUploadStagingError,
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalImage,
} from '../../lib/services/portal-upload-staging';
import handler from '../../pages/api/workbench/grantee-deliverables/replace-submission';

const GUID = '22222222-2222-4222-8222-222222222222';
const STAGING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ETAG = 'W/"d1"';
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, sends: 0 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.sends += 1; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  return res;
}

function req(body = {}, method = 'POST') {
  return { method, body, headers: {}, query: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: 'profile-1',
    session: { user: { dynamicsSystemuserId: 'system-user-1' } },
  });
  getDeliverableForRequest.mockResolvedValue({
    wmkf_granteedeliverableid: 'd1',
    wmkf_deliverablestatus: 100000001,
    wmkf_imagefileref: 'https://sp/old.png',
    _etag: ETAG,
  });
  claimPortalUpload.mockResolvedValue({
    state: 'claimed',
    leaseToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    row: { original_etag: ETAG, candidate_result: null },
  });
  loadClaimedPortalImage.mockResolvedValue({ filename: 'replacement.png', mimeType: 'image/png', buffer: BYTES });
  replaceGranteeSubmission.mockResolvedValue({ ok: true, etag: 'W/"d2"' });
  completePortalUpload.mockResolvedValue({ ok: true });
});

test('auth gate short-circuits before DAL or service work', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = mockRes();
  await handler(req({ requestId: GUID, caption: 'Revised.', etag: ETAG }), res);
  expect(res.sends).toBe(0);
  expect(withDalContext).not.toHaveBeenCalled();
});

test('caption-only JSON reaches service with no staged image', async () => {
  const res = mockRes();
  await handler(req({ requestId: ` ${GUID} `, caption: 'Revised caption.', etag: ` ${ETAG} ` }), res);
  expect(withDalContext).toHaveBeenCalledWith('grantee-submission-replace', expect.any(Function));
  expect(replaceGranteeSubmission).toHaveBeenCalledWith(expect.objectContaining({
    requestId: GUID,
    caption: 'Revised caption.',
    imageFile: null,
    clientEtag: ETAG,
    actingUserSystemId: 'system-user-1',
  }));
  expect(res.statusCode).toBe(200);
});

test('actor-bound staged image is loaded and completed around service write', async () => {
  const res = mockRes();
  await handler(req({ requestId: GUID, etag: ETAG, stagingId: STAGING_ID }), res);
  expect(claimPortalUpload).toHaveBeenCalledWith(expect.objectContaining({
    stagingId: STAGING_ID,
    resourceId: GUID,
    actorBinding: 'profile:profile-1',
  }));
  expect(replaceGranteeSubmission).toHaveBeenCalledWith(expect.objectContaining({
    requestId: GUID,
    caption: null,
    imageFile: { filename: 'replacement.png', mimeType: 'image/png', buffer: BYTES },
    onCandidateUploaded: expect.any(Function),
  }));
  expect(completePortalUpload).toHaveBeenCalledWith(expect.objectContaining({ stagingId: STAGING_ID }));
  expect(res.statusCode).toBe(200);
});

test.each([undefined, 'not-a-guid'])('invalid requestId %p returns 400', async (requestId) => {
  const res = mockRes();
  await handler(req({ requestId, caption: 'Revised.', etag: ETAG }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
});

test('overlong caption returns 400 before DAL work', async () => {
  const res = mockRes();
  await handler(req({ requestId: GUID, caption: 'x'.repeat(2001), etag: ETAG }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
});

test('neither caption nor staging id returns 400', async () => {
  const res = mockRes();
  await handler(req({ requestId: GUID, etag: ETAG }), res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
});

test('foreign staging id maps to 404 without invoking writer', async () => {
  claimPortalUpload.mockRejectedValue(new PortalUploadStagingError('staging_not_found', { httpStatus: 404 }));
  const res = mockRes();
  await handler(req({ requestId: GUID, etag: ETAG, stagingId: STAGING_ID }), res);
  expect(res.statusCode).toBe(404);
  expect(replaceGranteeSubmission).not.toHaveBeenCalled();
});
