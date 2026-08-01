/**
 * Pure projection of the Dataverse reviewer-suggestion engagement tuple.
 * Accepts either raw Dataverse field names or the camel-case DTO emitted to the
 * browser so server and client make the same monotonic actionability decision.
 */
export function reviewerEngagementProjection(row = {}) {
  const selected = row.wmkf_selected === true || row.selected === true;
  const invited = row.wmkf_invited === true || row.invited === true;
  const accepted = row.wmkf_accepted === true || row.accepted === true;
  const declined = row.wmkf_declined === true || row.declined === true;
  const responseReceivedAt = row.wmkf_responsereceivedat || row.responseReceivedAt || null;
  const reviewReceivedAt = row.wmkf_reviewreceivedat || row.reviewReceivedAt || null;
  const completedAt = row.wmkf_completedat || row.completedAt || null;

  let stage = null;
  if (completedAt) stage = 'completed';
  else if (reviewReceivedAt) stage = 'review_received';
  else if (declined) stage = 'declined';
  else if (accepted) stage = 'accepted';
  else if (responseReceivedAt) stage = 'responded';
  else if (invited) stage = 'invited';
  else if (selected) stage = 'selected';

  return {
    selected,
    invited,
    accepted,
    declined,
    responseReceivedAt,
    reviewReceivedAt,
    completedAt,
    handled: stage !== null,
    stage,
  };
}

export function isReviewerSuggestionHandled(row) {
  return reviewerEngagementProjection(row).handled;
}
