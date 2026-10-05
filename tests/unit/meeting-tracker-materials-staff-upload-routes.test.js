/** @jest-environment node */
// Staff replacement upload routes (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.1-3.3).
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../shared/config/meetingTracker', () => ({ isMeetingTrackerSchemaReady: jest.fn(() => true) }));
jest.mock('../../lib/utils/site-visit-materials-readiness', () => ({ isSiteVisitMaterialsSchemaReady: jest.fn(() => true) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)) }));
jest.mock('../../lib/services/site-visit-materials/upload-cap', () => ({ getUploadMaxMb: jest.fn(async () => ({ maxMb: 500 })), uploadMaxBytes: (mb) => mb * 1024 * 1024 }));
jest.mock('../../lib/services/site-visit-materials/collection-store', () => ({
  getOpenCollectionForRequest: jest.fn(),
  getLatestCollectionForRequest: jest.fn(),
}));
jest.mock('../../lib/services/site-visit-materials/contributor-service', () => ({ finalizeMaterialUpload: jest.fn() }));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { SITE_VISIT_MATERIAL: 'site_visit_material' },
  PORTAL_DOCUMENT_CONTENT_TYPES: ['application/pdf'],
  PortalUploadStagingError: class PortalUploadStagingError extends Error { constructor(code, { httpStatus = 409, resultPayload = null } = {}) { super(code); this.code = code; this.httpStatus = httpStatus; this.resultPayload = resultPayload; } },
  createPortalUpload: jest.fn(),
  claimPortalUpload: jest.fn(),
  completePortalUpload: jest.fn(),
  loadClaimedPortalImage: jest.fn(),
  rejectPortalUpload: jest.fn(),
  releasePortalUpload: jest.fn(),
  staffActorBinding: jest.fn((profileId) => `profile:${profileId}`),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { isSiteVisitMaterialsSchemaReady } from '../../lib/utils/site-visit-materials-readiness';
import { getLatestCollectionForRequest, getOpenCollectionForRequest } from '../../lib/services/site-visit-materials/collection-store';
import { finalizeMaterialUpload } from '../../lib/services/site-visit-materials/contributor-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import * as staging from '../../lib/services/portal-upload-staging';
import uploadTokenHandler from '../../pages/api/meeting-tracker/visits/[requestId]/materials/staff-upload-token';
import finalizeHandler from '../../pages/api/meeting-tracker/visits/[requestId]/materials/staff-finalize';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const SYSTEM_USER = '66666666-6666-4666-8666-666666666666';
const closedCollection = {
  id: '33333333-3333-4333-8333-333333333333',
  request_id: REQUEST_ID,
  status: 'closed',
  closes_at: '2026-09-25T17:00:00Z',
  checklist: [{ key: 'presentation_pdf', waived: false }, { key: 'participant_bios', waived: true }],
};

function res() { return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } }; }
const req = (body, requestId = REQUEST_ID) => ({ method: 'POST', body, query: { requestId }, headers: {} });

beforeEach(() => {
  jest.clearAllMocks();
  isSiteVisitMaterialsSchemaReady.mockReturnValue(true);
  requireAppAccess.mockResolvedValue({ profileId: 42, session: { user: { dynamicsSystemuserId: SYSTEM_USER } } });
  getOpenCollectionForRequest.mockResolvedValue(null);
  getLatestCollectionForRequest.mockResolvedValue(closedCollection);
  staging.createPortalUpload.mockResolvedValue({ stagingId: STAGING_ID, pathname: 'p', clientToken: 'ct', contentType: 'application/pdf' });
  staging.claimPortalUpload.mockResolvedValue({ state: 'claimed', row: { id: STAGING_ID, candidate_result: null }, leaseToken: 'lease' });
  staging.loadClaimedPortalImage.mockResolvedValue({ buffer: Buffer.from('%PDF'), filename: 'deck.pdf', sha256: 'abc' });
  finalizeMaterialUpload.mockResolvedValue({ ok: true, slot: 'presentation_pdf', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-10-05T22:00:00Z' });
});

describe('staff-upload-token', () => {
  test('requires meeting-tracker access before any work; binding is the session profile, never a body value', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const denied = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }), denied);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'meeting-tracker');
    expect(staging.createPortalUpload).not.toHaveBeenCalled();

    const injected = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 10, actorBinding: 'profile:1' }), injected);
    expect(injected.statusCode).toBe(400);

    const ok = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', contentType: 'application/pdf', size: 10 }), ok);
    expect(ok.statusCode).toBe(200);
    expect(staging.createPortalUpload).toHaveBeenCalledWith(expect.objectContaining({ scope: 'site_visit_material', resourceId: REQUEST_ID, actorBinding: 'profile:42' }));
  });

  test('works on a closed collection and on a waived slot; refuses unknown slots, bad extensions, oversize, and a request with no collection', async () => {
    const waived = res(); await uploadTokenHandler(req({ slot: 'participant_bios', filename: 'bios.pdf', contentType: 'application/pdf', size: 10 }), waived);
    expect(waived.statusCode).toBe(200);
    const unknown = res(); await uploadTokenHandler(req({ slot: 'nope', filename: 'a.pdf', size: 10 }), unknown); expect(unknown.statusCode).toBe(400);
    const ext = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.exe', size: 10 }), ext); expect(ext.statusCode).toBe(422);
    const big = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 501 * 1024 * 1024 }), big); expect(big.body.reason).toBe('file_too_large');
    getLatestCollectionForRequest.mockResolvedValueOnce(null);
    const none = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }), none); expect(none.statusCode).toBe(404);
    expect(staging.createPortalUpload).toHaveBeenCalledTimes(1);
  });

  test('the hidden other slot is refused before any staging row is minted', async () => {
    const other = res(); await uploadTokenHandler(req({ slot: 'other', filename: 'map.docx', size: 10 }), other);
    expect(other.statusCode).toBe(400);
    expect(other.body.reason).toBe('slot_not_open');
    expect(staging.createPortalUpload).not.toHaveBeenCalled();
  });

  test('a non-GUID path request id and a disabled schema are refused', async () => {
    const bad = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }, 'x'), bad); expect(bad.statusCode).toBe(400);
    isSiteVisitMaterialsSchemaReady.mockReturnValueOnce(false);
    const off = res(); await uploadTokenHandler(req({ slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }), off); expect(off.statusCode).toBe(503);
    expect(staging.createPortalUpload).not.toHaveBeenCalled();
  });
});

