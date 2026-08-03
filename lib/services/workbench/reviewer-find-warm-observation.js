/**
 * Reviewer Find warm-route observation.
 *
 * This is deliberately an observation-only correlation scope for the
 * authenticated Reviewer Find roster GET's `cached` and `reconciled` modes.
 * The browser-provided ID is never authorization, a fixture selector, a target
 * selector, or a write capability.  Invalid or absent IDs leave application
 * behavior unchanged.
 *
 * The scope records only bounded effect metadata.  In particular it must not
 * record request IDs, candidate keys, reviewer data, Graph paths, URLs, query
 * text, response bodies, or errors (which can carry any of those values).
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const observationAls = new AsyncLocalStorage();

const OBSERVATION_HEADER = 'x-reviewer-find-observation-id';
const OBSERVATION_ID_RE = /^rfw_[a-z0-9]{16,64}$/i;
const OPERATION_RE = /^[a-z][a-z0-9_]{2,79}$/;
const MAX_EFFECT_EVENTS = 64;
const MAX_ELAPSED_MS = 600_000;

const EFFECT_CLASSES = Object.freeze([
  'postgres_read',
  'postgres_write',
  'dataverse_read',
  'dataverse_write',
  'dataverse_action',
  'graph_metadata',
  'graph_download',
  'blob_read',
  'blob_write',
  'proposal_load',
  'claude',
  'publication_provider',
  'coi_provider',
  'contact_provider',
  'email',
  'job_enqueue',
]);
const EFFECT_CLASS_SET = new Set(EFFECT_CLASSES);

// The route opens this scope only after requireAppAccess succeeds. Auth/session
// reads are an allowed request precondition and intentionally are not part of
// the warm-effect ledger. A smoke result can therefore prove zero *warm*
// writes/expensive effects, never zero traffic for the whole page navigation.
const POST_AUTH_SCOPE = 'authenticated_reviewer_roster_cached_or_reconciled_get';

/**
 * Static Reviewer Find warm-reachability inventory. The static gate consumes
 * this table and checks source markers for both the current positive controls
 * and the named negative-control chokepoints. Entries marked false are
 * explicit non-reachability claims for the two GET modes, not omitted effect
 * families: if a future warm path uses one of these sanctioned call sites, its
 * instrumentation emits an effect and the live smoke fails closed. This is not
 * a process-wide interceptor for arbitrary raw SQL, fetch, or Blob imports.
 */
