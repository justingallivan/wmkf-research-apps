/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_name, fn) => fn()),
}));
jest.mock('../../shared/config/meetingTracker', () => ({
  isMeetingTrackerSchemaReady: jest.fn(() => true),
}));
jest.mock('../../lib/services/post-presentation-materials/material-service', () => ({
  finalizeMp4Upload: jest.fn(),
  finalizeTranscriptUpload: jest.fn(),
  getMp4UploadStatus: jest.fn(),
  getPresentationMaterials: jest.fn(),
  mintMp4Upload: jest.fn(),
  mintTranscriptUpload: jest.fn(),
  saveZoomRecording: jest.fn(),
}));
jest.mock('../../lib/services/portal-upload-staging', () => {
  class PortalUploadStagingError extends Error {
    constructor(code, { httpStatus = 400 } = {}) {
      super(code);
      this.code = code;
      this.httpStatus = httpStatus;
    }
  }
  return {
    PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
    PortalUploadStagingError,
    claimPortalUpload: jest.fn(),
    completePortalUpload: jest.fn(),
    loadClaimedPortalDocument: jest.fn(),
    rejectPortalUpload: jest.fn(),
    releasePortalUpload: jest.fn(),
    staffActorBinding: jest.fn((id) => `profile:${id}`),
  };
});
jest.mock('../../lib/external/verify-briefing-token', () => ({
  verifyBriefingToken: jest.fn(),
}));
jest.mock('../../lib/external/presentation-media-rate-limit', () => ({
  checkPresentationMediaRateLimit: jest.fn(),
}));
jest.mock('../../lib/services/deliberation-briefing/briefing-page-service', () => ({
  resolveBriefingMediaMember: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  finalizeMp4Upload,
  finalizeTranscriptUpload,
  getMp4UploadStatus,
  mintMp4Upload,
  mintTranscriptUpload,
  saveZoomRecording,
} from '../../lib/services/post-presentation-materials/material-service';
import {
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalDocument,
  rejectPortalUpload,
  releasePortalUpload,
} from '../../lib/services/portal-upload-staging';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token';
import { checkPresentationMediaRateLimit } from '../../lib/external/presentation-media-rate-limit';
import { resolveBriefingMediaMember } from '../../lib/services/deliberation-briefing/briefing-page-service';
import presentationMaterialsHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-materials';
import presentationUploadsHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-uploads';
import presentationUploadFinalizeHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/finalize';
import presentationUploadResumeHandler from '../../pages/api/meeting-tracker/visits/[requestId]/presentation-uploads/[uploadId]/resume';
import briefingOpenHandler from '../../pages/api/external/briefing/[token]/open';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const UPLOAD_ID = '44444444-4444-4444-8444-444444444444';

function response() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader: jest.fn(function setHeader(name, value) { this.headers[name] = value; }),
    status: jest.fn(function status(code) { this.statusCode = code; return this; }),
    json: jest.fn(function json(body) { this.body = body; return this; }),
    redirect: jest.fn(function redirect(code, url) { this.statusCode = code; this.redirectUrl = url; return this; }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 42, session: { user: { dynamicsSystemuserId: ACTOR_ID } } });
  finalizeMp4Upload.mockRejectedValue(new ServiceHttpError('not found', {
    httpStatus: 404,
    code: 'post_presentation_upload_not_found',
    body: { error: 'not found', code: 'post_presentation_upload_not_found' },
  }));
});

test('Meeting Tracker Zoom PATCH enforces exact body and passes only path request plus session actor', async () => {
  const rejected = response();
  await presentationMaterialsHandler({
    method: 'PATCH',
    query: { requestId: REQUEST_ID },
    body: { action: 'save_zoom', operationId: OPERATION_ID, zoomText: 'x', actor: ACTOR_ID },
  }, rejected);
  expect(rejected.statusCode).toBe(400);
  expect(saveZoomRecording).not.toHaveBeenCalled();

  saveZoomRecording.mockResolvedValue({ status: 'ready', materials: [] });
  const res = response();
  await presentationMaterialsHandler({
    method: 'PATCH',
    query: { requestId: REQUEST_ID },
    body: { action: 'save_zoom', operationId: OPERATION_ID, zoomText: 'https://zoom.us/rec/share/a?pwd=x' },
  }, res);
  expect(saveZoomRecording).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: 'https://zoom.us/rec/share/a?pwd=x',
    actingUserSystemId: ACTOR_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});

