/**
 * Workbench Reviewer Find — one-candidate, one-stage manual refresh.
 *
 * This is deliberately narrower than `enrichRecommended`: it refreshes only
 * the inexpensive, authoritative applicant-slot anchor.  It never accepts a
 * display name, client receipt, dependency version, or candidate key as
 * authority, and it never invokes the full applicant enrichment pipeline.
 *
 * The route establishes the trusted DAL context. This service performs only
 * exact request/suggestion/roster reads plus the roster-stage CAS writes.
 */

import { randomUUID } from 'crypto';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion.js';
import {
  completeStageRefresh,
  failStageRefresh,
  findCandidateBySuggestion,
  recoverExpiredStageRefresh,
  startStageRefresh,
} from '../reviewer-roster-store';
import { reviewerSuggestionCandidateKey } from '../../utils/reviewer-candidate-key';
import { DEFAULT_AGE_POLICY, canonicalIso } from '../reviewer-stage-freshness';
import {
  buildApplicantAnchorRefreshReceipt,
  REQUEST_SELECT,
} from './reviewer-warm-validation-service';

export const EXECUTABLE_REVIEWER_REFRESH_STAGES = Object.freeze(['applicant_anchor']);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_ROSTER_STATUS = 'active';

function guid(value) {
  return typeof value === 'string' && GUID_RE.test(value);
}

function sameGuid(left, right) {
  return guid(left) && guid(right) && left.toLowerCase() === right.toLowerCase();
}