const REVIEWER_FIND_WARM_REACHABILITY_INVENTORY = Object.freeze([
  {
    id: 'roster_postgres_read',
    modes: ['cached', 'reconciled'],
    caller: 'reviewer-roster.handleGet -> listForRequest',
    effectClass: 'postgres_read',
    operation: 'reviewer_roster_list',
    chokepoint: 'lib/services/reviewer-roster-store.js',
    marker: "operation: 'reviewer_roster_list'",
    reachable: true,
  },
  {
    id: 'engagement_dataverse_read',
    modes: ['reconciled'],
    caller: 'reconcileRosterEngagement -> reviewerSuggestionAdapter.findByRequest',
    effectClass: 'dataverse_read',
    operation: 'dataverse_query_all_records',
    chokepoint: 'lib/services/dynamics/read-ops.js',
    marker: "operation: 'dataverse_query_all_records'",
    reachable: true,
  },
  {
    id: 'request_dataverse_read',
    modes: ['reconciled'],
    caller: 'readReviewerWarmValidation -> grantRequestAdapter.getById',
    effectClass: 'dataverse_read',
    operation: 'dataverse_get_record',
    chokepoint: 'lib/services/dynamics/read-ops.js',
    marker: "operation: 'dataverse_get_record'",
    reachable: true,
  },
  {
    id: 'bucket_dataverse_read',
    modes: ['reconciled'],
    caller: 'getRequestSharePointBuckets -> sharepointDocumentLocationAdapter reads',
    effectClass: 'dataverse_read',
    operation: 'dataverse_query_records',
    chokepoint: 'lib/services/dynamics/read-ops.js',
    marker: "operation: 'dataverse_query_records'",
    reachable: true,
  },
  {
    id: 'proposal_graph_metadata',
    modes: ['reconciled'],
    caller: 'resolveReviewerProposalMetadata -> GraphService.getFileMetadataByPath',
    effectClass: 'graph_metadata',
    operation: 'graph_file_metadata_by_path',
    chokepoint: 'lib/services/graph-service.js',
    marker: "operation: 'graph_file_metadata_by_path'",
    reachable: true,
  },
  {
    id: 'roster_postgres_write',
    modes: ['cached', 'reconciled'],
    effectClass: 'postgres_write',
    reachable: false,
    nonReachabilityReason: 'GET only calls reviewer-roster-store.listForRequest; it has no roster mutation branch.',
    chokepoints: ['lib/services/reviewer-roster-store.js'],
    markers: ["effectClass: 'postgres_write'", "observedRosterWrite('reviewer_roster_write'"],
  },
  {
    id: 'dataverse_write',
    modes: ['cached', 'reconciled'],
    effectClass: 'dataverse_write',
    reachable: false,
    nonReachabilityReason: 'Warm GET uses Dataverse read adapters only; action routes are POST/PATCH.',
    chokepoints: ['lib/services/dynamics/write-core.js'],
    markers: ["effectClass: 'dataverse_write'", "operation: 'dataverse_write_fetch'"],
  },
  {
    id: 'dataverse_action',
    modes: ['cached', 'reconciled'],
    effectClass: 'dataverse_action',
    reachable: false,
    nonReachabilityReason: 'Warm GET does not execute Dataverse actions.',
    chokepoints: ['lib/services/dynamics/email.js'],
    markers: ["effectClass: 'dataverse_action'", "operation: 'dataverse_send_email_action'"],
  },
  {
    id: 'graph_download',
    modes: ['cached', 'reconciled'],
    effectClass: 'graph_download',
    reachable: false,
    nonReachabilityReason: 'Warm validation calls getFileMetadataByPath and never a Graph download method.',
    chokepoints: ['lib/services/graph-service.js'],
    markers: ["effectClass: 'graph_download'", "operation: 'graph_file_download'"],
  },
  {
    id: 'blob_read',
    modes: ['cached', 'reconciled'],
    effectClass: 'blob_read',
    reachable: false,
    nonReachabilityReason: 'Warm validation uses Graph metadata and no Blob helper.',
    chokepoints: ['lib/utils/uploaded-blob.js'],
    markers: ["effectClass: 'blob_read'", "operation: 'uploaded_blob_read'"],
  },
  {
    id: 'blob_write',
    modes: ['cached', 'reconciled'],
    effectClass: 'blob_write',
    reachable: false,
    nonReachabilityReason: 'Warm GET has no proposal preparation or Blob-copy branch.',
    chokepoints: ['lib/services/reviewer-finder/load-proposal-service.js'],
    markers: ["effectClass: 'blob_write'", "operation: 'reviewer_proposal_blob_put'"],
  },
  {
    id: 'proposal_load',
    modes: ['cached', 'reconciled'],
    effectClass: 'proposal_load',
    reachable: false,
    nonReachabilityReason: 'Proposal-byte loading is an explicit cold action, not a warm GET dependency.',
    chokepoints: ['lib/services/reviewer-finder/load-proposal-service.js'],
    markers: ["effectClass: 'proposal_load'", "operation: 'reviewer_proposal_load'"],
  },
  {
    id: 'claude',
    modes: ['cached', 'reconciled'],
    effectClass: 'claude',
    reachable: false,
    nonReachabilityReason: 'Warm GET imports no LLM client or discovery service.',
    chokepoints: ['lib/services/llm-client.js'],
    markers: ["effectClass: 'claude'", "operation: 'claude_messages_request'"],
  },
  {
    id: 'publication_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'publication_provider',
    reachable: false,
    nonReachabilityReason: 'Warm GET does not call the named PubMed discovery request seam; other literature seams are outside this scoped observation contract.',
    chokepoints: ['lib/services/pubmed-service.js'],
    markers: ["effectClass: 'publication_provider'", "operation: 'pubmed_request'"],
  },
  {
    id: 'coi_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'coi_provider',
    reachable: false,
    nonReachabilityReason: 'Warm GET does not call the named coauthor-COI seam and only projects persisted evidence; other COI paths are outside this scoped observation contract.',
    chokepoints: ['lib/services/discovery-service.js'],
    markers: ["effectClass: 'coi_provider'", "operation: 'coauthor_coi_check'"],
  },
  {
    id: 'contact_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'contact_provider',
    reachable: false,
    nonReachabilityReason: 'Warm GET does not call the named contact-enrichment seam; other contact/provider paths are outside this scoped observation contract.',
    chokepoints: ['lib/services/contact-enrichment-service.js'],
    markers: ["effectClass: 'contact_provider'", "operation: 'contact_enrichment'"],
  },
  {
    id: 'email',
    modes: ['cached', 'reconciled'],
    effectClass: 'email',
    reachable: false,
    nonReachabilityReason: 'Warm GET neither generates nor sends email.',
    chokepoints: ['lib/services/dynamics/email.js'],
    markers: ["effectClass: 'email'", "operation: 'dataverse_email_create'"],
  },
  {
    id: 'job_enqueue',
    modes: ['cached', 'reconciled'],
    effectClass: 'job_enqueue',
    reachable: false,
    nonReachabilityReason: 'Warm GET has no background-job enqueue path.',
    chokepoints: ['lib/services/reviewer-acceptance-job-service.js', 'lib/services/review-synthesis-job-service.js'],
    markers: ["effectClass: 'job_enqueue'", "operation: 'reviewer_acceptance_job_enqueue'", "operation: 'review_synthesis_job_enqueue'"],
  },
]);

