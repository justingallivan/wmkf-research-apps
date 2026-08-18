/**
 * Workbench — Proposal-tab document listing service
 * (Route→Service Consolidation Plan, Stage 4 wave).
 *
 * Holds ALL business logic for GET /api/workbench/proposal-documents; the
 * route is a thin shell (method dispatch, auth, GUID validation, DAL context,
 * HTTP mapping). Request number + cycle are resolved server-side (never
 * trusted from the client); downloads go through
 * /api/workbench/download-proposal-document, which re-validates scope.
 *
 * Contract (plan Decision 3): plain args, plain 200 body, ServiceHttpError
 * 404 (default `{ error }` envelope) when the request does not resolve;
 * ASSUMES a trusted DAL context already exists.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request';
import { meetingDateToCycleCode } from '../../utils/cycle-code';
import { listProposalDocuments } from '../workbench-proposal-documents';
import { ServiceHttpError } from '../service-http-error';

/**
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @returns {Promise<Object>} { success, slots, phaseIIDocuments, aiMaterials, otherDocuments, libraries, errors }
 * @throws {ServiceHttpError} 404 when the request does not resolve
 */
export async function listWorkbenchProposalDocuments({ requestId }) {
  let rec;
  try {
    rec = await grantRequestAdapter.getById(requestId, { select: grantRequestAdapter.SELECT_PROFILES.DOCUMENT_SCOPE });
  } catch {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }
  const requestNumber = rec.akoya_requestnum;
  const cycleCode = rec.wmkf_meetingdate ? meetingDateToCycleCode(rec.wmkf_meetingdate) : null;

  // Derive scope only from the resolved record, never the raw query param.
  const result = await listProposalDocuments(rec.akoya_requestid, requestNumber, cycleCode);
  return { success: true, ...result };
}
