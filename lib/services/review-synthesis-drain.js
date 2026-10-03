import * as suggestionAdapter from '../dataverse/adapters/reviewer-suggestion.js';
import { evaluateReviewSynthesisReadiness } from './review-synthesis-readiness.js';
import {
  loadReviewSynthesisContext,
  synthesizeReviews,
} from './review-manager/synthesize-reviews-service.js';
import {
  cancelReviewSynthesisJob,
  claimAutomaticReviewSynthesisJobs,
  enqueueAutomaticReviewSynthesisJob,
  recordReviewSynthesisJobFailure,
  releaseReviewSynthesisJob,
} from './review-synthesis-job-service.js';
import { createRequestTestStateLookup, recordTestRequestSkip } from './test-requests/request-test-state.js';

const DEFAULT_SCAN_LIMIT = 25;
const DEFAULT_CLAIM_LIMIT = 1;
// Unknown test-request states that can never become readable (Stage 1c).
const PERMANENT_UNKNOWN_REASONS = new Set(['request_not_found', 'request_id_invalid']);

function groupByRequest(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const requestId = row?._wmkf_request_value;
    if (!requestId) continue;
    if (!grouped.has(requestId)) grouped.set(requestId, []);
    grouped.get(requestId).push(row);
  }
  return grouped;
}

export async function drainReviewSynthesisJobs({
  scanLimit = DEFAULT_SCAN_LIMIT,
  claimLimit = DEFAULT_CLAIM_LIMIT,
  lockSeconds = 600,
} = {}) {
  const scan = await suggestionAdapter.findReviewSynthesisParticipants();
  if (scan.capped) {
    throw new Error('review synthesis participant scan hit the Dataverse 5000-row cap');
  }

  const grouped = groupByRequest(scan.records);
  let eligible = 0;
  let enqueued = 0;
  let alreadyTracked = 0;
  // Scheduled jobs never act on test requests (Test Request Factory Stage 1c):
  // no automatic job is enqueued for one, and a job enqueued before the switch
  // was on is cancelled (its own Postgres row only) before any provider call
  // or request write. An unreadable marker requeues the job without using up
  // an attempt.
  const requestTestState = createRequestTestStateLookup();
  const testSkips = {};

  for (const [requestId, rows] of grouped) {
    if (eligible >= scanLimit) break;
    const testState = await requestTestState(requestId);
    if (testState.kind !== 'ordinary') { recordTestRequestSkip(testSkips, testState); continue; }
    const lifecycleOnly = evaluateReviewSynthesisReadiness(rows);
    if (!lifecycleOnly.ready) continue;
    eligible += 1;
    const context = await loadReviewSynthesisContext(requestId, { suggestions: rows });
    if (!context.readiness.ready) continue;
    const job = await enqueueAutomaticReviewSynthesisJob({
      requestId,
      inputHash: context.readiness.inputHash,
    });
    if (job.status === 'queued') enqueued += 1;
    else alreadyTracked += 1;
  }

  const jobs = await claimAutomaticReviewSynthesisJobs({
    limit: claimLimit,
    lockSeconds,
  });
  const result = {
    scannedRequests: grouped.size,
    eligible,
    enqueued,
    alreadyTracked,
    claimed: jobs.length,
    completed: 0,
    cancelled: 0,
    failed: 0,
    ...testSkips,
  };

  for (const job of jobs) {
    try {
      const testState = await requestTestState(job.request_id);
      if (testState.kind === 'unknown') {
        // A request that is gone or unaddressable will never resolve: cancel.
        if (PERMANENT_UNKNOWN_REASONS.has(testState.reason)) {
          await cancelReviewSynthesisJob(job, testState.reason);
          result.cancelled += 1;
          continue;
        }
        // A transient read failure: nothing was tried, so requeue without
        // consuming the claim's attempt.
        await releaseReviewSynthesisJob(job);
        recordTestRequestSkip(result, testState);
        continue;
      }
      if (testState.kind !== 'ordinary') {
        await cancelReviewSynthesisJob(job, 'test_request');
        result.cancelled += 1;
        continue;
      }
      const lifecycleSuggestions = await suggestionAdapter.findByRequest(job.request_id, {
        selectedOnly: true,
        requireComplete: true,
      });
      const lifecycleOnly = evaluateReviewSynthesisReadiness(lifecycleSuggestions);
      if (!lifecycleOnly.ready) {
        await cancelReviewSynthesisJob(job, 'readiness_changed_before_generation');
        result.cancelled += 1;
        continue;
      }
      const context = await loadReviewSynthesisContext(job.request_id, {
        suggestions: lifecycleSuggestions,
      });
      if (!context.readiness.ready) {
        await cancelReviewSynthesisJob(job, 'readiness_changed_before_generation');
        result.cancelled += 1;
        continue;
      }
      if (context.readiness.inputHash !== job.input_hash) {
        await cancelReviewSynthesisJob(job, 'input_fingerprint_changed_before_generation');
        result.cancelled += 1;
        continue;
      }
      await synthesizeReviews({
        requestId: job.request_id,
        overwrite: true,
        actingUserSystemId: null,
        mode: 'automatic',
        job,
      });
      result.completed += 1;
    } catch (error) {
      // synthesizeReviews owns failure recording once generation starts. This
      // fallback covers preflight/read errors; a second lease-conditional
      // update safely no-ops if synthesizeReviews already released the lease.
      await recordReviewSynthesisJobFailure(job, error, {
        retryable: true,
        maxAttempts: 3,
      }).catch((trackingError) => {
        console.error('[review synthesis drain] failure tracking failed:', trackingError);
      });
      result.failed += 1;
    }
  }

  return result;
}
