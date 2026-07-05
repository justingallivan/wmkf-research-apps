/**
 * Review Manager — reviewer-materials preflight service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for GET /api/review-manager/materials-preflight;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns { ok: true, fileCount: N };
 *   - throws MaterialsPreflightError (extends ServiceHttpError) with an
 *     explicit `body` (this route speaks `{ ok: false, reason }`, not
 *     `{ error }`) for the 404 not_found case;
 *   - any OTHER failure (lookup or listing) propagates untyped — the shell
 *     maps it to the SANITIZED 200 { ok: false, reason: 'materials_unavailable' }
 *     envelope (deliberately NOT a 500; never forwards raw Graph/Dataverse
 *     detail to the client);
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Reuses `listReviewerMaterials` (also used by the external portal context
 * route) so the count agrees with what the external portal actually shows;
 * intentionally does not re-implement the folder-policy filter.
 */

import { listReviewerMaterials } from '../../external/reviewer-materials';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

/**
 * Domain error carrying an HTTP status AND the exact non-`{ error }` JSON
 * body the shell must send (plan Decision 3, `body` set explicitly).
 */
export class MaterialsPreflightError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'MaterialsPreflightError';
  }
}

/**
 * Count the reviewer-visible SharePoint materials for a request.
 *
 * @param {Object} args
 * @param {string} args.requestId - GUID (already validated by the shell)
 * @returns {Promise<{ ok: true, fileCount: number }>}
 * @throws {MaterialsPreflightError} httpStatus 404 (body { ok:false, reason:'not_found' })
 *   when the request row lacks id/requestnum; other errors propagate untyped
 *   for the shell's sanitized materials_unavailable mapping
 */
export async function materialsPreflight({ requestId }) {
  const request = await grantRequestAdapter.getById(requestId, {
    select: grantRequestAdapter.SELECT_PROFILES.IDENTITY,
  });
  if (!request?.akoya_requestid || !request?.akoya_requestnum) {
    throw new MaterialsPreflightError('request not found', 404, { ok: false, reason: 'not_found' });
  }

  const files = await listReviewerMaterials(request.akoya_requestid, request.akoya_requestnum);
  return { ok: true, fileCount: files.length };
}
