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
const listReviewerMaterialsWithAvailability = jest.fn();
jest.mock('../../lib/external/reviewer-materials', () => ({
  listReviewerMaterialsWithAvailability: (...a) => listReviewerMaterialsWithAvailability(...a),
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
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce({ files: [{ name: 'a.pdf' }, { name: 'b.pdf' }], unavailable: false });
  const out = await materialsPreflight({ requestId: REQ });
  expect(out).toEqual({ ok: true, fileCount: 2 });
  expect(getById).toHaveBeenCalledWith(REQ, { select: 'akoya_requestid,akoya_requestnum' });
  expect(listReviewerMaterialsWithAvailability).toHaveBeenCalledWith(REQ, 'R-1001');
});

test('request row missing id/requestnum → 404 MaterialsPreflightError with explicit body', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ }); // no requestnum
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).toBeInstanceOf(MaterialsPreflightError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
  expect(listReviewerMaterialsWithAvailability).not.toHaveBeenCalled();
});

test('lookup failure propagates UNTYPED (shell maps to sanitized 200 materials_unavailable)', async () => {
  getById.mockRejectedValueOnce(new Error('dataverse timeout'));
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).not.toBeInstanceOf(MaterialsPreflightError);
  expect(err.message).toBe('dataverse timeout');
});

test('listing failure propagates UNTYPED (shell maps to sanitized 200 materials_unavailable)', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterialsWithAvailability.mockRejectedValueOnce(new Error('graph 500'));
  const err = await materialsPreflight({ requestId: REQ }).catch((e) => e);
  expect(err).not.toBeInstanceOf(MaterialsPreflightError);
  expect(err.message).toBe('graph 500');
});

test('a failed SharePoint bucket is unavailable, not verified empty', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce({ files: [], unavailable: true });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: false, reason: 'materials_unavailable' });
});

test('a found file cannot turn a partial bucket scan into verified availability', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce({ files: [{ name: 'Proposal_R-1001.pdf' }], unavailable: true });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: false, reason: 'materials_unavailable' });
});

test('a successful complete listing with no matching canonical file is verified empty', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce({ files: [], unavailable: false });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: true, fileCount: 0 });
});

// Exercise the actual error classification and exact-file policy. Only Graph
// and bucket discovery are replaced; the service consumes the real projection.
function useRealListing({ primaryFiles, primaryError, archiveError }) {
  const actual = jest.requireActual('../../lib/external/reviewer-materials');
  listReviewerMaterialsWithAvailability.mockImplementationOnce((requestId, requestNumber) => (
    actual.listReviewerMaterialsWithAvailability(requestId, requestNumber, {
      getRequestSharePointBuckets: async () => [
        { library: 'primary', folder: 'fixture', source: 'dynamics' },
        ...[1, 2, 3].map((n) => ({ library: `archive${n}`, folder: 'fixture', source: 'archive' })),
      ],
      listFiles: async (library) => {
        if (library === 'primary') {
          if (primaryError) throw primaryError;
          return primaryFiles;
        }
        if (archiveError) throw archiveError;
        return [canonical];
      },
    })
  ));
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
}
const canonical = { name: 'Proposal_R-1001.pdf', folder: 'fixture/Reviewer Materials' };
const absentArchive = () => Object.assign(new Error('expected missing archive'), { code: 'graph_folder_not_found', status: 404 });

test('canonical file plus three expected missing archives is available without exposing internal/wrong-request files', async () => {
  useRealListing({ primaryFiles: [canonical,
    { name: 'Research Phase I Application_timestamp.pdf', folder: 'fixture/Reviewer Materials' },
    { name: 'Proposal_R-9999.pdf', folder: 'fixture/Reviewer Materials' },
    { ...canonical, folder: 'fixture/Phase II' },
  ], archiveError: absentArchive() });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: true, fileCount: 1 });
});

test('expected missing archives with no canonical file remains verified empty', async () => {
  useRealListing({ primaryFiles: [
    { name: 'Research Phase I Application_timestamp.pdf', folder: 'fixture/Reviewer Materials' },
  ], archiveError: absentArchive() });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: true, fileCount: 0 });
});

test.each([
  { status: 403 }, { status: 429 }, { status: 500 }, { status: 404 },
])('archive failure %j still blocks when a canonical PDF is present', async (props) => {
  useRealListing({ primaryFiles: [canonical], archiveError: Object.assign(new Error('archive failure'), props) });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: false, reason: 'materials_unavailable' });
});

test('missing tracked Dynamics bucket still blocks even with the canonical PDF in an archive', async () => {
  useRealListing({ primaryError: absentArchive() });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: false, reason: 'materials_unavailable' });
});

test.each([undefined, null, {}, '', 'archive'])('unavailable with missing/malformed source classification %j stays closed', async (unavailableSources) => {
  getById.mockResolvedValueOnce({ akoya_requestid: REQ, akoya_requestnum: 'R-1001' });
  listReviewerMaterialsWithAvailability.mockResolvedValueOnce({ files: [canonical], unavailable: true, unavailableSources });
  await expect(materialsPreflight({ requestId: REQ })).resolves.toEqual({ ok: false, reason: 'materials_unavailable' });
});