function safeUpdatedAtToken(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isApplicantCandidate(candidate) {
  return candidate?.isApplicantRecommended === true
    || candidate?.provenance?.kind === 'applicant_suggested';
}

function candidatePersonId(candidate) {
  const value = candidate?.potentialReviewerId || candidate?.applicantKnownReviewer?.potentialReviewerId;
  return guid(value) ? value : null;
}

function outcome({
  outcome: refreshOutcome,
  requestId,
  suggestionId,
  candidateKey,
  stage,
  code = null,
} = {}) {
  return {
    outcome: refreshOutcome,
    requestId,
    suggestionId,
    candidateKey,
    stage,
    ...(code ? { code } : {}),
  };
}

function rejected(args, code) {
  return outcome({ ...args, outcome: 'rejected', code });
}

function stageRefresh(candidate) {
  const receipt = candidate?.stageFreshness?.applicant_anchor;
  return receipt && typeof receipt === 'object' ? receipt : null;
}

function expiredLease(receipt, now) {
  if (receipt?.state !== 'refreshing' || !canonicalIso(receipt.refreshStartedAt)) return false;
  return now - Date.parse(receipt.refreshStartedAt) > DEFAULT_AGE_POLICY.leaseMs;
}

/**
 * Refresh exactly the applicant-anchor receipt for one canonical suggestion.
 * Every `rejected`, `skipped_stale`, and failure result still names that one
 * canonical target; no branch accepts or synthesizes a name-based identity.
 */
export async function refreshReviewerCandidateStage({
  requestId,
  suggestionId,
  stage,
  expectedUpdatedAt,
} = {}) {
  const args = {
    requestId,
    suggestionId,
    candidateKey: reviewerSuggestionCandidateKey(suggestionId),
    stage,
  };
  if (!guid(requestId) || !guid(suggestionId) || !safeUpdatedAtToken(expectedUpdatedAt)) {
    return rejected(args, 'invalid_refresh_target');
  }
  if (!EXECUTABLE_REVIEWER_REFRESH_STAGES.includes(stage)) {
    return rejected(args, 'stage_not_executable');
  }
  if (!args.candidateKey) return rejected(args, 'invalid_refresh_target');

  const candidate = await findCandidateBySuggestion(requestId, suggestionId);
  if (
    !candidate
    || candidate.candidateKey !== args.candidateKey
    || !sameGuid(candidate.suggestionId, suggestionId)
    || candidate.rosterStatus !== ACTIVE_ROSTER_STATUS
    || !isApplicantCandidate(candidate)
  ) {
    return rejected(args, 'canonical_candidate_unavailable');
  }
  const potentialReviewerId = candidatePersonId(candidate);
  if (!potentialReviewerId) return rejected(args, 'canonical_candidate_unavailable');

  let suggestion;
  try {
    suggestion = await reviewerSuggestionAdapter.findById(suggestionId);
  } catch {
    return rejected(args, 'suggestion_anchor_unavailable');
  }
  if (
    !sameGuid(suggestion?.wmkf_appreviewersuggestionid, suggestionId)
    || !sameGuid(suggestion?._wmkf_request_value, requestId)
    || !sameGuid(suggestion?._wmkf_potentialreviewer_value, potentialReviewerId)
    || !reviewerSuggestionAdapter.hasApplicantProvenance(suggestion)
  ) {
    return rejected(args, 'suggestion_anchor_mismatch');
  }

  let currentUpdatedAt = expectedUpdatedAt.trim();
  const now = Date.now();
  const existingRefresh = stageRefresh(candidate);
  if (existingRefresh?.state === 'refreshing') {
    if (!canonicalIso(existingRefresh.refreshStartedAt) || !safeUpdatedAtToken(existingRefresh.refreshAttemptId)) {
      return rejected(args, 'refresh_lease_invalid');
    }
    if (!expiredLease(existingRefresh, now)) return rejected(args, 'refresh_in_progress');
    const recovered = await recoverExpiredStageRefresh(
      requestId,
      args.candidateKey,
      currentUpdatedAt,
      stage,
      existingRefresh.refreshAttemptId,
      { leaseMs: DEFAULT_AGE_POLICY.leaseMs },
    );
    if (recovered.outcome !== 'failed_retryable') {
      return outcome({ ...args, outcome: recovered.outcome });
    }
    if (!safeUpdatedAtToken(recovered.updatedAt)) {
      return rejected(args, 'refresh_recovery_unavailable');
    }
    currentUpdatedAt = recovered.updatedAt;
  }

  const refreshAttemptId = randomUUID();
  const started = await startStageRefresh(
    requestId,
    args.candidateKey,
    currentUpdatedAt,
    stage,
    {
      attemptId: refreshAttemptId,
      reason: 'manual_refresh',
      startedAt: new Date(now).toISOString(),
    },
  );
  if (started.outcome !== 'recorded') {
    return outcome({ ...args, outcome: started.outcome });
  }
  if (!safeUpdatedAtToken(started.updatedAt)) {
    return rejected(args, 'refresh_start_unavailable');
  }

  try {
    const request = await grantRequestAdapter.getById(requestId, { select: REQUEST_SELECT });
    if (!request) {
      const failed = await failStageRefresh(
        requestId,
        args.candidateKey,
        started.updatedAt,
        stage,
        refreshAttemptId,
        { terminal: true, errorCode: 'terminal_failure' },
      );
      return outcome({ ...args, outcome: failed.outcome });
    }
    const receipt = buildApplicantAnchorRefreshReceipt({
      request,
      candidate,
      completedAt: new Date().toISOString(),
    });
    if (!receipt) {
      const failed = await failStageRefresh(
        requestId,
        args.candidateKey,
        started.updatedAt,
        stage,
        refreshAttemptId,
        { terminal: true, errorCode: 'terminal_failure' },
      );
      return outcome({ ...args, outcome: failed.outcome });
    }
    const completed = await completeStageRefresh(
      requestId,
      args.candidateKey,
      started.updatedAt,
      stage,
      refreshAttemptId,
      receipt,
    );
    return outcome({ ...args, outcome: completed.outcome });
  } catch (error) {
    const failed = await failStageRefresh(
      requestId,
      args.candidateKey,
      started.updatedAt,
      stage,
      refreshAttemptId,
      { terminal: false, errorCode: 'retryable_failure' },
    );
    return outcome({ ...args, outcome: failed.outcome });
  }
}
