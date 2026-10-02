/** @jest-environment node */
jest.mock('../../lib/external/rate-limit', () => ({ checkRateLimit: jest.fn(), recordTokenOutcome: jest.fn() }));
jest.mock('../../lib/external/verify-materials-token', () => ({ verifyMaterialsToken: jest.fn() }));
jest.mock('../../lib/services/site-visit-materials/upload-cap', () => ({ getUploadMaxMb: jest.fn() }));
jest.mock('../../lib/services/site-visit-materials/contributor-service', () => ({ finalizeMaterialUpload: jest.fn() }));
jest.mock('../../lib/utils/virus-scan-config.js', () => ({ isVirusScanEnabled: jest.fn() }));
jest.mock('../../lib/utils/site-visit-materials-background-readiness.js', () => ({
  isMaterialsBackgroundAdmissionEnabled: jest.fn(),
  isMaterialsBackgroundSchemaReady: jest.fn(),
}));
jest.mock('../../lib/services/site-visit-materials/background-job-store.js', () => ({
  enqueueMaterialsUploadJob: jest.fn(),
  getMaterialsUploadJobForStaging: jest.fn(),
  MaterialsJobConflict: class MaterialsJobConflict extends Error {
    constructor(code, httpStatus = 409) { super(code); this.code = code; this.httpStatus = httpStatus; }
  },
}));
jest.mock('../../lib/services/large-upload-admission', () => ({
  acquireLargeUploadAdmission: jest.fn(),
  LARGE_UPLOAD_RETRY_AFTER_SECONDS: 30,
  releaseLargeUploadAdmission: jest.fn(),
}));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { SITE_VISIT_MATERIAL: 'site_visit_material' },
  PortalUploadStagingError: class PortalUploadStagingError extends Error {
    constructor(code, { httpStatus = 409 } = {}) { super(code); this.code = code; this.httpStatus = httpStatus; }
  },
  claimPortalUpload: jest.fn(),
  completePortalUpload: jest.fn(),
  externalMaterialsActorBinding: jest.fn(() => 'materials:token-hash'),
  inspectClaimedPortalUploadMetadata: jest.fn(),
  loadClaimedPortalImage: jest.fn(),
  rejectPortalUpload: jest.fn(),
  releasePortalUpload: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyMaterialsToken } from '../../lib/external/verify-materials-token';
import { getUploadMaxMb } from '../../lib/services/site-visit-materials/upload-cap';
import { finalizeMaterialUpload } from '../../lib/services/site-visit-materials/contributor-service';
import { isVirusScanEnabled } from '../../lib/utils/virus-scan-config.js';
import {
  isMaterialsBackgroundAdmissionEnabled,
  isMaterialsBackgroundSchemaReady,
} from '../../lib/utils/site-visit-materials-background-readiness.js';
import {
  enqueueMaterialsUploadJob,
  getMaterialsUploadJobForStaging,
} from '../../lib/services/site-visit-materials/background-job-store.js';
import { acquireLargeUploadAdmission, releaseLargeUploadAdmission } from '../../lib/services/large-upload-admission';
import * as staging from '../../lib/services/portal-upload-staging';
import finalizeHandler from '../../pages/api/external/materials/[token]/finalize';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const COLLECTION_ID = '33333333-3333-4333-8333-333333333333';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'opaque-token';
const LEASE = 'lease-secret';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const collection = { id: COLLECTION_ID, request_id: REQUEST_ID, token_digest: 'digest', checklist: [{ key: 'presentation_pdf', waived: false }] };
const row = { id: STAGING_ID, pathname: 'private/path.pdf', filename: 'deck.pdf', max_bytes: 50_000_000, candidate_result: null };

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function request(body = { stagingId: STAGING_ID, slot: 'presentation_pdf' }) {
  return { method: 'POST', body, query: { token: TOKEN }, headers: {} };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  verifyMaterialsToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID, collection });
  isMaterialsBackgroundSchemaReady.mockReturnValue(true);
  isMaterialsBackgroundAdmissionEnabled.mockReturnValue(true);
  isVirusScanEnabled.mockReturnValue(true);
  getUploadMaxMb.mockResolvedValue({ maxMb: 500 });
  getMaterialsUploadJobForStaging.mockResolvedValue(null);
  acquireLargeUploadAdmission.mockReturnValue({ token: 'admission-token' });
  staging.claimPortalUpload.mockResolvedValue({ state: 'claimed', row, leaseToken: LEASE });
  staging.inspectClaimedPortalUploadMetadata.mockResolvedValue({ size: 1024, contentType: 'application/pdf' });
  enqueueMaterialsUploadJob.mockResolvedValue({ id: JOB_ID, status: 'queued' });
  staging.loadClaimedPortalImage.mockResolvedValue({ buffer: Buffer.from('%PDF'), filename: 'deck.pdf' });
  finalizeMaterialUpload.mockResolvedValue({ slot: 'presentation_pdf', filename: 'deck.pdf', receivedAt: '2026-09-01T00:00:00Z' });
});

