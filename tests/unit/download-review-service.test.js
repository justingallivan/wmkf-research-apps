/**
 * Logic-level unit tests for lib/services/review-manager/download-review-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapter + GraphService mocked; covers the plain file-descriptor return
 * (the SHELL owns headers + res.send), the three 404 domain errors with
 * explicit { ok:false, reason } bodies, and untyped propagation.
 */

const getForDownload = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  getForDownload: (...a) => getForDownload(...a),
}));
const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: (...a) => downloadFileByPath(...a) },
}));

const SUG = '22222222-2222-4222-8222-222222222222';

let downloadReview;
let DownloadReviewError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/download-review-service');
  downloadReview = mod.downloadReview;
  DownloadReviewError = mod.DownloadReviewError;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('returns plain file descriptor; requested filename wins over primary', async () => {
  getForDownload.mockResolvedValueOnce({
    wmkf_reviewsharepointfolder: 'R-1001/Reviewer_Uploads/jane',
    wmkf_reviewfilename: 'primary.pdf',
  });
  const buf = Buffer.from('pdf-bytes');
  downloadFileByPath.mockResolvedValueOnce({ buffer: buf, mimeType: 'application/pdf', filename: 'other.pdf', size: 9 });
  const out = await downloadReview({ suggestionId: SUG, requestedFilename: 'other.pdf' });
  expect(downloadFileByPath).toHaveBeenCalledWith('akoya_request', 'R-1001/Reviewer_Uploads/jane', 'other.pdf');
  expect(out).toEqual({ buffer: buf, mimeType: 'application/pdf', filename: 'other.pdf', size: 9 });
});

test('defaults to the primary filename stored on the row', async () => {
  getForDownload.mockResolvedValueOnce({
    wmkf_reviewsharepointfolder: 'folder',
    wmkf_reviewfilename: 'primary.pdf',
  });
  downloadFileByPath.mockResolvedValueOnce({ buffer: Buffer.alloc(1), mimeType: null, filename: 'primary.pdf', size: 1 });
  const out = await downloadReview({ suggestionId: SUG, requestedFilename: undefined });
  expect(downloadFileByPath).toHaveBeenCalledWith('akoya_request', 'folder', 'primary.pdf');
  expect(out.mimeType).toBeNull(); // shell applies the octet-stream default
});

test('lookup 404 → DownloadReviewError 404 { ok:false, reason:"not_found" }', async () => {
  getForDownload.mockRejectedValueOnce(new Error('Get record failed (404)'));
  const err = await downloadReview({ suggestionId: SUG }).catch((e) => e);
  expect(err).toBeInstanceOf(DownloadReviewError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
});

test('no folder on row → 404 no_review_on_file; no filename → 404 no_filename_on_row', async () => {
  getForDownload.mockResolvedValueOnce({ wmkf_reviewsharepointfolder: null });
  let err = await downloadReview({ suggestionId: SUG }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'no_review_on_file' });

  getForDownload.mockResolvedValueOnce({ wmkf_reviewsharepointfolder: 'folder', wmkf_reviewfilename: null });
  err = await downloadReview({ suggestionId: SUG }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'no_filename_on_row' });
  expect(downloadFileByPath).not.toHaveBeenCalled();
});

test('non-404 lookup and Graph failures propagate UNTYPED (shell maps to 500 server_error)', async () => {
  getForDownload.mockRejectedValueOnce(new Error('dataverse 503'));
  let err = await downloadReview({ suggestionId: SUG }).catch((e) => e);
  expect(err).not.toBeInstanceOf(DownloadReviewError);

  getForDownload.mockResolvedValueOnce({ wmkf_reviewsharepointfolder: 'folder', wmkf_reviewfilename: 'a.pdf' });
  downloadFileByPath.mockRejectedValueOnce(new Error('graph down'));
  err = await downloadReview({ suggestionId: SUG }).catch((e) => e);
  expect(err).not.toBeInstanceOf(DownloadReviewError);
  expect(err.message).toBe('graph down');
});
