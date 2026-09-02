/**
 * Pure report builder for the read-only review-due reminder token audit.
 */
import { meetingDateToCycleCode } from '../utils/cycle-code.js';
import { resolveEffectiveReviewDueDate } from '../external/reviewer-due-date.js';
import { deriveReviewerTokenState } from '../external/reviewer-token-state.js';
import { reviewDueCandidateFilter } from './reviewer-reminder-candidate.js';
import {
  REVIEW_DUE_TOKEN_BLOCK_REASONS,
  evaluateReviewDueReminderEligibility,
} from './reviewer-reminder-eligibility.js';

const TOKEN_STATES = ['not_minted', 'revoked', 'invalid', 'expired', 'active'];

export function buildReviewerReminderLivenessReport({
  rows,
  requestById,
  cycleCode,
  nowMs = Date.now(),
} = {}) {
  const tokenStates = Object.fromEntries(TOKEN_STATES.map((state) => [state, 0]));
  const reminderEligibility = {
    eligible: 0,
    ...Object.fromEntries(REVIEW_DUE_TOKEN_BLOCK_REASONS.map((reason) => [reason, 0])),
  };
  const blockedRows = [];
  let examined = 0;

  for (const row of rows || []) {
    const request = requestById?.[row._wmkf_request_value];
    if (!request || meetingDateToCycleCode(request.wmkf_meetingdate) !== cycleCode) continue;

    examined += 1;
    const tokenState = deriveReviewerTokenState(row, { nowMs });
    tokenStates[tokenState] = (tokenStates[tokenState] || 0) + 1;
    const dueYmd = resolveEffectiveReviewDueDate({
      overrideDate: row.wmkf_reviewduedateoverride,
      defaultDate: request.wmkf_reviewduedate,
    });
    const eligibility = evaluateReviewDueReminderEligibility({
      row,
      effectiveReviewDueDate: dueYmd,
      nowMs,
    });
    const outcome = eligibility.eligible ? 'eligible' : eligibility.reason;
    reminderEligibility[outcome] = (reminderEligibility[outcome] || 0) + 1;
    if (!eligibility.eligible) {
      blockedRows.push({
        requestNumber: request.akoya_requestnum || null,
        requestId: request.akoya_requestid || row._wmkf_request_value || null,
        suggestionId: row.wmkf_appreviewersuggestionid || null,
        tokenState,
        reason: eligibility.reason,
        effectiveReviewDueDate: dueYmd,
        tokenExpiresAt: row.wmkf_externaltokenexpires || null,
      });
    }
  }

  return {
    asOf: new Date(nowMs).toISOString(),
    cycleCode,
    policy: 'Token must be live now and expire strictly after a future effective review deadline; overdue reviews require only current liveness.',
    candidateFilter: reviewDueCandidateFilter(),
    totalRowsExamined: examined,
    tokenStates,
    reminderEligibility,
    blockedRows,
  };
}