function boundedElapsed(startedAt) {
  return Math.min(MAX_ELAPSED_MS, Math.max(0, Date.now() - startedAt));
}

function normalizeObservationId(value) {
  return typeof value === 'string' && OBSERVATION_ID_RE.test(value)
    ? value.toLowerCase()
    : null;
}

function observationFromRequest(req) {
  if (String(req?.method || '').toUpperCase() !== 'GET') return null;
  const rawMode = req?.query?.mode;
  if (Array.isArray(rawMode) || (rawMode !== 'cached' && rawMode !== 'reconciled')) return null;
  const rawId = req?.headers?.[OBSERVATION_HEADER];
  if (Array.isArray(rawId)) return null;
  const observationId = normalizeObservationId(rawId);
  if (!observationId) return null;
  return { observationId, route: 'reviewer_roster', mode: rawMode };
}

function currentReviewerFindWarmObservation() {
  return observationAls.getStore() || null;
}

function safeEmit(state, event) {
  try {
    // Emit one JSON string so Vercel's runtime-log transport preserves an
    // exact, machine-parseable event.  A two-argument console call may be
    // rendered with provider-specific object inspection, which is unsuitable
    // for a fail-closed evidence gate.
    console.info(JSON.stringify({
      kind: 'reviewer_find_warm_observation',
      observationId: state.observationId,
      route: state.route,
      mode: state.mode,
      ...event,
    }));
    return true;
  } catch {
    state.incomplete = true;
    state.instrumentationFailures += 1;
    return false;
  }
}

function markIncomplete(state, reasonCode) {
  state.incomplete = true;
  state.instrumentationFailures += 1;
  safeEmit(state, {
    event: 'observation_incomplete',
    reasonCode,
    count: 0,
    elapsedMs: boundedElapsed(state.startedAt),
  });
}

