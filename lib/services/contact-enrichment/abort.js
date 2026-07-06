/**
 * ContactEnrichmentService — abort/deadline helpers.
 *
 * Stage 0 of the ContactEnrichmentService decomposition
 * (docs/CONTACT_ENRICHMENT_SERVICE_DECOMPOSITION_PLAN.md). Pure code motion,
 * behavior-freeze: moved verbatim out of contact-enrichment-service.js. Consumed
 * by the batch orchestrator (`enrichCandidates`) and the resolved-page tier.
 */

/** Normalize an aborted signal's reason into an Error to throw out of a loop. */
function abortError(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  const e = new Error('reviewer_time_budget_exceeded');
  e.code = 'reviewer_time_budget_exceeded';
  return e;
}

function isDeadlineAbort(error, signal) {
  if (error?.name === 'AbortError' || error?.code === 'reviewer_time_budget_exceeded') return true;
  const reason = signal?.reason;
  const reasonIsDeadlineAbort = reason?.name === 'AbortError'
    || reason?.code === 'reviewer_time_budget_exceeded'
    || reason?.message === 'reviewer_time_budget_exceeded';
  return !!(signal?.aborted && reasonIsDeadlineAbort && (
    error === reason || error?.message === reason?.message
  ));
}

module.exports = { abortError, isDeadlineAbort };
