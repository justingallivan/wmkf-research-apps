/**
 * Workbench — Proposal-tab document download service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for GET /api/workbench/download-proposal-document;
 * the route is a thin shell (method dispatch, auth, folder-suffix pre-check,
 * DAL context, HTTP mapping — including the BINARY 200: the shell owns the
 * disposition decision + headers + res.send, the service never touches res;
 * Stage 2 download-review precedent).
 *
 * Authoritative scope: the requested (library, folder, filename) MUST be one
 * of the Proposal-tab Phase I documents the list service surfaces for this
 * request — not just any file under the request folder. Re-derived from the
 * request's own record (never from the raw query params). Library
 * allowlisting is additionally enforced by GraphService.getDriveId.
 *
 * Contract (plan Decision 3): plain args; returns the plain file descriptor
 * { buffer, mimeType, filename, size }; throws ServiceHttpError with the
 * historical `{ error }` envelopes:
 *   404 request not found, 403 not a Proposal-tab document,
 *   403 library not allowlisted, 404 file not found, 502 SharePoint failure.
 * Non-Graph errors outside the download call propagate untyped (the
 * historical route had no generic 500 mapping — the shell rethrows).
 * ASSUMES a trusted DAL context already exists.
 */

import { GraphService } from '../graph-service';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { meetingDateToCycleCode } from '../../utils/cycle-code';
import { listProposalDocuments } from '../workbench-proposal-documents';
import { ServiceHttpError } from '../service-http-error';

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID-shaped (shell validated the folder suffix)
 * @param {string} args.library
 * @param {string} args.folder
 * @param {string} args.filename
 * @returns {Promise<{ buffer: Buffer, mimeType: string, filename: string, size: number }>}
 * @throws {ServiceHttpError} 404/403/403/404/502 per the historical envelopes
 */
export async function downloadProposalDocument({ requestId, library, folder, filename }) {
  let rec;
  try {
    rec = await grantRequestAdapter.getById(requestId, { select: grantRequestAdapter.SELECT_PROFILES.DOCUMENT_SCOPE });
  } catch {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }
  const cycleCode = rec.wmkf_meetingdate ? meetingDateToCycleCode(rec.wmkf_meetingdate) : null;
  const { slots, otherDocuments } = await listProposalDocuments(rec.akoya_requestid, rec.akoya_requestnum, cycleCode);
  const allowed = new Set([
    ...slots.filter((s) => s.found).map((s) => `${s.library}::${s.folder}::${s.name}`),
    ...otherDocuments.map((d) => `${d.library}::${d.folder}::${d.name}`),
  ]);
  if (!allowed.has(`${library}::${folder}::${filename}`)) {
    throw new ServiceHttpError('File is not a Proposal-tab document for this request', { httpStatus: 403 });
  }

  try {
    return await GraphService.downloadFileByPath(
      String(library),
      String(folder),
      String(filename),
    );
  } catch (error) {
    console.error('Proposal document download error:', error.message);
    if (error.message.includes('not in the allowlist')) {
      throw new ServiceHttpError('Access to this document library is not permitted', { httpStatus: 403 });
    }
    if (error.message.includes('File not found') || error.message.includes('(404)')) {
      throw new ServiceHttpError('File not found', { httpStatus: 404 });
    }
    throw new ServiceHttpError('Failed to download document from SharePoint', { httpStatus: 502 });
  }
}
