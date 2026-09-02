/**
 * Review-due reminder eligibility for the reviewer's existing magic link.
 *
 * A generic reminder never mints or replaces authority. It may be sent only
 * when the stored token is live and remains live through a future effective
 * review deadline. For an already-overdue review, being live now is enough.
 */
import { deriveReviewerTokenState } from '../external/reviewer-token-state.js';

export const REVIEW_DUE_TOKEN_BLOCK_REASONS = Object.freeze([
  'token_revoked',
  'token_not_minted',
  'token_invalid_data',
  'token_expired',
  'token_insufficient_window',
  'due_date_missing',
]);

const STATE_REASON = Object.freeze({
  revoked: 'token_revoked',
  not_minted: 'token_not_minted',
  invalid: 'token_invalid_data',
  expired: 'token_expired',
});

export function evaluateReviewDueReminderEligibility({
  row,
  effectiveReviewDueDate,
  nowMs = Date.now(),
} = {}) {
  const tokenState = deriveReviewerTokenState(row, { nowMs });
  if (STATE_REASON[tokenState]) {
    return { eligible: false, reason: STATE_REASON[tokenState], tokenState };
  }

  const dueMs = typeof effectiveReviewDueDate === 'string'
    ? Date.parse(`${effectiveReviewDueDate}T23:59:59Z`)
    : NaN;
  if (!Number.isFinite(dueMs)) {
    return { eligible: false, reason: 'due_date_missing', tokenState };
  }

  const expiryMs = Date.parse(row?.wmkf_externaltokenexpires || '');
  const requiredThroughMs = Math.max(nowMs, dueMs);
  if (expiryMs <= requiredThroughMs) {
    return {
      eligible: false,
      reason: 'token_insufficient_window',
      tokenState,
      requiredThroughMs,
      expiryMs,
    };
  }

  return {
    eligible: true,
    reason: null,
    tokenState,
    requiredThroughMs,
    expiryMs,
  };
}