function addEffect(state, effectClass, operation, reasonCode, elapsedMs) {
  if (!EFFECT_CLASS_SET.has(effectClass) || !OPERATION_RE.test(operation)) {
    markIncomplete(state, 'invalid_observation_effect');
    return;
  }
  if (state.effectEvents >= MAX_EFFECT_EVENTS) {
    // The first overflow is durable evidence that the ledger is incomplete.
    // Latch it so a loop cannot turn one bounded observation failure into an
    // unbounded stream of identical failure logs. The final terminal event
    // carries `incomplete: true` for the runner.
    if (!state.effectEventLimitExceeded) {
      state.effectEventLimitExceeded = true;
      markIncomplete(state, 'effect_event_limit_exceeded');
    }
    return;
  }
  state.effectEvents += 1;
  state.effectCounts[effectClass] = (state.effectCounts[effectClass] || 0) + 1;
  safeEmit(state, {
    event: 'effect',
    effectClass,
    operation,
    count: 1,
    reasonCode,
    elapsedMs,
  });
}

/**
 * Run a callback inside an optional warm GET observation scope.  A missing or
 * malformed observation config is a strict no-op; it does not reject a valid
 * product request and cannot turn on a different code path.
 */
function withReviewerFindWarmObservation(observation, fn) {
  if (typeof fn !== 'function') {
    throw new Error('withReviewerFindWarmObservation: fn must be a function');
  }
  const observationId = normalizeObservationId(observation?.observationId);
  const route = observation?.route === 'reviewer_roster' ? observation.route : null;
  const mode = observation?.mode === 'cached' || observation?.mode === 'reconciled'
    ? observation.mode
    : null;
  if (!observationId || !route || !mode) return fn();

  const state = {
    observationId,
    route,
    mode,
    startedAt: Date.now(),
    effectEvents: 0,
    effectCounts: Object.create(null),
    incomplete: false,
    instrumentationFailures: 0,
    effectEventLimitExceeded: false,
  };

  return observationAls.run(state, async () => {
    safeEmit(state, {
      event: 'start',
      reasonCode: 'warm_get_started',
      count: 0,
      elapsedMs: 0,
    });
    let routeFailed = false;
    try {
      return await fn();
    } catch (error) {
      routeFailed = true;
      throw error;
    } finally {
      const complete = !state.incomplete;
      safeEmit(state, {
        // `complete` is the terminal event name, while its booleans carry the
        // success result. This keeps an event-limit overflow to one explicit
        // observation_incomplete event rather than emitting another one here.
        event: 'complete',
        complete,
        incomplete: !complete,
        reasonCode: complete
          ? (routeFailed ? 'warm_get_failed' : 'warm_get_completed')
          : 'instrumentation_incomplete',
        count: state.effectEvents,
        effectCounts: state.effectCounts,
        instrumentationFailures: state.instrumentationFailures,
        elapsedMs: boundedElapsed(state.startedAt),
      });
    }
  });
}

/**
 * Record one effect at a named, inventory-backed chokepoint.  It wraps the
 * actual operation so success and failure are both observable.  Instrumentation
 * errors never alter the operation's result; they leave a bounded incomplete
 * record, which blocks smoke evidence rather than product authority.
 */
async function observeReviewerFindWarmEffect({ effectClass, operation }, fn) {
  const state = currentReviewerFindWarmObservation();
  if (!state) return await fn();
  const startedAt = Date.now();
  try {
    const result = await fn();
    addEffect(state, effectClass, operation, 'completed', boundedElapsed(startedAt));
    return result;
  } catch (error) {
    addEffect(state, effectClass, operation, 'failed', boundedElapsed(startedAt));
    throw error;
  }
}

function reviewerFindWarmObservationSummary() {
  const state = currentReviewerFindWarmObservation();
  if (!state) return null;
  return {
    observationId: state.observationId,
    route: state.route,
    mode: state.mode,
    complete: !state.incomplete,
    effectCounts: { ...state.effectCounts },
    instrumentationFailures: state.instrumentationFailures,
  };
}

module.exports = {
  EFFECT_CLASSES,
  OBSERVATION_HEADER,
  POST_AUTH_SCOPE,
  REVIEWER_FIND_WARM_REACHABILITY_INVENTORY,
  currentReviewerFindWarmObservation,
  normalizeObservationId,
  observationFromRequest,
  observeReviewerFindWarmEffect,
  reviewerFindWarmObservationSummary,
  withReviewerFindWarmObservation,
};