test('briefing media route fails closed when its durable limiter is unavailable', async () => {
  checkPresentationMediaRateLimit.mockResolvedValue({
    ok: false,
    reason: 'rate_limit_unavailable',
    retryAfterSeconds: 5,
  });
  const res = response();
  await briefingOpenHandler({
    method: 'GET',
    query: { token: 'token', member: `material:${REQUEST_ID}`, mode: 'watch' },
    headers: {},
    socket: {},
  }, res);
  expect(res.statusCode).toBe(503);
  expect(verifyBriefingToken).not.toHaveBeenCalled();
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('briefing media route verifies the briefing audience and returns a no-store 302 without proxying bytes', async () => {
  checkPresentationMediaRateLimit.mockResolvedValue({ ok: true });
  verifyBriefingToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID });
  resolveBriefingMediaMember.mockResolvedValue({
    kind: 'file',
    redirectUrl: 'https://microsoft.example/download',
  });
  const res = response();
  await briefingOpenHandler({
    method: 'GET',
    query: { token: 'token', member: `material:${REQUEST_ID}`, mode: 'watch' },
    headers: {},
    socket: {},
  }, res);
  expect(resolveBriefingMediaMember).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    member: `material:${REQUEST_ID}`,
    mode: 'watch',
  });
  expect(res.redirect).toHaveBeenCalledWith(302, 'https://microsoft.example/download');
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('transcript mint accepts only the exact contract and derives both actors from the session', async () => {
  const rejected = response();
  await presentationUploadsHandler({
    method: 'POST',
    query: { requestId: REQUEST_ID },
    body: { artifactType: 'transcript', filename: 'a.vtt', contentType: 'text/vtt', size: 10, actor: ACTOR_ID },
  }, rejected);
  expect(rejected.statusCode).toBe(400);
  expect(mintTranscriptUpload).not.toHaveBeenCalled();

  mintTranscriptUpload.mockResolvedValue({ stagingId: UPLOAD_ID, clientToken: 'private-token' });
  const res = response();
  await presentationUploadsHandler({
    method: 'POST',
    query: { requestId: REQUEST_ID },
    body: { artifactType: 'transcript', filename: 'a.vtt', contentType: 'text/vtt', size: 10 },
  }, res);
  expect(mintTranscriptUpload).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    filename: 'a.vtt',
    contentType: 'text/vtt',
    size: 10,
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});

test('recording mint accepts only the durable MP4 contract and derives the actor from the session', async () => {
  const rejected = response();
  await presentationUploadsHandler({
    method: 'POST',
    query: { requestId: REQUEST_ID },
    body: {
      artifactType: 'recording', operationId: OPERATION_ID, filename: 'a.mp4',
      contentType: 'video/mp4', size: 100, resumeFingerprint: 'a'.repeat(64), actor: ACTOR_ID,
    },
  }, rejected);
  expect(rejected.statusCode).toBe(400);
  expect(mintMp4Upload).not.toHaveBeenCalled();

  mintMp4Upload.mockResolvedValue({ uploadId: OPERATION_ID, uploadUrl: 'https://upload.example/session' });
  const res = response();
  await presentationUploadsHandler({
    method: 'POST',
    query: { requestId: REQUEST_ID },
    body: {
      artifactType: 'recording', operationId: OPERATION_ID, filename: 'a.mp4',
      contentType: 'video/mp4', size: 100, resumeFingerprint: 'a'.repeat(64),
    },
  }, res);
  expect(mintMp4Upload).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    filename: 'a.mp4',
    contentType: 'video/mp4',
    size: 100,
    resumeFingerprint: 'a'.repeat(64),
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});

test('recording resume accepts only the fingerprint and independently reauthorizes the session actor', async () => {
  getMp4UploadStatus.mockResolvedValue({ uploadId: UPLOAD_ID, nextExpectedRanges: ['10-'] });
  const rejected = response();
  await presentationUploadResumeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID },
    body: { resumeFingerprint: 'a'.repeat(64), uploadUrl: 'injected' },
  }, rejected);
  expect(rejected.statusCode).toBe(400);
  expect(getMp4UploadStatus).not.toHaveBeenCalled();

  const res = response();
  await presentationUploadResumeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID },
    body: { resumeFingerprint: 'a'.repeat(64) },
  }, res);
  expect(getMp4UploadStatus).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    uploadId: UPLOAD_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('private, no-store');
});

test('recording finalize wins dispatch when the durable intent exists and accepts no authority body', async () => {
  finalizeMp4Upload.mockResolvedValue({ uploadId: UPLOAD_ID, requestDocumentId: 'doc' });
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(finalizeMp4Upload).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    uploadId: UPLOAD_ID,
    actingUserSystemId: ACTOR_ID,
  });
  expect(claimPortalUpload).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('transcript finalize claims the full ownership tuple, passes the recorded candidate, and completes durably', async () => {
  claimPortalUpload.mockResolvedValue({
    state: 'claimed',
    leaseToken: 'lease',
    row: { candidate_result: { driveId: 'drive', itemId: 'item' } },
  });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockResolvedValue({ stagingId: UPLOAD_ID, requestDocumentId: 'doc' });
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(claimPortalUpload).toHaveBeenCalledWith({
    stagingId: UPLOAD_ID,
    scope: 'post_presentation_transcript',
    resourceId: REQUEST_ID,
    actorBinding: 'profile:42',
  });
  expect(finalizeTranscriptUpload).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST_ID,
    stagingId: UPLOAD_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: expect.objectContaining({
      leaseToken: 'lease',
      candidate: { driveId: 'drive', itemId: 'item' },
    }),
  }));
  expect(completePortalUpload).toHaveBeenCalledWith(expect.objectContaining({
    stagingId: UPLOAD_ID, leaseToken: 'lease', resultCode: 'ok',
  }));
  expect(res.statusCode).toBe(200);
});

