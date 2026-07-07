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
 * @param {string} [args.expectedCurrent] - the abstract text the editor was seeded
 *   from (the render's `currentAbstract`). When a string is supplied, the save is
 *   an optimistic compare-and-set: it is rejected 409 if the live `wmkf_abstract`
 *   no longer matches. Omit to fall back to last-write-wins.
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ success: true, requestId: string, abstract: string }>}
 * @throws {ServiceHttpError} 400 on empty/oversized/non-string abstract; 404 when
 *   the request is not found; 409 when a concurrent edit changed the abstract
 *   since the editor was opened
 */
export async function updateAbstract({ requestId, abstract, expectedCurrent, actingUserSystemId }) {
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

  // Read the live abstract to confirm existence (a 404 from updateRecord is
  // opaque) AND to run the optimistic-concurrency check below.
  let rec;
  try {
    rec = await grantRequestAdapter.getById(requestId, { select: 'akoya_requestid,wmkf_abstract' });
  } catch {
    rec = null;
  }
  if (!rec?.akoya_requestid) {
    throw new ServiceHttpError(`No request found for ${requestId}`, { httpStatus: 404 });
  }

  // Optimistic compare-and-set (opt-in via expectedCurrent): reject rather than
  // silently clobber if another PD/workflow rewrote the abstract since this
  // editor was opened — the modal can stay open for minutes, so a lost update is
  // the realistic failure. Targeted on `wmkf_abstract` (NOT a row-version
  // If-Match) so an unrelated concurrent write to the same request — e.g. the
  // invite "invited" bookkeeping stamp on this very send flow — does not
  // spuriously conflict. A sub-second read→write TOCTOU window remains and is
  // left uncovered: two humans colliding inside it is not a real risk for a
  // twice-a-year outreach.
  if (typeof expectedCurrent === 'string' && (rec.wmkf_abstract || '') !== expectedCurrent) {
    throw new ServiceHttpError(
      'This abstract was changed by someone else since you opened it. Reload and re-apply your fix.',
      { httpStatus: 409 }
    );
  }

  await grantRequestAdapter.updateById(requestId, { wmkf_abstract: value }, { actingUserSystemId });

  return { success: true, requestId, abstract: value };
}