test('returns 202 only after durable enqueue resolves', async () => {
  const enqueue = deferred();
  let enqueueStarted;
  const started = new Promise((resolve) => { enqueueStarted = resolve; });
  enqueueMaterialsUploadJob.mockImplementationOnce(() => {
    enqueueStarted();
    return enqueue.promise;
  });
  const res = response();
  const pending = finalizeHandler(request(), res);

  await started;
  expect(enqueueMaterialsUploadJob).toHaveBeenCalledWith({
    stagingId: STAGING_ID,
    stagingLeaseToken: LEASE,
    requestId: REQUEST_ID,
    collectionId: COLLECTION_ID,
    actorBinding: 'materials:token-hash',
    tokenDigest: 'digest',
    slot: 'presentation_pdf',
    otherUploadsEnabled: false,
  });
  expect(res.body).toBeNull();

  enqueue.resolve({ id: JOB_ID, status: 'queued' });
  await pending;
  expect(res.statusCode).toBe(202);
  expect(res.body).toEqual({ ok: true, jobId: JOB_ID, stagingId: STAGING_ID, status: 'queued' });
  expect(staging.loadClaimedPortalImage).not.toHaveBeenCalled();
  expect(finalizeMaterialUpload).not.toHaveBeenCalled();
});

test('enqueue failure releases the staging lease and never returns an accepted response', async () => {
  enqueueMaterialsUploadJob.mockRejectedValueOnce(new Error('database unavailable'));
  const res = response();
  await expect(finalizeHandler(request(), res)).rejects.toThrow('database unavailable');

  expect(res.statusCode).toBe(200);
  expect(res.body).toBeNull();
  expect(staging.releasePortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: LEASE });
  expect(staging.rejectPortalUpload).not.toHaveBeenCalled();
  expect(staging.loadClaimedPortalImage).not.toHaveBeenCalled();
});

test('an existing job replays its current state without claiming or reading bytes', async () => {
  getMaterialsUploadJobForStaging.mockResolvedValueOnce({ id: JOB_ID, status: 'processing' });
  const res = response();
  await finalizeHandler(request(), res);

  expect(res.statusCode).toBe(202);
  expect(res.body).toEqual({ ok: true, jobId: JOB_ID, stagingId: STAGING_ID, status: 'processing' });
  expect(staging.claimPortalUpload).not.toHaveBeenCalled();
  expect(staging.inspectClaimedPortalUploadMetadata).not.toHaveBeenCalled();
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
  expect(staging.loadClaimedPortalImage).not.toHaveBeenCalled();
});

test('transient metadata inspection failures release the claim for retry', async () => {
  staging.inspectClaimedPortalUploadMetadata.mockRejectedValueOnce(new staging.PortalUploadStagingError('staging_privacy_unverified', { httpStatus: 503 }));
  const res = response();
  await finalizeHandler(request(), res);

  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ ok: false, reason: 'staging_privacy_unverified' });
  expect(staging.releasePortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: LEASE });
  expect(staging.rejectPortalUpload).not.toHaveBeenCalled();
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
});

