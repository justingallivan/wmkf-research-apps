/**
 * Reconcile Find roster rows with authoritative Dataverse engagement. Every
 * visible row carrying a suggestion anchor is checked in one complete request-
 * scoped Dataverse read; handled rows are removed from their roster bucket and
 * returned as compact status entries for the client.
 */
import * as reviewerSuggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { reviewerEngagementProjection } from '../../../shared/utils/reviewer-engagement';
import { reviewerSuggestionCandidateKey } from '../../utils/reviewer-candidate-key';

export async function reconcileRosterEngagement({ requestId, roster }) {
  const bucketNames = ['active', 'excluded', 'ineligible', 'blocked'];
  const buckets = Object.fromEntries(bucketNames.map((name) => [
    name,
    Array.isArray(roster?.[name]) ? roster[name] : [],
  ]));
  const anchored = bucketNames.flatMap((name) => buckets[name]).filter((candidate) => candidate?.suggestionId);
  if (anchored.length === 0) return { ...roster, handled: [] };

  const suggestions = await reviewerSuggestionAdapter.findByRequest(requestId, {
    selectedOnly: false,
    requireComplete: true,
  });
  const byId = new Map(suggestions.map((row) => [
    String(row.wmkf_appreviewersuggestionid || '').toLowerCase(),
    row,
  ]));
  const handled = [];
  const reconciledBuckets = {};
  for (const bucketName of bucketNames) {
    const retained = [];
    for (const candidate of buckets[bucketName]) {
      if (!candidate?.suggestionId) {
        retained.push(candidate);
        continue;
      }
      const row = byId.get(String(candidate.suggestionId).toLowerCase());
      if (!row) {
        // A true orphan is not authoritative enough to restore as actionable.
        // Keep non-active rows in place; Slice B owns durable orphan repair.
        if (bucketName !== 'active') retained.push(candidate);
        continue;
      }
      const engagement = reviewerEngagementProjection(row);
      if (!engagement.handled) {
        retained.push(candidate);
        continue;
      }
      handled.push({
        suggestionId: candidate.suggestionId,
        candidateKey: reviewerSuggestionCandidateKey(candidate.suggestionId),
        name: candidate.name || row._wmkf_potentialreviewer_value_formatted || row.wmkf_name || 'Reviewer',
        stage: engagement.stage,
      });
    }
    reconciledBuckets[bucketName] = retained;
  }
  return { ...roster, ...reconciledBuckets, handled };
}

/** Fail closed before an excluded roster row is promoted back to Find. */
export async function validateRosterPromotionEngagement({ requestId, candidate }) {
  if (!candidate?.suggestionId) return { allowed: true };
  let row;
  try {
    row = await reviewerSuggestionAdapter.findById(candidate.suggestionId);
  } catch (error) {
    const unavailable = error?.status === 404
      || /applicant-excluded suggestion/i.test(error?.message || '');
    if (!unavailable) throw error;
    return {
      allowed: false,
      code: 'reviewer_anchor_unavailable',
      error: 'The reviewer suggestion anchor is unavailable; reload before promoting it.',
    };
  }
  if (!row || String(row._wmkf_request_value || '').toLowerCase() !== String(requestId || '').toLowerCase()) {
    return {
      allowed: false,
      code: 'reviewer_anchor_unavailable',
      error: 'The reviewer suggestion anchor is unavailable; reload before promoting it.',
    };
  }
  const engagement = reviewerEngagementProjection(row);
  if (engagement.handled) {
    return {
      allowed: false,
      code: 'reviewer_already_handled',
      stage: engagement.stage,
      error: 'This reviewer has already entered the engagement lifecycle.',
    };
  }
  return { allowed: true };
}
