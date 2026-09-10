/** @jest-environment node */
jest.mock('../../lib/external/rate-limit', () => ({ checkRateLimit: jest.fn(), recordTokenOutcome: jest.fn() }));
jest.mock('../../lib/external/verify-materials-token', () => ({ verifyMaterialsToken: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => Promise.resolve().then(fn)) }));
jest.mock('../../lib/services/site-visit-materials/upload-cap', () => ({ getUploadMaxMb: jest.fn(async () => ({ maxMb: 100 })), uploadMaxBytes: (mb) => mb * 1024 * 1024 }));
jest.mock('../../lib/services/site-visit-materials/contributor-service', () => ({ buildContributorContext: jest.fn(), finalizeMaterialUpload: jest.fn() }));
jest.mock('../../lib/services/portal-upload-staging', () => ({
  PORTAL_UPLOAD_SCOPES: { SITE_VISIT_MATERIAL: 'site_visit_material' },
  PORTAL_DOCUMENT_CONTENT_TYPES: ['application/pdf'],
  PortalUploadStagingError: class PortalUploadStagingError extends Error { constructor(code, { httpStatus = 409 } = {}) { super(code); this.code = code; this.httpStatus = httpStatus; } },
  createPortalUpload: jest.fn(),
  claimPortalUpload: jest.fn(),
  completePortalUpload: jest.fn(),
  externalMaterialsActorBinding: jest.fn(() => 'materials:hash'),
  loadClaimedPortalImage: jest.fn(),
  rejectPortalUpload: jest.fn(),
  releasePortalUpload: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyMaterialsToken } from '../../lib/external/verify-materials-token';
import { getUploadMaxMb } from '../../lib/services/site-visit-materials/upload-cap';
import { buildContributorContext, finalizeMaterialUpload } from '../../lib/services/site-visit-materials/contributor-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import * as staging from '../../lib/services/portal-upload-staging';
import contextHandler from '../../pages/api/external/materials/[token]/context';
import uploadTokenHandler from '../../pages/api/external/materials/[token]/upload-token';
import finalizeHandler from '../../pages/api/external/materials/[token]/finalize';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const STAGING_ID = '22222222-2222-4222-8222-222222222222';
const collection = { request_id: REQUEST_ID, status: 'open', checklist: [{ key: 'presentation_pdf', waived: false }, { key: 'participant_bios', waived: true }] };

function res() { return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } }; }
const req = (method, body = {}) => ({ method, body, query: { token: 'jwt' }, headers: {} });

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  verifyMaterialsToken.mockResolvedValue({ ok: true, requestId: REQUEST_ID, collection });
  buildContributorContext.mockResolvedValue({ ok: true, checklist: [] });
  staging.createPortalUpload.mockResolvedValue({ stagingId: STAGING_ID, pathname: 'p', clientToken: 'ct', contentType: 'application/pdf' });
  staging.claimPortalUpload.mockResolvedValue({ state: 'claimed', row: { id: STAGING_ID }, leaseToken: 'lease' });
  staging.loadClaimedPortalImage.mockResolvedValue({ buffer: Buffer.from('%PDF'), filename: 'deck.pdf', sha256: 'abc' });
  finalizeMaterialUpload.mockResolvedValue({ ok: true, slot: 'presentation_pdf', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-11-21T09:00:00Z', artifactId: 'doc', sha256: 'abc' });
});

test('context: method, rate limit, then verify; invalid links map to 401/404; a valid one returns the shaped context uncached', async () => {
  const bad = res(); await contextHandler(req('POST'), bad); expect(bad.statusCode).toBe(405);
  checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30 });
  const limited = res(); await contextHandler(req('GET'), limited); expect(limited.statusCode).toBe(429); expect(verifyMaterialsToken).not.toHaveBeenCalled();
  verifyMaterialsToken.mockResolvedValueOnce({ ok: false, reason: 'expired' });
  const expired = res(); await contextHandler(req('GET'), expired); expect(expired.statusCode).toBe(401); expect(expired.body.reason).toBe('expired');
  expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 'jwt', false);
  verifyMaterialsToken.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
  const off = res(); await contextHandler(req('GET'), off); expect(off.statusCode).toBe(404);
  const ok = res(); await contextHandler(req('GET'), ok);
  expect(buildContributorContext).toHaveBeenCalledWith({ collection });
  expect(ok.headers['Cache-Control']).toBe('private, no-store'); expect(ok.body).toEqual({ ok: true, checklist: [] });
});