test('transcript finalize rejects permanent byte failures and releases transient ones', async () => {
  const { PortalUploadStagingError } = jest.requireMock('../../lib/services/portal-upload-staging');
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockRejectedValueOnce(new PortalUploadStagingError('empty_file', { httpStatus: 400 }));
  const permanent = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, permanent);
  expect(rejectPortalUpload).toHaveBeenCalledWith({ stagingId: UPLOAD_ID, leaseToken: 'lease', resultCode: 'empty_file' });

  loadClaimedPortalDocument.mockRejectedValueOnce(new PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503 }));
  const transient = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, transient);
  expect(releasePortalUpload).toHaveBeenCalledWith({ stagingId: UPLOAD_ID, leaseToken: 'lease' });
});

test('a failed durable completion returns retryable 503 and releases the idempotent finalize', async () => {
  claimPortalUpload.mockResolvedValue({
    state: 'claimed', leaseToken: 'lease', row: { candidate_result: { driveId: 'drive', itemId: 'item' } },
  });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockResolvedValue({ stagingId: UPLOAD_ID, requestDocumentId: 'doc', replayed: false });
  completePortalUpload.mockRejectedValue(new Error('postgres unavailable'));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body.code).toBe('staging_completion_failed');
  expect(releasePortalUpload).toHaveBeenCalledWith({ stagingId: UPLOAD_ID, leaseToken: 'lease' });
  expect(finalizeTranscriptUpload).toHaveBeenCalledWith(expect.objectContaining({
    file: expect.objectContaining({ candidate: { driveId: 'drive', itemId: 'item' } }),
  }));
  errorSpy.mockRestore();
});

test('staging settlement failure never replaces the original classified response', async () => {
  const { PortalUploadStagingError } = jest.requireMock('../../lib/services/portal-upload-staging');
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockRejectedValue(new PortalUploadStagingError('empty_file', { httpStatus: 400 }));
  rejectPortalUpload.mockRejectedValue(new Error('postgres unavailable'));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.code).toBe('empty_file');
  errorSpy.mockRestore();
});

test('permanent staged-content mismatch rejects instead of entering a retry loop', async () => {
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockRejectedValue(new ServiceHttpError('hash mismatch', {
    httpStatus: 409,
    code: 'post_presentation_content_mismatch',
    body: { error: 'hash mismatch', code: 'post_presentation_content_mismatch' },
  }));
  rejectPortalUpload.mockResolvedValue(undefined);
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(rejectPortalUpload).toHaveBeenCalledWith({
    stagingId: UPLOAD_ID, leaseToken: 'lease', resultCode: 'post_presentation_content_mismatch',
  });
  expect(releasePortalUpload).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(409);
});

test('empty-string POST body is accepted and candidate mismatch is a durable rejection', async () => {
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockRejectedValue(new ServiceHttpError('candidate mismatch', {
    httpStatus: 409,
    code: 'post_presentation_candidate_mismatch',
    body: { error: 'candidate mismatch', code: 'post_presentation_candidate_mismatch' },
  }));
  rejectPortalUpload.mockResolvedValue(undefined);
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: '',
  }, res);
  expect(claimPortalUpload).toHaveBeenCalled();
  expect(rejectPortalUpload).toHaveBeenCalledWith({
    stagingId: UPLOAD_ID, leaseToken: 'lease', resultCode: 'post_presentation_candidate_mismatch',
  });
  expect(res.statusCode).toBe(409);
});

test('a staging lease lost inside the service returns its explicit 409 contract', async () => {
  const { PortalUploadStagingError } = jest.requireMock('../../lib/services/portal-upload-staging');
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockRejectedValue(new PortalUploadStagingError('finalize_lease_lost', { httpStatus: 409 }));
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('finalize_lease_lost');
});

test('temporarily invisible conflict-path candidate releases for retry', async () => {
  claimPortalUpload.mockResolvedValue({ state: 'claimed', leaseToken: 'lease', row: {} });
  loadClaimedPortalDocument.mockResolvedValue({
    filename: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
  });
  finalizeTranscriptUpload.mockRejectedValue(new ServiceHttpError('not visible yet', {
    httpStatus: 503,
    code: 'post_presentation_candidate_unavailable',
    body: { error: 'not visible yet', code: 'post_presentation_candidate_unavailable' },
  }));
  const res = response();
  await presentationUploadFinalizeHandler({
    method: 'POST', query: { requestId: REQUEST_ID, uploadId: UPLOAD_ID }, body: {},
  }, res);
  expect(releasePortalUpload).toHaveBeenCalledWith({ stagingId: UPLOAD_ID, leaseToken: 'lease' });
  expect(rejectPortalUpload).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(503);
});
