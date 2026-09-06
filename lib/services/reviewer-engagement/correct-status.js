/**
 * Reviewer engagement — status/response correction command
 * (Reviewer Lifecycle Stage 3C: extracted from
 * `lib/services/review-manager/reviewers-service.js`, which now re-exports
 * these two names for compatibility — `instanceof` and reference identity
 * (`toBe`) hold across both import paths).
 *
 * `getReviewers` and its projections stay in the old module; this file holds
 * only the generic PATCH correction command and its dedicated error class.
 */

import { TERMINAL_REVIEW_STATUS_VALUES, isTerminalReviewStatus } from '../../../shared/config/reviewerStatus.js';
import { REVIEW_STATUS_MAP } from '../../../shared/config/reviewerLifecycle.js';
import { ServiceHttpError } from '../service-http-error';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';

/**
 * Internal carrier for an invoked adapter operation that did not confirm success.
 * The route owns HTTP sanitation; cause remains the original adapter failure.
 * failedIds includes validation/guard failures before a write and transport
 * failures after a possible commit; it proves neither that a write began nor
 * that it did not commit.
 */
export class ReviewerStatusMutationError extends Error {
  constructor(cause, { savedIds, failedIds, notAttemptedIds }) {
    super('Reviewer status mutation was not confirmed');
    this.name = 'ReviewerStatusMutationError';
    this.cause = cause;
    this.savedIds = savedIds;
    this.failedIds = failedIds;
    this.notAttemptedIds = notAttemptedIds;
  }
}

/**
 * Apply a batch or single lifecycle update after route input/ownership checks.
 * Adapter field validation can still reject an invoked operation.
 *
 * Canonical unique batch targets are awaited sequentially. One adapter failure
 * throws with the confirmed prefix, uncertain current ID and unattempted suffix;
 * do not parallelize, continue, or replay the confirmed prefix.
 *
 * Complete and the post-accept terminal statuses are dedicated human workflows;
 * this generic correction seam refuses all three before any row is written.
 *
 * @param {Object} args
 * @param {string[]|null} args.suggestionIds - batch ids (GUID-validated by the shell), or null
 * @param {string|undefined} args.reviewStatus - required for batch
 * @param {string|null} args.suggestionId - single id (GUID-validated by the shell)
 * @param {Object} args.lifecycle - single-update fields (non-empty, built by the shell)
 * @param {string|null} args.actingUserSystemId - Dynamics systemuser of the staff actor
 * @returns {Promise<{ success: true, message: string, savedIds: string[], failedIds: string[], notAttemptedIds: string[] }>}
 */
export async function patchReviewers({ suggestionIds, reviewStatus, suggestionId, lifecycle, actingUserSystemId }) {
  const isBatch = Array.isArray(suggestionIds) && suggestionIds.length > 0;
  const requestedStatus = isBatch ? reviewStatus : lifecycle?.reviewStatus;
  const normalizedStatus = typeof requestedStatus === 'string'
    ? requestedStatus.trim().toLowerCase()
    : requestedStatus;
  if (normalizedStatus === 'complete' || normalizedStatus === REVIEW_STATUS_MAP.complete) {
    throw new ServiceHttpError('Complete requires the dedicated reviewer closeout endpoint', {
      httpStatus: 400,
    });
  }
  if (isTerminalReviewStatus(normalizedStatus)
      || Object.values(TERMINAL_REVIEW_STATUS_VALUES).includes(normalizedStatus)) {
    throw new ServiceHttpError('Terminal reviewer statuses require the dedicated transition endpoint', {
      httpStatus: 400,
    });
  }
  const targets = isBatch
    ? [...new Set(suggestionIds.map(id => id.trim().toLowerCase()))]
    : [suggestionId];
  const payload = isBatch ? { reviewStatus } : lifecycle;
  for (let index = 0; index < targets.length; index += 1) {
    try {
      await suggestionAdapter.updateLifecycle(targets[index], payload, { actingUserSystemId });
    } catch (cause) {
      throw new ReviewerStatusMutationError(cause, {
        savedIds: targets.slice(0, index),
        failedIds: [targets[index]],
        notAttemptedIds: targets.slice(index + 1),
      });
    }
  }
  return {
    success: true,
    message: isBatch ? `Updated ${targets.length} reviewers` : 'Reviewer updated',
    savedIds: targets,
    failedIds: [],
    notAttemptedIds: [],
  };
}
