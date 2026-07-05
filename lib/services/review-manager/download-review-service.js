/**
 * Review Manager — completed-review download service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for GET /api/review-manager/download-review;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping — including the BINARY 200: the shell owns headers
 * + res.send, the service never touches res).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns the plain file descriptor { buffer, mimeType, filename, size };
 *   - throws DownloadReviewError (extends ServiceHttpError) with an explicit
 *     `body` (this route speaks `{ ok: false, reason }`, not `{ error }`):
 *       404 not_found (suggestion lookup 404), 404 no_review_on_file,
 *       404 no_filename_on_row;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * File lives in SharePoint at `akoya_request/{request}/Reviewer_Uploads/...`,
 * pointed at by `wmkf_reviewsharepointfolder`; streamed via Graph as the
 * foundation's app registration. Optional `requestedFilename` selects a
 * specific file when the upload included multiple; defaults to the primary
 * filename stored on the row (wmkf_reviewfilename).
 */

import { getForDownload } from '../../dataverse/adapters/reviewer-suggestion';
import { GraphService } from '../graph-service';
import { ServiceHttpError } from '../service-http-error';

const REVIEW_LIBRARY = 'akoya_request';

/**
 * Domain error carrying an HTTP status AND the exact non-`{ error }` JSON
 * body the shell must send (plan Decision 3, `body` set explicitly).
 */
export class DownloadReviewError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'DownloadReviewError';
  }
}

/**
 * Resolve and download a completed review file.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID (already validated by the shell)
 * @param {string|undefined} args.requestedFilename - optional specific file
 * @returns {Promise<{ buffer: Buffer, mimeType: string|null, filename: string, size: number }>}
 * @throws {DownloadReviewError} 404 with body { ok:false, reason: 'not_found'
 *   | 'no_review_on_file' | 'no_filename_on_row' }; other errors propagate
 *   untyped for the shell's 500 server_error mapping
 */
export async function downloadReview({ suggestionId, requestedFilename }) {
  let suggestion;
  try {
    suggestion = await getForDownload(suggestionId);
  } catch (e) {
    if (/Get record failed \(404\)/.test(e.message || '')) {
      throw new DownloadReviewError('suggestion not found', 404, { ok: false, reason: 'not_found' });
    }
    throw e;
  }

  const folder = suggestion?.wmkf_reviewsharepointfolder;
  const primaryFilename = suggestion?.wmkf_reviewfilename;

  if (!folder) {
    throw new DownloadReviewError('no review on file', 404, { ok: false, reason: 'no_review_on_file' });
  }
  const filename = requestedFilename || primaryFilename;
  if (!filename) {
    throw new DownloadReviewError('no filename on row', 404, { ok: false, reason: 'no_filename_on_row' });
  }
  const file = await GraphService.downloadFileByPath(REVIEW_LIBRARY, folder, filename);
  return {
    buffer: file.buffer,
    mimeType: file.mimeType || null,
    filename: file.filename,
    size: file.size,
  };
}
