/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/post-presentation-materials/presentation-media-proof-service', () => ({
  assertPreviewProofDeployment: jest.fn(),
  beginPresentationMediaProofUpload: jest.fn(),
  cleanupPresentationMediaProofUpload: jest.fn(),
  finalizePresentationMediaProofUpload: jest.fn(),
  getPresentationMediaProofUploadStatus: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  assertPreviewProofDeployment,
  beginPresentationMediaProofUpload,
  cleanupPresentationMediaProofUpload,
  finalizePresentationMediaProofUpload,
  getPresentationMediaProofUploadStatus,
} from '../../lib/services/post-presentation-materials/presentation-media-proof-service';
import handler from '../../pages/api/meeting-tracker/presentation-media-proof';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 'profile-1' });
  beginPresentationMediaProofUpload.mockResolvedValue({ permit: 'opaque', uploadUrl: 'https://upload.example/session' });
  getPresentationMediaProofUploadStatus.mockResolvedValue({ complete: false });
  finalizePresentationMediaProofUpload.mockResolvedValue({ proofUrl: '/external/proof' });
  cleanupPresentationMediaProofUpload.mockResolvedValue({
    cleaned: true,
    cleanupOutcome: 'session_cancelled',
    deletedItem: false,
  });
});

test('production denial occurs before authentication', async () => {
  assertPreviewProofDeployment.mockImplementationOnce(() => { throw new Error('not preview'); });
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(404);
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('begin requires Meeting Tracker access, exact fields, and uses the authenticated profile', async () => {
  const extra = mockRes();
  await handler({
    method: 'POST',
    body: { action: 'begin', requestId: REQUEST_ID, filename: 'a.mp4', mimeType: 'video/mp4', size: 60_000_000, lastModified: 1, injected: true },
  }, extra);
  expect(extra.statusCode).toBe(400);
  expect(beginPresentationMediaProofUpload).not.toHaveBeenCalled();

  const res = mockRes();
  await handler({
    method: 'POST',
    body: { action: 'begin', requestId: REQUEST_ID, filename: 'a.mp4', mimeType: 'video/mp4', size: 60_000_000, lastModified: 1 },
  }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
  expect(beginPresentationMediaProofUpload).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    profileId: 'profile-1',
    filename: 'a.mp4',
    mimeType: 'video/mp4',
    size: 60_000_000,
    lastModified: 1,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test.each([
  ['status', getPresentationMediaProofUploadStatus],
  ['finalize', finalizePresentationMediaProofUpload],
  ['cleanup', cleanupPresentationMediaProofUpload],
])('%s accepts only the opaque permit and authenticated profile', async (action, service) => {
  const res = mockRes();
  await handler({ method: 'POST', body: { action, permit: 'opaque-permit' } }, res);
  expect(service).toHaveBeenCalledWith({ permit: 'opaque-permit', profileId: 'profile-1' });
  expect(res.statusCode).toBe(200);
});
