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
 * Static Reviewer Find warm-reachability inventory.  The static gate consumes
 * this table and checks the source marker for every `reachable: true` entry.
 * Entries marked false are explicit non-reachability claims for the two GET
 * modes, not omitted effect families.
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
  },
  {
    id: 'dataverse_write',
    modes: ['cached', 'reconciled'],
    effectClass: 'dataverse_write',
    reachable: false,
    nonReachabilityReason: 'Warm GET uses Dataverse read adapters only; action routes are POST/PATCH.',
  },
  {
    id: 'dataverse_action',
    modes: ['cached', 'reconciled'],
    effectClass: 'dataverse_action',
    reachable: false,
    nonReachabilityReason: 'Warm GET does not execute Dataverse actions.',
  },
  {
    id: 'graph_download',
    modes: ['cached', 'reconciled'],
    effectClass: 'graph_download',
    reachable: false,
    nonReachabilityReason: 'Warm validation calls getFileMetadataByPath and never a Graph download method.',
  },
  {
    id: 'blob_read',
    modes: ['cached', 'reconciled'],
    effectClass: 'blob_read',
    reachable: false,
    nonReachabilityReason: 'Warm validation uses Graph metadata and no Blob helper.',
  },
  {
    id: 'blob_write',
    modes: ['cached', 'reconciled'],
    effectClass: 'blob_write',
    reachable: false,
    nonReachabilityReason: 'Warm GET has no proposal preparation or Blob-copy branch.',
  },
  {
    id: 'proposal_load',
    modes: ['cached', 'reconciled'],
    effectClass: 'proposal_load',
    reachable: false,
    nonReachabilityReason: 'Proposal-byte loading is an explicit cold action, not a warm GET dependency.',
  },
  {
    id: 'claude',
    modes: ['cached', 'reconciled'],
    effectClass: 'claude',
    reachable: false,
    nonReachabilityReason: 'Warm GET imports no LLM client or discovery service.',
  },
  {
    id: 'publication_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'publication_provider',
    reachable: false,
    nonReachabilityReason: 'Publication discovery is an explicit cold or targeted-stage operation.',
  },
  {
    id: 'coi_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'coi_provider',
    reachable: false,
    nonReachabilityReason: 'Warm GET only projects persisted evidence and does not recompute COI.',
  },
  {
    id: 'contact_provider',
    modes: ['cached', 'reconciled'],
    effectClass: 'contact_provider',
    reachable: false,
    nonReachabilityReason: 'Contact enrichment is a targeted-stage producer and is not called by warm GET.',
  },
  {
    id: 'email',
    modes: ['cached', 'reconciled'],
    effectClass: 'email',
    reachable: false,
    nonReachabilityReason: 'Warm GET neither generates nor sends email.',
  },
  {
    id: 'job_enqueue',
    modes: ['cached', 'reconciled'],
    effectClass: 'job_enqueue',
    reachable: false,
    nonReachabilityReason: 'Warm GET has no background-job enqueue path.',
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
    console.info('reviewer-find-warm-observation', {
      observationId: state.observationId,
      route: state.route,
      mode: state.mode,
      ...event,
    });
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
    markIncomplete(state, 'effect_event_limit_exceeded');
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
        event: complete ? 'complete' : 'observation_incomplete',
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
