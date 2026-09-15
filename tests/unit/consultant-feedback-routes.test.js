/**
 * /api/workbench/consultant-feedback and /consultant-feedback/consultants —
 * method guards, GUID rejection, access-denied path, actor from session only.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/consultant-feedback-service', () => ({
  listConsultantFeedback: jest.fn(),
  listEligibleConsultants: jest.fn(),
  writeFeedbackEntry: jest.fn(),
  updateFeedbackEntry: jest.fn(),
  deleteFeedbackEntry: jest.fn(),
}));
jest.mock('../../lib/services/consultant-feedback-attachment-service', () => ({
  mintAttachmentUpload: jest.fn(),
  finalizeAttachmentUpload: jest.fn(),
}));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { CONSULTANT_FEEDBACK: 'consultant_feedback' },
  PortalUploadStagingError: class PortalUploadStagingError extends Error {
    constructor(code, { httpStatus = 400 } = {}) { super(code); this.code = code; this.httpStatus = httpStatus; }
  },
  claimPortalUpload: jest.fn(),
  completePortalUpload: jest.fn(),
  loadClaimedPortalImage: jest.fn(),
  rejectPortalUpload: jest.fn(),
  releasePortalUpload: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  listConsultantFeedback,
  listEligibleConsultants,
  writeFeedbackEntry,
  updateFeedbackEntry,
  deleteFeedbackEntry,
} from '../../lib/services/consultant-feedback-service';
import { mintAttachmentUpload, finalizeAttachmentUpload } from '../../lib/services/consultant-feedback-attachment-service';
import {
  claimPortalUpload,
  completePortalUpload,
  loadClaimedPortalImage,
  rejectPortalUpload,
  releasePortalUpload,
} from '../../lib/services/portal-upload-staging';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/consultant-feedback';
import consultantsHandler from '../../pages/api/workbench/consultant-feedback/consultants';
import uploadTokenHandler from '../../pages/api/workbench/consultant-feedback/upload-token';
import finalizeHandler from '../../pages/api/workbench/consultant-feedback/finalize';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 7;

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: PROFILE_ID, session: { user: {} } });
});

test('an unauthenticated caller stops at the app gate before any service call', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(listConsultantFeedback).not.toHaveBeenCalled();
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
});

test('an unsupported method is rejected with 405 before the app gate', async () => {
  const res = mockRes();
  await handler({ method: 'PUT' }, res);
  expect(res.statusCode).toBe(405);
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('GET lists entries for a GUID requestId', async () => {
  listConsultantFeedback.mockResolvedValueOnce([{ id: '1' }]);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ items: [{ id: '1' }] });
  expect(listConsultantFeedback).toHaveBeenCalledWith({ requestId: REQUEST_ID });
});

test('GET propagates a non-GUID requestId rejection from the service as its ServiceHttpError status', async () => {
  listConsultantFeedback.mockRejectedValueOnce(new ServiceHttpError('bad', { httpStatus: 400, body: { error: 'bad', reason: 'invalid_request_id' } }));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('invalid_request_id');
});

test('POST create passes the actor from the session, never from the body', async () => {
  writeFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, mutationId: 'm-1', consultantRosterId: 5, bodyHtml: '<p>Hi</p>', receivedOn: '2026-09-01', shared: true, actorProfileId: 999 },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(writeFeedbackEntry).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: PROFILE_ID }));
  expect(writeFeedbackEntry.mock.calls[0][0].actorProfileId).not.toBe(999);
});

test('POST propagates a non-boolean shared rejection as its ServiceHttpError status', async () => {
  writeFeedbackEntry.mockRejectedValueOnce(new ServiceHttpError('bad', { httpStatus: 400, body: { error: 'bad', reason: 'invalid_shared' } }));
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, mutationId: 'm-1', consultantRosterId: 5, bodyHtml: '<p>Hi</p>', receivedOn: '2026-09-01', shared: 'false' },
  }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.reason).toBe('invalid_shared');
});

test('PATCH update passes the actor from the session', async () => {
  updateFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({ method: 'PATCH', body: { id: 5, requestId: REQUEST_ID, shared: false } }, res);
  expect(res.statusCode).toBe(200);
  expect(updateFeedbackEntry).toHaveBeenCalledWith({ id: 5, requestId: REQUEST_ID, actorProfileId: PROFILE_ID, patch: { shared: false } });
});

test('DELETE removes the entry with the actor from the session', async () => {
  deleteFeedbackEntry.mockResolvedValueOnce({ id: '5' });
  const res = mockRes();
  await handler({ method: 'DELETE', body: { id: 5, requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(deleteFeedbackEntry).toHaveBeenCalledWith({ id: 5, requestId: REQUEST_ID, actorProfileId: PROFILE_ID });
});

describe('consultants route', () => {
  test('rejects non-GET with 405', async () => {
    const res = mockRes();
    await consultantsHandler({ method: 'POST' }, res);
    expect(res.statusCode).toBe(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('an unauthenticated caller stops at the app gate', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await consultantsHandler({ method: 'GET' }, res);
    expect(listEligibleConsultants).not.toHaveBeenCalled();
  });

  test('GET lists eligible consultants', async () => {
    listEligibleConsultants.mockResolvedValueOnce([{ id: 1, name: 'Ada', affiliation: null }]);
    const res = mockRes();
    await consultantsHandler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 1, name: 'Ada', affiliation: null }] });
  });
});

const STAGING_ID = '22222222-2222-4222-8222-222222222222';

describe('upload-token route', () => {
  test('rejects non-POST with 405 before the app gate', async () => {
    const res = mockRes();
    await uploadTokenHandler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('an unauthenticated caller stops at the app gate before any service call', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await uploadTokenHandler({ method: 'POST', body: { requestId: REQUEST_ID, filename: 'x.pdf', contentType: 'application/pdf', size: 10 } }, res);
    expect(mintAttachmentUpload).not.toHaveBeenCalled();
  });

  test('rejects a non-GUID requestId before any service call', async () => {
    const res = mockRes();
    await uploadTokenHandler({ method: 'POST', body: { requestId: 'not-a-guid', filename: 'x.pdf', contentType: 'application/pdf', size: 10 } }, res);
    expect(res.statusCode).toBe(400);
    expect(mintAttachmentUpload).not.toHaveBeenCalled();
  });

  test('mints with the actor from the session, never from the body', async () => {
    mintAttachmentUpload.mockResolvedValueOnce({ stagingId: STAGING_ID, pathname: 'x', clientToken: 't' });
    const res = mockRes();
    await uploadTokenHandler({ method: 'POST', body: { requestId: REQUEST_ID, filename: 'x.pdf', contentType: 'application/pdf', size: 10, actorProfileId: 999 } }, res);
    expect(res.statusCode).toBe(200);
    expect(mintAttachmentUpload).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: PROFILE_ID }));
    expect(mintAttachmentUpload.mock.calls[0][0].actorProfileId).not.toBe(999);
  });
});

describe('finalize route', () => {
  function claimedRow(overrides = {}) {
    return { id: STAGING_ID, candidate_result: null, ...overrides };
  }

  beforeEach(() => {
    claimPortalUpload.mockResolvedValue({ state: 'claimed', row: claimedRow(), leaseToken: 'lease-1' });
    loadClaimedPortalImage.mockResolvedValue({ buffer: Buffer.from('x'), filename: 'x.pdf', mimeType: 'application/pdf' });
    completePortalUpload.mockResolvedValue({});
  });

  test('rejects non-POST with 405 before the app gate', async () => {
    const res = mockRes();
    await finalizeHandler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('rejects a non-GUID requestId or stagingId before claiming', async () => {
    const res = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: 'not-a-guid', stagingId: STAGING_ID, entryId: 9 } }, res);
    expect(res.statusCode).toBe(400);
    expect(claimPortalUpload).not.toHaveBeenCalled();

    const res2 = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: 'not-a-guid', entryId: 9 } }, res2);
    expect(res2.statusCode).toBe(400);
    expect(claimPortalUpload).not.toHaveBeenCalled();
  });

  test('rejects a body naming both entryId and newEntry, or neither', async () => {
    const res = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID } }, res);
    expect(res.statusCode).toBe(400);
    expect(claimPortalUpload).not.toHaveBeenCalled();

    const res2 = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9, newEntry: {} } }, res2);
    expect(res2.statusCode).toBe(400);
    expect(claimPortalUpload).not.toHaveBeenCalled();
  });

  test('a consumed staging row replays the stored result with zero further writes', async () => {
    claimPortalUpload.mockResolvedValueOnce({ state: 'consumed', result: { ok: true, requestdocumentId: 'doc-1', feedbackId: '5' } });
    const res = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, requestdocumentId: 'doc-1', feedbackId: '5' });
    expect(loadClaimedPortalImage).not.toHaveBeenCalled();
    expect(finalizeAttachmentUpload).not.toHaveBeenCalled();
    expect(completePortalUpload).not.toHaveBeenCalled();
  });

  test('binds with the actor from the session and completes on success', async () => {
    finalizeAttachmentUpload.mockResolvedValueOnce({ requestdocumentId: 'doc-1', feedbackId: '5', filename: 'x.pdf' });
    const res = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9, actorProfileId: 999 } }, res);
    expect(res.statusCode).toBe(200);
    expect(finalizeAttachmentUpload).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: PROFILE_ID, requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9 }));
    expect(finalizeAttachmentUpload.mock.calls[0][0].actorProfileId).not.toBe(999);
    expect(completePortalUpload).toHaveBeenCalled();
  });

  test('a permanent bind error (attachment_conflict) rejects the staging row; a non-permanent one releases it', async () => {
    finalizeAttachmentUpload.mockRejectedValueOnce(new ServiceHttpError('conflict', { httpStatus: 409, code: 'attachment_conflict', body: { reason: 'attachment_conflict' } }));
    const res = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9 } }, res);
    expect(res.statusCode).toBe(409);
    expect(rejectPortalUpload).toHaveBeenCalled();
    expect(releasePortalUpload).not.toHaveBeenCalled();

    jest.clearAllMocks();
    requireAppAccess.mockResolvedValue({ profileId: PROFILE_ID, session: { user: {} } });
    claimPortalUpload.mockResolvedValue({ state: 'claimed', row: claimedRow(), leaseToken: 'lease-1' });
    loadClaimedPortalImage.mockResolvedValue({ buffer: Buffer.from('x'), filename: 'x.pdf', mimeType: 'application/pdf' });
    finalizeAttachmentUpload.mockRejectedValueOnce(new ServiceHttpError('not eligible', { httpStatus: 400, body: { reason: 'consultant_not_eligible' } }));
    const res2 = mockRes();
    await finalizeHandler({ method: 'POST', body: { requestId: REQUEST_ID, stagingId: STAGING_ID, entryId: 9 } }, res2);
    expect(res2.statusCode).toBe(400);
    expect(releasePortalUpload).toHaveBeenCalled();
    expect(rejectPortalUpload).not.toHaveBeenCalled();
  });
});
