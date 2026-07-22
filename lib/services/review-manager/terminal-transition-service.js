/**
 * Review Manager — fail-closed post-accept terminal transition service.
 *
 * Terminal statuses are intentionally isolated from the generic reviewers
 * PATCH. Every row is freshly read, state-checked, and conditionally written
 * with that read's ETag. A concurrent review submission therefore wins and
 * the terminal transition reports changed_skipped instead of overwriting it.
 */

import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { TERMINAL_REVIEW_STATUS_VALUES, isTerminalReviewStatus } from '../../../shared/config/reviewerStatus';
import { ServiceHttpError } from '../service-http-error';

const ALLOWED_SOURCE_VALUES = new Set([
  suggestionAdapter.REVIEW_STATUS_MAP.accepted,
  suggestionAdapter.REVIEW_STATUS_MAP.materials_sent,
  suggestionAdapter.REVIEW_STATUS_MAP.under_review,
]);
const TERMINAL_SOURCE_VALUES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

export class TerminalTransitionError extends ServiceHttpError {
  constructor(message, httpStatus, body) {
    super(message, { httpStatus, body });
    this.name = 'TerminalTransitionError';
  }
}

function rowStatus(row) {
  if (row.wmkf_accepted !== true) return 'not_accepted';
  if (row.wmkf_reviewreceivedat) return 'review_received';
  if (row.wmkf_completedat) return 'completed';
  if (TERMINAL_SOURCE_VALUES.has(row.wmkf_reviewstatus)) return 'already_terminal';
  if (!ALLOWED_SOURCE_VALUES.has(row.wmkf_reviewstatus)) return 'invalid_source';
  if (!row._etag) return 'missing_etag';
  return null;
}

/**
 * @returns {Promise<{ok: true, transitioned: number, results: Array}>}
 */
export async function transitionReviewersTerminal({
  requestId,
  suggestionIds,
  terminalStatus,
  actingUserSystemId,
}) {
  if (!isTerminalReviewStatus(terminalStatus)) {
    throw new TerminalTransitionError('terminalStatus must be withdrew or released', 400);
  }

  const results = [];
  let transitioned = 0;

  for (const suggestionId of suggestionIds) {
    let row;
    try {
      row = await suggestionAdapter.findById(suggestionId);
    } catch (error) {
      results.push({
        suggestionId,
        status: 'read_failed',
        error: String(error?.message || error).slice(0, 200),
      });
      continue;
    }
    if (!row) {
      results.push({ suggestionId, status: 'not_found' });
      continue;
    }
    if (!row._wmkf_request_value
        || String(row._wmkf_request_value).toLowerCase() !== requestId.toLowerCase()) {
      results.push({ suggestionId, status: 'wrong_request' });
      continue;
    }

    const rejected = rowStatus(row);
    if (rejected) {
      results.push({ suggestionId, status: rejected });
      continue;
    }

    try {
      await suggestionAdapter.updateLifecycle(
        suggestionId,
        { reviewStatus: terminalStatus },
        { actingUserSystemId, ifMatch: row._etag },
      );
      transitioned += 1;
      results.push({ suggestionId, status: 'transitioned', terminalStatus });
    } catch (error) {
      const changed = error?.status === 412 || /\b412\b/.test(error?.message || '');
      results.push({
        suggestionId,
        status: changed ? 'changed_skipped' : 'write_failed',
        error: String(error?.message || error).slice(0, 200),
      });
    }
  }

  return { ok: true, transitioned, results };
}

export const _terminalTransitionInternals = { rowStatus };
