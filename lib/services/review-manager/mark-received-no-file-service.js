/**
 * Review Manager — mark review received without a stored file, service
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Holds ALL business logic for POST /api/review-manager/mark-received-no-file;
 * the route is a thin shell (method dispatch, auth, GUID validation, DAL
 * context, HTTP mapping).
 *
 * Contract (plan Decision 3):
 *   - takes a plain argument object, never req/res;
 *   - returns { ok: true };
 *   - throws MarkReceivedNoFileError (extends ServiceHttpError) for domain
 *     failures. This route's envelopes are NOT `{ error }`-shaped, so every
 *     domain error sets `body` explicitly:
 *       400 form-validation → body = the validateReviewForm result verbatim;
 *       404 → body = { ok: false, reason: 'not_found' };
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 *
 * Semantics preserved exactly from the route (characterization tests are the
 * oracle):
 *   - validation runs against the LIVE question set (fail-closed), partial
 *     mode, exactly like the reviewer submit path;
 *   - zero rating rows ("informal feedback" scenario) → a single
 *     patchReviewReceipt PATCH — no snapshot rows, aggregates keep skipping
 *     the row;
 *   - one or more rating rows → rating upserts (by alternate key) + the
 *     parent PATCH in ONE atomic changeset, so a parent-only row can never be
 *     left behind on a partial failure (the exact gap Phase D closes);
 *   - a 404-shaped write failure (message regex or e.status) maps to the
 *     not_found envelope; anything else propagates to the shell's 500.
 */

import { validateReviewForm } from '../../external/review-form-schema';
import { getAuthoritativeQuestionSet } from '../../external/review-question-fetcher';
import { buildMultiselectSnapshotRows, buildRatingSnapshotRows } from '../../external/review-answer-snapshot';
import {
  getByIdWithSelect,
  patchReviewReceipt,
  ENTITY_SET_NAME as SUGGESTION_ENTITY_SET,
} from '../../dataverse/adapters/reviewer-suggestion';
import { answerUpsertDescriptor } from '../../dataverse/adapters/review-answer';
import { runChangeset, atomicParentWithChildren } from '../../dataverse/core/changeset';
import { ServiceHttpError } from '../service-http-error';
import {
  authorizeReviewReceipt,
  isReviewReceiptPreconditionFailure,
  REVIEW_RECEIPT_GUARD_SELECT,
  ReviewReceiptEligibilityError,
} from '../review-receipt-guard';
import { REVIEW_STATUS_MAP } from '../../../shared/config/reviewerLifecycle';

const ENTITY_SET = SUGGESTION_ENTITY_SET;

/**
 * Domain error carrying an HTTP status AND the exact non-`{ error }` JSON
 * body the shell must send (plan Decision 3, `body` set explicitly).
 */
export class MarkReceivedNoFileError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'MarkReceivedNoFileError';
  }
}

/**
 * Record a review as received without a stored file.
 *
 * @param {Object} args
 * @param {string} args.suggestionId - GUID (already validated by the shell)
 * @param {Object|undefined} args.structuredData - optional partial form data
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ ok: true }>}
 * @throws {MarkReceivedNoFileError} 400 (form validation, body = validator result)
 *   or 404 (body = { ok: false, reason: 'not_found' })
 */
export async function markReceivedNoFile({ suggestionId, structuredData, actingUserSystemId }) {
  // Validate against the LIVE question set (fail-closed) so a staff-edited
  // rating domain/order is honoured exactly as the reviewer submit path does.
  // Authoritative (uncached) resolve: write boundary — this set decides which
  // rating snapshot rows get persisted.
  const questionSet = await getAuthoritativeQuestionSet();
  const formResult = validateReviewForm(structuredData, { partial: true, fields: questionSet });
  if (!formResult.ok) {
    throw new MarkReceivedNoFileError('review form validation failed', 400, formResult);
  }

  const patch = {
    ...formResult.dataverseValues,
    wmkf_reviewreceivedat: new Date().toISOString(),
    wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received,
    wmkf_reviewuploadedbystaff: true,
  };

  // Write structured snapshot rows. Post-Phase-E ratings live ONLY in the
  // snapshot (`patch` no longer carries rating columns); multiselect answers
  // use the same atomic boundary. Only answers actually present get a row —
  // informal feedback omits structuredData, so no snapshot row is written.
  const ratingRows = buildRatingSnapshotRows(formResult.ratings, questionSet);
  const multiselectRows = buildMultiselectSnapshotRows(formResult.multiselects, questionSet);
  const snapshotRows = [...ratingRows, ...multiselectRows];
  const snapshotKeys = new Set(
    questionSet.filter((f) => f.type === 'picklist' || f.type === 'multiselect' || f.type === 'richtext').map((f) => f.key),
  );

  let authorization;
  try {
    const suggestion = await getByIdWithSelect(suggestionId, REVIEW_RECEIPT_GUARD_SELECT);
    authorization = authorizeReviewReceipt(suggestion);
  } catch (error) {
    if (error instanceof ReviewReceiptEligibilityError) {
      const status = error.reason === 'not_found' ? 404 : 409;
      throw new MarkReceivedNoFileError(error.reason, status, { ok: false, reason: error.reason });
    }
    if (error?.status === 404 || error?.response?.status === 404) {
      throw new MarkReceivedNoFileError('suggestion not found', 404, { ok: false, reason: 'not_found' });
    }
    throw error;
  }

  try {
    if (snapshotRows.length === 0) {
      await patchReviewReceipt(suggestionId, patch, {
        actingUserSystemId,
        ifMatch: authorization.ifMatch,
      });
    } else {
      // Atomic: rating upserts (by alternate key) + the parent PATCH in one
      // changeset, so a parent-only row can never be left behind on a partial
      // failure (the exact gap Phase D closes).
      const children = snapshotRows.map((row) => answerUpsertDescriptor(suggestionId, row, snapshotKeys));
      const parent = {
        method: 'PATCH',
        entitySet: ENTITY_SET,
        key: suggestionId,
        body: patch,
        ifMatch: authorization.ifMatch,
      };
      await runChangeset(atomicParentWithChildren({ parent, children }), { actingUserSystemId });
    }
  } catch (e) {
    if (/(?:update|changeset).*404/i.test(e.message || '') || e.status === 404) {
      throw new MarkReceivedNoFileError('suggestion not found', 404, { ok: false, reason: 'not_found' });
    }
    if (isReviewReceiptPreconditionFailure(e)) {
      throw new MarkReceivedNoFileError('review receipt conflict', 409, { ok: false, reason: 'conflict' });
    }
    throw e;
  }

  return { ok: true };
}