test('upload-token: server derives scope, resource, binding, and cap; waived or unknown slots, bad extensions, and oversize declarations are refused', async () => {
  const ok = res(); await uploadTokenHandler(req('POST', { slot: 'presentation_pdf', filename: 'deck.pdf', contentType: 'application/pdf', size: 1234 }), ok);
  expect(staging.createPortalUpload).toHaveBeenCalledWith({ scope: 'site_visit_material', resourceId: REQUEST_ID, actorBinding: 'materials:hash', filename: 'deck.pdf', contentType: 'application/pdf', maxBytes: 100 * 1024 * 1024, allowedContentTypes: ['application/pdf'] });
  expect(ok.body).toMatchObject({ ok: true, slot: 'presentation_pdf', stagingId: STAGING_ID, clientToken: 'ct' });
  const waived = res(); await uploadTokenHandler(req('POST', { slot: 'participant_bios', filename: 'b.pdf', size: 10 }), waived); expect(waived.statusCode).toBe(400);
  const unknown = res(); await uploadTokenHandler(req('POST', { slot: 'nope', filename: 'b.pdf', size: 10 }), unknown); expect(unknown.statusCode).toBe(400);
  const ext = res(); await uploadTokenHandler(req('POST', { slot: 'presentation_pdf', filename: 'deck.pptx', size: 10 }), ext); expect(ext.statusCode).toBe(422); expect(ext.body.reason).toBe('extension_not_allowed');
  const big = res(); await uploadTokenHandler(req('POST', { slot: 'presentation_pdf', filename: 'deck.pdf', size: 101 * 1024 * 1024 }), big); expect(big.statusCode).toBe(400); expect(big.body).toEqual({ ok: false, reason: 'file_too_large', maxMb: 100 });
  const other = res(); await uploadTokenHandler(req('POST', { slot: 'other', filename: 'map.docx', size: 10 }), other); expect(other.statusCode).toBe(200);
  expect(staging.createPortalUpload).toHaveBeenCalledTimes(2);
  getUploadMaxMb.mockRejectedValueOnce(new ServiceHttpError('cap', { httpStatus: 503, code: 'site_visit_materials_cap_unavailable', body: { ok: false, reason: 'cap_unavailable' } }));
  const capDown = res(); await uploadTokenHandler(req('POST', { slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }), capDown);
  expect(capDown.statusCode).toBe(503); expect(capDown.body.reason).toBe('cap_unavailable'); expect(staging.createPortalUpload).toHaveBeenCalledTimes(2);
  verifyMaterialsToken.mockResolvedValueOnce({ ok: false, reason: 'closed' });
  const closed = res(); await uploadTokenHandler(req('POST', { slot: 'presentation_pdf', filename: 'deck.pdf', size: 10 }), closed); expect(closed.statusCode).toBe(401);
});

test('finalize: claims by the ownership tuple, persists, completes the row with the public result; consumed rows replay', async () => {
  const ok = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), ok);
  expect(staging.claimPortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, scope: 'site_visit_material', resourceId: REQUEST_ID, actorBinding: 'materials:hash' });
  expect(finalizeMaterialUpload).toHaveBeenCalledWith({ collection, slotKey: 'presentation_pdf', file: expect.objectContaining({ filename: 'deck.pdf' }) });
  const body = { ok: true, slot: 'presentation_pdf', filename: '1003222 Site Visit Presentation.pdf', receivedAt: '2026-11-21T09:00:00Z' };
  expect(staging.completePortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: 'lease', resultCode: 'ok', resultPayload: body });
  expect(ok.body).toEqual(body);
  staging.claimPortalUpload.mockResolvedValueOnce({ state: 'consumed', row: {}, result: body });
  const replay = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), replay);
  expect(replay.body).toEqual(body); expect(finalizeMaterialUpload).toHaveBeenCalledTimes(1);
  const bad = res(); await finalizeHandler(req('POST', { stagingId: 'x', slot: 'presentation_pdf' }), bad); expect(bad.statusCode).toBe(400); expect(staging.claimPortalUpload).toHaveBeenCalledTimes(2);
});

test('finalize: permanent byte and validation failures reject the row; transient failures release it for retry', async () => {
  staging.loadClaimedPortalImage.mockRejectedValueOnce(new staging.PortalUploadStagingError('image_too_large', { httpStatus: 413 }));
  const big = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), big);
  expect(big.statusCode).toBe(413); expect(big.body.reason).toBe('file_too_large');
  expect(staging.rejectPortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: 'lease', resultCode: 'image_too_large' });
  finalizeMaterialUpload.mockRejectedValueOnce(new ServiceHttpError('mismatch', { httpStatus: 422, code: 'signature_mismatch', body: { ok: false, reason: 'signature_mismatch' } }));
  const sig = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), sig);
  expect(sig.statusCode).toBe(422); expect(staging.rejectPortalUpload).toHaveBeenLastCalledWith({ stagingId: STAGING_ID, leaseToken: 'lease', resultCode: 'signature_mismatch' });
  finalizeMaterialUpload.mockRejectedValueOnce(new ServiceHttpError('scan', { httpStatus: 503, code: 'scan_unavailable', body: { ok: false, reason: 'scan_unavailable' } }));
  const scan = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), scan);
  expect(scan.statusCode).toBe(503); expect(staging.releasePortalUpload).toHaveBeenCalledWith({ stagingId: STAGING_ID, leaseToken: 'lease' });
  finalizeMaterialUpload.mockRejectedValueOnce(new Error('graph down'));
  const graph = res(); await finalizeHandler(req('POST', { stagingId: STAGING_ID, slot: 'presentation_pdf' }), graph);
  expect(graph.statusCode).toBe(503); expect(graph.body.reason).toBe('persist_failed'); expect(staging.releasePortalUpload).toHaveBeenCalledTimes(2);
  expect(staging.completePortalUpload).not.toHaveBeenCalled();
});
