/**
 * Workbench — reviewer-candidate .xlsx export service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for POST /api/workbench/export-candidates; the
 * route is a thin shell (method dispatch, auth, input validation, DAL
 * context, HTTP mapping — the BINARY 200: the shell owns headers + res.send,
 * the service never touches res; Stage 2 download-review precedent).
 *
 * Builds a two-sheet reviewer-candidate workbook (Request Info + Candidates)
 * for the PD to share. The enriched candidate data lives only in the Find-tab
 * client (reasoning, COI, ORCID, Scholar are computed at search time and not
 * all persisted), so the client supplies the rows; this service fetches the
 * request metadata (number / institution / PI) AUTHORITATIVELY by requestId —
 * never trusted from the client. Read-only against Dataverse (one
 * akoya_request read); writes nothing.
 *
 * Contract (plan Decision 3): plain args; returns { buffer, filename };
 * throws ServiceHttpError 404 (default `{ error }` envelope) when the request
 * does not resolve; ASSUMES a trusted DAL context already exists.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { meetingDateToCycleCode, cycleCodeToLabel } from '../../utils/cycle-code';
import { buildReviewerCandidateWorkbook } from '../reviewer-candidate-export';
import { ServiceHttpError } from '../service-http-error';

// Same akoya_request fields resolve-request.js reads for the header context.
const REQUEST_SELECT = [
  'akoya_requestid',
  'akoya_requestnum',
  'akoya_title',
  'wmkf_organizationname',
  '_akoya_applicantid_value',
  '_wmkf_projectleader_value',
  '_wmkf_grantprogram_value',
  'wmkf_meetingdate',
].join(',');

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @param {Array<Object>} args.candidates - slim candidate DTOs (shell validated size)
 * @returns {Promise<{ buffer: Buffer, filename: string }>}
 * @throws {ServiceHttpError} 404 when the request does not resolve
 */
export async function exportCandidates({ requestId, candidates }) {
  const r = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT })
    .catch(() => null);
  if (!r) {
    throw new ServiceHttpError('Request not found', { httpStatus: 404 });
  }

  const cycleCode = r.wmkf_meetingdate ? meetingDateToCycleCode(r.wmkf_meetingdate) : null;
  const exportedDate = new Date().toISOString().slice(0, 10);
  const meta = {
    requestNumber: r.akoya_requestnum || null,
    institution: r.wmkf_organizationname || r._akoya_applicantid_value_formatted || null,
    pi: r._wmkf_projectleader_value_formatted || null,
    applicant: r._akoya_applicantid_value_formatted || null,
    title: r.akoya_title || null,
    program: r._wmkf_grantprogram_value_formatted || null,
    cycleLabel: cycleCode ? cycleCodeToLabel(cycleCode) : null,
    exportedDate,
  };

  const buffer = await buildReviewerCandidateWorkbook({ meta, candidates });

  const safeNum = (meta.requestNumber || 'request').replace(/[^\w.-]+/g, '_');
  const filename = `reviewer-candidates-${safeNum}-${exportedDate}.xlsx`;
  return { buffer, filename };
}