test.each([
  ['confirmed missing private blob', 'staged_upload_missing', 409, 'staged_upload_missing'],
  ['publicly readable blob', 'staging_publicly_readable', 503, 'staging_publicly_readable'],
  ['metadata mismatch', 'staged_upload_mismatch', 422, 'staged_upload_mismatch'],
])('%s is permanently rejected with a safe response', async (_label, code, status, resultCode) => {
  staging.inspectClaimedPortalUploadMetadata.mockRejectedValueOnce(new staging.PortalUploadStagingError(code, { httpStatus: status }));
  const res = response();
  await finalizeHandler(request(), res);

  expect(res.statusCode).toBe(status);
  expect(res.body).toEqual({ ok: false, reason: code });
  expect(JSON.stringify(res.body)).not.toContain('private/path.pdf');
  expect(staging.rejectPortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: LEASE, resultCode });
  expect(staging.releasePortalUpload).not.toHaveBeenCalled();
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
});

test('live byte cap failure rejects before enqueue and returns no 202', async () => {
  getUploadMaxMb.mockResolvedValueOnce({ maxMb: 1 });
  staging.inspectClaimedPortalUploadMetadata.mockResolvedValueOnce({ size: 2 * 1024 * 1024, contentType: 'application/pdf' });
  const res = response();
  await finalizeHandler(request(), res);

  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ ok: false, reason: 'file_too_large' });
  expect(staging.rejectPortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: LEASE, resultCode: 'file_too_large' });
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
});

test('schema-off skips job-table lookup and uses synchronous finalization', async () => {
  isMaterialsBackgroundSchemaReady.mockReturnValue(false);
  isMaterialsBackgroundAdmissionEnabled.mockReturnValue(false);
  const res = response();
  await finalizeHandler(request(), res);

  expect(getMaterialsUploadJobForStaging).not.toHaveBeenCalled();
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
  expect(staging.inspectClaimedPortalUploadMetadata).not.toHaveBeenCalled();
  expect(staging.loadClaimedPortalImage).toHaveBeenCalled();
  expect(finalizeMaterialUpload).toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test.each([
  ['admission disabled', false, true],
  ['scanner disabled', true, false],
])('%s preserves synchronous finalization', async (_label, admissionEnabled, scannerEnabled) => {
  isMaterialsBackgroundAdmissionEnabled.mockReturnValue(admissionEnabled);
  isVirusScanEnabled.mockReturnValue(scannerEnabled);
  const res = response();
  await finalizeHandler(request(), res);

  expect(getMaterialsUploadJobForStaging).toHaveBeenCalledTimes(1);
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
  expect(staging.inspectClaimedPortalUploadMetadata).not.toHaveBeenCalled();
  expect(staging.loadClaimedPortalImage).toHaveBeenCalled();
  expect(finalizeMaterialUpload).toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('rate limit and token verification run before any queue lookup or claim', async () => {
  checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 20 });
  const limited = response();
  await finalizeHandler(request(), limited);
  expect(limited.statusCode).toBe(429);
  expect(verifyMaterialsToken).not.toHaveBeenCalled();
  expect(getMaterialsUploadJobForStaging).not.toHaveBeenCalled();
  expect(staging.claimPortalUpload).not.toHaveBeenCalled();

  verifyMaterialsToken.mockResolvedValueOnce({ ok: false, reason: 'expired' });
  const invalid = response();
  await finalizeHandler(request(), invalid);
  expect(invalid.statusCode).toBe(401);
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), TOKEN, false);
  expect(getMaterialsUploadJobForStaging).not.toHaveBeenCalled();
  expect(staging.claimPortalUpload).not.toHaveBeenCalled();
});

test('live large-upload admission failure returns retryable busy without claiming or enqueuing', async () => {
  acquireLargeUploadAdmission.mockReturnValueOnce(null);
  const res = response();
  await finalizeHandler(request(), res);

  expect(res.statusCode).toBe(503);
  expect(res.headers['Retry-After']).toBe('30');
  expect(res.body).toMatchObject({ ok: false, reason: 'processing_busy', retryAfterSeconds: 30 });
  expect(staging.claimPortalUpload).not.toHaveBeenCalled();
  expect(enqueueMaterialsUploadJob).not.toHaveBeenCalled();
  expect(releaseLargeUploadAdmission).not.toHaveBeenCalled();
});