describe('staff-finalize', () => {
  test('claims by scope, request and the session staff binding, then finalizes inline as staff with the session system user', async () => {
    const ok = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf' }), ok);
    expect(staging.claimPortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, scope: 'site_visit_material', resourceId: REQUEST_ID, actorBinding: 'profile:42' });
    const args = finalizeMaterialUpload.mock.calls[0][0];
    expect(args.collection).toBe(closedCollection);
    expect(args.uploader).toEqual({ kind: 'staff', actingUserSystemId: SYSTEM_USER });
    expect(args).not.toHaveProperty('backgroundJob');
    expect(staging.completePortalUpload).toHaveBeenCalledWith(expect.objectContaining({ stagingId: STAGING_ID, resultCode: 'ok' }));
    expect(ok.body).toMatchObject({ ok: true, slot: 'presentation_pdf' });
  });

  test('a session with no Dynamics system user is refused before the claim', async () => {
    requireAppAccess.mockResolvedValueOnce({ profileId: 42, session: { user: {} } });
    const out = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf' }), out);
    expect(out.statusCode).toBe(403);
    expect(out.body.reason).toBe('staff_actor_unavailable');
    expect(staging.claimPortalUpload).not.toHaveBeenCalled();
  });

  test('extra body keys and non-GUID staging ids are refused before the claim', async () => {
    const extra = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf', uploader: { kind: 'contributor' } }), extra);
    expect(extra.statusCode).toBe(400);
    const notGuid = res(); await finalizeHandler(req({ stagingId: 'x', slot: 'presentation_pdf' }), notGuid);
    expect(notGuid.statusCode).toBe(400);
    expect(staging.claimPortalUpload).not.toHaveBeenCalled();
  });

  test('a consumed staging row replays its stored result without finalizing again', async () => {
    staging.claimPortalUpload.mockResolvedValueOnce({ state: 'consumed', result: { ok: true, slot: 'presentation_pdf', filename: 'f.pdf' } });
    const out = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf' }), out);
    expect(out.body).toEqual({ ok: true, slot: 'presentation_pdf', filename: 'f.pdf' });
    expect(finalizeMaterialUpload).not.toHaveBeenCalled();
  });

  test('a busy slot releases staging for retry; a permanent result rejects it', async () => {
    finalizeMaterialUpload.mockRejectedValueOnce(new ServiceHttpError('busy', { httpStatus: 409, code: 'slot_busy', body: { ok: false, reason: 'slot_busy' } }));
    const busy = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf' }), busy);
    expect(busy.statusCode).toBe(409);
    expect(staging.releasePortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: 'lease' });
    finalizeMaterialUpload.mockRejectedValueOnce(new ServiceHttpError('ext', { httpStatus: 422, code: 'extension_not_allowed', body: { ok: false, reason: 'extension_not_allowed' } }));
    const bad = res(); await finalizeHandler(req({ stagingId: STAGING_ID, slot: 'presentation_pdf' }), bad);
    expect(staging.rejectPortalUpload).toHaveBeenCalledWith(expect.objectContaining({ resultCode: 'extension_not_allowed' }));
  });
});
