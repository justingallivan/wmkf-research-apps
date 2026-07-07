/**
 * Review Manager — update a proposal's abstract of record.
 *
 * Backs POST /api/review-manager/update-abstract. A program director edits the
 * canonical `wmkf_abstract` on `akoya_requests` from the invite flow when the
 * stored abstract is a hard-wrapped block (see lib/utils/abstract-format.js).
 * `wmkf_abstract` is written once by GoApply at submission and is not re-synced,
 * so this edit is durable and fixes the source abstract for these reviewer
 * invites and any later read that starts from `wmkf_abstract`. It does NOT
 * retroactively rewrite a derived grantee/board version (`wmkf_abstractformatted`
 * / `wmkf_abstractapproved`) that was already generated from the old text — those
 * live behind their own approval-status gates (see lib/services/grantee-document-assembly.js).
 *
 * Route→Service Consolidation contract: takes a plain argument object, never
 * req/res; throws ServiceHttpError for domain failures (the shell maps to HTTP);
 * ASSUMES a trusted DAL context already exists — never establishes one.
 */

import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import { ServiceHttpError } from '../service-http-error';

// Generous ceiling: real proposal abstracts run a few thousand characters; this
// only guards against a pathological/abusive payload, not legitimate content.
const MAX_ABSTRACT_LEN = 20000;

/**
 * Overwrite `wmkf_abstract` for a request with staff-edited text.
 *
 * @param {Object} args
 * @param {string} args.requestId - akoya_requestid GUID (already validated by the shell)
 * @param {string} args.abstract - the new abstract text (staff-authored, trusted)
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ success: true, requestId: string, abstract: string }>}
 * @throws {ServiceHttpError} 400 on empty/oversized/non-string abstract; 404 when
 *   the request is not found
 */
export async function updateAbstract({ requestId, abstract, actingUserSystemId }) {
  if (typeof abstract !== 'string') {
    throw new ServiceHttpError('abstract must be a string', { httpStatus: 400 });
  }
  const value = abstract.trim();
  if (!value) {
    throw new ServiceHttpError('abstract must not be empty', { httpStatus: 400 });
  }
  if (value.length > MAX_ABSTRACT_LEN) {
    throw new ServiceHttpError(`abstract exceeds ${MAX_ABSTRACT_LEN} characters`, { httpStatus: 400 });
  }

  // Confirm the request exists before writing (a 404 from updateRecord is opaque).
  let rec;
  try {
    rec = await grantRequestAdapter.getById(requestId, { select: 'akoya_requestid' });
  } catch {
    rec = null;
  }
  if (!rec?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Last-write-wins, no optimistic-concurrency (If-Match) guard — consistent
  // with the sibling campaign-config write on the same staff-shared surface.
  // Two PDs editing the SAME proposal's abstract at once is a rare edge; the
  // loser's edit is lost but recoverable by re-editing. Add If-Match only if
  // concurrent abstract editing becomes a real workflow.
  await grantRequestAdapter.updateById(requestId, { wmkf_abstract: value }, { actingUserSystemId });

  return { success: true, requestId, abstract: value };
}
