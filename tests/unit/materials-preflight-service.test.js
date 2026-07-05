/**
 * Logic-level unit tests for lib/services/review-manager/materials-preflight-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapter + materials lister mocked; covers available (fileCount), the 404
 * not_found domain error with explicit { ok:false, reason } body, and the
 * untyped propagation of lookup/listing failures (the shell owns the
 * sanitized 200 materials_unavailable mapping).
 */

const getById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  SELECT_PROFILES: { IDENTITY: 'akoya_requestid,akoya_requestnum' },
}));
const listReviewerMaterials = jest.fn();
jest.mock('../../lib/external/reviewer-materials', () => ({
  listReviewerMaterials: (...a) => listReviewerMaterials(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';

let materialsPreflight;
let MaterialsPreflightError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/materials-preflight-service');
  materialsPreflight = mod.materialsPreflight;
  MaterialsPreflightError = mod.MaterialsPreflightError;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('available: returns { ok:true, fileCount } from the reviewer-visible listing', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterials.mockResolvedValueOnce([{ name: 'a.pdf' }, { name: 'b.pdf' }]);
  const out = await materialsPreflight({ requestId: REQ });
  expect(out).toEqual({ ok: true, fileCount: 2 });
  expect(getById).toHaveBeenCalledWith(REQ, { select: 'akoya_requestid,akoya_requestnum' });
  expect(listReviewerMaterials).toHaveBeenCalledWith(REQ, 'R-1001');
});

test('request row missing id/requestnum → 404 MaterialsPreflightError with explicit body', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ }); // no requestnum
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).toBeInstanceOf(MaterialsPreflightError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
  expect(listReviewerMaterials).not.toHaveBeenCalled();
});

test('lookup failure propagates UNTYPED (shell maps to sanitized 200 materials_unavailable)', async () => {
  getById.mockRejectedValueOnce(new Error('dataverse timeout'));
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).not.toBeInstanceOf(MaterialsPreflightError);
  expect(err.message).toBe('dataverse timeout');
});

test('listing failure propagates UNTYPED (shell maps to sanitized 200 materials_unavailable)', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterials.mockRejectedValueOnce(new Error('graph 500'));
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).not.toBeInstanceOf(MaterialsPreflightError);
  expect(err.message).toBe('graph 500');
});
