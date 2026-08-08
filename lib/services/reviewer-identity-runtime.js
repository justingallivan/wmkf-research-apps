/**
 * Server-owned runtime seam for reviewer identity resolution.
 *
 * Supported modes:
 * - legacy (default): run and return ReviewerIdentityEvidence exactly as before.
 * - shadow: settle legacy first, then run bounded W2 comparison work and still
 *   return the exact legacy result.
 * - combined: run both arms and adapt the combined decision into the existing
 *   result contract. This mode is code-available but remains owner-gated and is
 *   not enabled by default or by any tracked environment configuration.
 *
 * Batch W2 evaluation shares one request-bounded, veto-first ROR institution
 * resolver and emits one aggregate, data-minimized cache/provider-call metric
 * log. ROR retrieval evidence is non-authoritative; only a unique local decision
 * may hydrate the exact ROR through OpenAlex. The log and bridge are both
 * failure-isolated from reviewer results.
 * A caller may also supply a failure-isolated request-local comparison observer.
 * It receives a bounded named diagnostic DTO for immediate privileged rendering;
 * the default console/Postgres observers remain pseudonymous and never receive it.
 *
 * Unknown values, including "w2" and "cutover", collapse to legacy so an
 * environment-variable typo cannot enable the authoritative path.
 */

const crypto = require('node:crypto');
const { OpenAlexService } = require('./openalex-service');
const {
  createRorInstitutionIdentityResolver,
} = require('./ror-institution-identity-resolver');
const { ReviewerIdentityEvidence } = require('./reviewer-identity-evidence');
const {
  combineIdentityDecisions,
  createAnchorMatcher,
  normalizeOrcid,
  resolveWorksFirst,
  shortOpenAlexAuthorId,
  worksEvidenceLinksAnchor,
} = require('./reviewer-works-first');
const {
  adaptCombinedIdentityResult,
} = require('./reviewer-works-first-authoritative');
const {
  recordShadowComparison,
  recordShadowError,
} = require('./reviewer-identity-shadow-log');

const REVIEWER_IDENTITY_RESOLVER_MODE = 'REVIEWER_IDENTITY_RESOLVER_MODE';
const SHADOW_TIMEOUT_MS = 15_000;
const RESOLVER_MODE = Object.freeze({
  LEGACY: 'legacy',
  SHADOW: 'shadow',
  COMBINED: 'combined',
});

function normalizeResolverMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === RESOLVER_MODE.SHADOW || normalized === RESOLVER_MODE.COMBINED
    ? normalized
    : RESOLVER_MODE.LEGACY;
}

function configuredResolverMode(env = process.env) {
  return normalizeResolverMode(env?.[REVIEWER_IDENTITY_RESOLVER_MODE]);
}

function legacyDecision(result = {}) {
  const bind = result.status === 'confirmed' || result.status === 'probable';
  const orcid = normalizeOrcid(result.orcid);
  const authorId = shortOpenAlexAuthorId(result.selectedRecord?.openAlexId);
  const anchor = orcid
    ? `orcid:${orcid}`
    : (authorId ? `openalex:${authorId}` : null);
  return {
    decision: bind && anchor ? 'bind' : 'abstain',
    anchor: bind && anchor ? anchor : null,
    reason: result.reason || result.status || 'legacy_abstain',
  };
}

function shadowCandidateKey(suggestion = {}) {
  const value = [
    suggestion.name,
    suggestion.suggestedInstitution,
  ].map((part) => String(part || '').normalize('NFKC').trim().toLowerCase()).join('|');
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function comparisonDiagnostic(suggestion = {}, comparison = {}, runContext = {}) {
  const boundedText = (value, maxLength = 240) => {
    const normalized = String(value || '').normalize('NFKC').trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  };
  return {
    runId: metricRunId(runContext.runId),
    resolverMode: normalizeResolverMode(runContext.resolverMode),
    candidateKey: comparison.candidateKey || shadowCandidateKey(suggestion),
    reviewerName: boundedText(suggestion.name),
    claimedInstitution: boundedText(suggestion.suggestedInstitution),
    legacyDecision: comparison.legacyDecision || 'abstain',
    worksDecision: comparison.worksDecision || 'review',
    combinedDecision: comparison.combinedDecision || 'review',
    combinedReason: boundedText(comparison.combinedReason, 120) || 'unknown',
    anchorsAgree: comparison.anchorsAgree === true,
  };
}

async function evaluateWorksFirstSuggestion(suggestion = {}, {
  signal,
  institutionResolver = createRorInstitutionIdentityResolver(),
} = {}) {
  return resolveWorksFirst({
    name: suggestion.name,
    claimedAffiliation: suggestion.suggestedInstitution || null,
    fieldSamplingHint: suggestion.field
      || (Array.isArray(suggestion.expertiseAreas) ? suggestion.expertiseAreas[0] : null),
  }, {
    searchWorks: async (variant) => {
      const result = await OpenAlexService.searchWorksByRawAuthorName(
        variant,
        { signal, limit: 50 },
      );
      return result.records;
    },
    searchInstitution: async (query) => {
      const identity = await institutionResolver.resolve(query, { signal });
      return identity ? [identity] : [];
    },
    getAuthor: (authorId) =>
      OpenAlexService.getAuthorById(authorId, { signal }),
  });
}

function nonNegativeIntegerMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function metricRunId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function reportInstitutionResolverMetrics({
  institutionResolver,
  runId = null,
  resolverMode = RESOLVER_MODE.LEGACY,
  candidateCount = 0,
  batchDurationMs = 0,
} = {}) {
  try {
    const metrics = institutionResolver?.metrics || {};
    console.info('[reviewer-identity-runtime] institution resolver metrics', {
      runId: metricRunId(runId),
      resolverMode: normalizeResolverMode(resolverMode),
      candidateCount: nonNegativeIntegerMetric(candidateCount),
      batchDurationMs: nonNegativeIntegerMetric(batchDurationMs),
      resolveCalls: nonNegativeIntegerMetric(metrics.resolveCalls),
      cacheHits: nonNegativeIntegerMetric(metrics.cacheHits),
      singleFlightHits: nonNegativeIntegerMetric(metrics.singleFlightHits),
      resolverCacheHits: nonNegativeIntegerMetric(metrics.resolverCacheHits),
      resolverSingleFlightHits: nonNegativeIntegerMetric(metrics.resolverSingleFlightHits),
      providerCacheHits: nonNegativeIntegerMetric(metrics.providerCacheHits),
      providerSingleFlightHits: nonNegativeIntegerMetric(metrics.providerSingleFlightHits),
      providerSearches: nonNegativeIntegerMetric(metrics.providerSearches),
      providerHydrations: nonNegativeIntegerMetric(metrics.providerHydrations),
      providerRequests: nonNegativeIntegerMetric(metrics.providerRequests),
      affiliationLookups: nonNegativeIntegerMetric(metrics.affiliationLookups),
      ordinaryQueryLookups: nonNegativeIntegerMetric(metrics.ordinaryQueryLookups),
      successorHydrations: nonNegativeIntegerMetric(metrics.successorHydrations),
      parentHydrations: nonNegativeIntegerMetric(metrics.parentHydrations),
      retries: nonNegativeIntegerMetric(metrics.retries),
      candidateSets: nonNegativeIntegerMetric(metrics.candidateSets),
      candidatesReturned: nonNegativeIntegerMetric(metrics.candidatesReturned),
      maxCandidatesReturned: nonNegativeIntegerMetric(metrics.maxCandidatesReturned),
      providerLatencyMs: nonNegativeIntegerMetric(metrics.providerLatencyMs),
      response2xx: nonNegativeIntegerMetric(metrics.response2xx),
      response3xx: nonNegativeIntegerMetric(metrics.response3xx),
      response4xx: nonNegativeIntegerMetric(metrics.response4xx),
      response5xx: nonNegativeIntegerMetric(metrics.response5xx),
      providerTimeouts: nonNegativeIntegerMetric(metrics.providerTimeouts),
      transportFailures: nonNegativeIntegerMetric(metrics.transportFailures),
      malformedResponses: nonNegativeIntegerMetric(metrics.malformedResponses),
      decisionResolved: nonNegativeIntegerMetric(metrics.decisionResolved),
      decisionReview: nonNegativeIntegerMetric(metrics.decisionReview),
      decisionUnresolved: nonNegativeIntegerMetric(metrics.decisionUnresolved),
      bridgeAttempts: nonNegativeIntegerMetric(metrics.bridgeAttempts),
      bridgeFailures: nonNegativeIntegerMetric(metrics.bridgeFailures),
      bridgeMismatches: nonNegativeIntegerMetric(metrics.bridgeMismatches),
      resolved: nonNegativeIntegerMetric(metrics.resolved),
      definitiveMisses: nonNegativeIntegerMetric(metrics.definitiveMisses),
      providerFailures: nonNegativeIntegerMetric(metrics.providerFailures),
      cacheSize: nonNegativeIntegerMetric(metrics.cacheSize),
      inFlightSize: nonNegativeIntegerMetric(metrics.inFlightSize),
    });
  } catch {
    // Measurement must never alter the authoritative reviewer result.
  }
}

async function buildShadowComparison(suggestion, legacyResult, worksResult, {
  anchorsMatch = createAnchorMatcher({
    getAuthorById: (authorId) => OpenAlexService.getAuthorById(authorId),
  }),
} = {}) {
  const legacy = legacyDecision(legacyResult);
  const anchorsAgree = await anchorsMatch(legacy.anchor, worksResult?.anchor)
    || worksEvidenceLinksAnchor(legacy.anchor, worksResult);
  const combined = combineIdentityDecisions(
    suggestion,
    legacy,
    worksResult,
    { anchorsAgree },
  );
  return {
    combined,
    comparison: {
      candidateKey: shadowCandidateKey(suggestion),
      legacyDecision: legacy.decision,
      worksDecision: worksResult?.decision || 'review',
      combinedDecision: combined.decision,
      combinedReason: combined.reason,
      anchorsAgree,
    },
  };
}

async function reportShadowComparison(comparison, runContext = {}) {
  console.info('[reviewer-identity-runtime] shadow comparison', comparison);
  // Await the best-effort insert so the function cannot finish before Postgres
  // accepts it. The writer resolves (never rejects) on storage failure, so
  // observability still cannot change the reviewer result.
  await recordShadowComparison({
    ...comparison,
    runId: runContext.runId || null,
    resolverMode: runContext.resolverMode || RESOLVER_MODE.SHADOW,
  });
}

async function reportShadowError(error, runContext = {}) {
  console.warn('[reviewer-identity-runtime] shadow resolver failed; legacy result retained', {
    errorName: error?.name || 'Error',
  });
  await recordShadowError({
    runId: runContext.runId || null,
    resolverMode: runContext.resolverMode || RESOLVER_MODE.SHADOW,
    candidateKey: runContext.candidateKey || null,
    errorCode: error?.code || error?.name || 'Error',
  });
}

async function safeReportShadowError(onShadowError, error) {
  try {
    await onShadowError(error);
  } catch {
    // Observability must never alter the authoritative reviewer result.
  }
}

async function safeReportShadowComparison(onShadowComparison, onShadowError, comparison) {
  try {
    await onShadowComparison(comparison);
  } catch (error) {
    await safeReportShadowError(onShadowError, error);
  }
}

async function safeObserveComparison(onComparisonObserved, suggestion, comparison, runContext) {
  if (typeof onComparisonObserved !== 'function') return;
  try {
    await onComparisonObserved(comparisonDiagnostic(suggestion, comparison, runContext));
  } catch {
    // A request-local admin diagnostic must never alter the reviewer result or
    // expand server logs with the reviewer identity it was given.
  }
}

function shadowDeadlineError() {
  const error = new Error('reviewer_identity_shadow_timeout');
  error.code = 'reviewer_identity_shadow_timeout';
  return error;
}

async function runShadowWithDeadline(task, timeoutMs = SHADOW_TIMEOUT_MS, {
  signal: parentSignal,
} = {}) {
  const controller = new AbortController();
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || SHADOW_TIMEOUT_MS);
  let timeoutId;
  let onParentAbort;
  let onDeadlineAbort;
  const deadlinePromise = new Promise((_, reject) => {
    onDeadlineAbort = () => {
      reject(controller.signal.reason || shadowDeadlineError());
    };
    controller.signal.addEventListener('abort', onDeadlineAbort, { once: true });
  });
  if (parentSignal) {
    onParentAbort = () => {
      controller.abort(parentSignal.reason || new Error('reviewer_identity_runtime_aborted'));
    };
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  timeoutId = setTimeout(() => controller.abort(shadowDeadlineError()), boundedTimeoutMs);
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      deadlinePromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
    controller.signal.removeEventListener('abort', onDeadlineAbort);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function evaluateShadowAgainstLegacy(suggestion, options, legacyResult, {
  runId = null,
  resolverMode = RESOLVER_MODE.SHADOW,
  evaluateWorksFirst = evaluateWorksFirstSuggestion,
  institutionResolver = null,
  shadowTimeoutMs = SHADOW_TIMEOUT_MS,
  createAnchorsMatch = (signal) => createAnchorMatcher({
    getAuthorById: (authorId) => OpenAlexService.getAuthorById(authorId, { signal }),
  }),
  onShadowComparison = (comparison) => reportShadowComparison(
    comparison,
    { runId, resolverMode },
  ),
  onShadowError = (error) => reportShadowError(error, {
    runId,
    resolverMode,
    candidateKey: shadowCandidateKey(suggestion),
  }),
  onComparisonObserved = null,
} = {}) {
  try {
    const evaluation = await runShadowWithDeadline(async (shadowSignal) => {
      const shadowOptions = { ...options, signal: shadowSignal };
      if (institutionResolver) shadowOptions.institutionResolver = institutionResolver;
      const worksResult = await evaluateWorksFirst(suggestion, shadowOptions);
      const combinedEvaluation = await buildShadowComparison(suggestion, legacyResult, worksResult, {
        anchorsMatch: createAnchorsMatch(shadowSignal),
      });
      return { worksResult, ...combinedEvaluation };
    }, shadowTimeoutMs, { signal: options.signal });
    await safeReportShadowComparison(
      onShadowComparison,
      onShadowError,
      evaluation.comparison,
    );
    await safeObserveComparison(
      onComparisonObserved,
      suggestion,
      evaluation.comparison,
      { runId, resolverMode },
    );
    return evaluation;
  } catch (error) {
    await safeReportShadowError(onShadowError, error);
    return null;
  }
}

async function evaluateCombinedAgainstLegacy(suggestion, options, legacyResult, {
  getAuthorByOrcid = (orcid, { signal } = {}) =>
    OpenAlexService.getRichestAuthorByOrcid(orcid, { signal }),
  ...dependencies
} = {}) {
  const shadowTimeoutMs = dependencies.shadowTimeoutMs || SHADOW_TIMEOUT_MS;
  const evaluation = await evaluateShadowAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    { resolverMode: RESOLVER_MODE.COMBINED, ...dependencies },
  );
  if (!evaluation) return legacyResult;
  try {
    return await runShadowWithDeadline((profileSignal) => adaptCombinedIdentityResult({
      suggestion,
      legacyResult,
      worksResult: evaluation.worksResult,
      combinedResult: evaluation.combined,
    }, {
      getAuthorByOrcid: (orcid) => getAuthorByOrcid(orcid, { signal: profileSignal }),
    }), shadowTimeoutMs, { signal: options.signal });
  } catch (error) {
    const onShadowError = dependencies.onShadowError
      || ((loggedError) => reportShadowError(loggedError, {
        runId: dependencies.runId || null,
        resolverMode: RESOLVER_MODE.COMBINED,
        candidateKey: shadowCandidateKey(suggestion),
      }));
    await safeReportShadowError(onShadowError, error);
    return legacyResult;
  }
}

async function evaluateWithRuntimeSeam(suggestion = {}, options = {}, {
  mode = configuredResolverMode(),
  evaluateLegacy = (input, runtimeOptions) =>
    ReviewerIdentityEvidence.evaluateSuggestion(input, runtimeOptions),
  ...shadowDependencies
} = {}) {
  const normalizedMode = normalizeResolverMode(mode);
  if (normalizedMode === RESOLVER_MODE.LEGACY) {
    return evaluateLegacy(suggestion, options);
  }

  const legacyResult = await evaluateLegacy(suggestion, options);
  const runDependencies = {
    runId: crypto.randomUUID(),
    resolverMode: normalizedMode,
    ...shadowDependencies,
  };
  if (normalizedMode === RESOLVER_MODE.COMBINED) {
    return evaluateCombinedAgainstLegacy(
      suggestion,
      options,
      legacyResult,
      runDependencies,
    );
  }
  await evaluateShadowAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    runDependencies,
  );
  return legacyResult;
}

async function evaluateSuggestionsWithRuntimeSeam(suggestions = [], options = {}, {
  mode = configuredResolverMode(),
  evaluateLegacy = (input, runtimeOptions) =>
    ReviewerIdentityEvidence.evaluateSuggestion(input, runtimeOptions),
  onBeforeLegacy = () => {},
  ...shadowDependencies
} = {}) {
  const candidates = Array.isArray(suggestions) ? suggestions : [];
  const results = [];
  for (let index = 0; index < candidates.length; index += 1) {
    onBeforeLegacy(candidates[index], index, candidates.length);
    results.push(await evaluateLegacy(candidates[index], options));
  }
  const normalizedMode = normalizeResolverMode(mode);
  if (normalizedMode === RESOLVER_MODE.SHADOW || normalizedMode === RESOLVER_MODE.COMBINED) {
    // One run id for the whole batch so a delta report can group the
    // candidates that were compared together.
    const institutionResolver = shadowDependencies.institutionResolver
      || (typeof shadowDependencies.evaluateWorksFirst === 'function'
        ? null
        : createRorInstitutionIdentityResolver());
    const runDependencies = {
      ...shadowDependencies,
      runId: crypto.randomUUID(),
      resolverMode: normalizedMode,
    };
    if (institutionResolver) runDependencies.institutionResolver = institutionResolver;
    const measurementStartedAt = Date.now();
    for (let index = 0; index < candidates.length; index += 1) {
      if (normalizedMode === RESOLVER_MODE.COMBINED) {
        results[index] = await evaluateCombinedAgainstLegacy(
          candidates[index],
          options,
          results[index],
          runDependencies,
        );
      } else {
        await evaluateShadowAgainstLegacy(
          candidates[index],
          options,
          results[index],
          runDependencies,
        );
      }
    }
    if (institutionResolver) {
      reportInstitutionResolverMetrics({
        institutionResolver,
        runId: runDependencies.runId,
        resolverMode: normalizedMode,
        candidateCount: candidates.length,
        batchDurationMs: Date.now() - measurementStartedAt,
      });
    }
  }
  return results;
}

async function evaluateExistingResultWithRuntimeSeam(
  suggestion = {},
  legacyResult = {},
  options = {},
  {
    mode = configuredResolverMode(),
    ...dependencies
  } = {},
) {
  if (normalizeResolverMode(mode) !== RESOLVER_MODE.COMBINED) return legacyResult;
  return evaluateCombinedAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    {
      runId: crypto.randomUUID(),
      resolverMode: RESOLVER_MODE.COMBINED,
      ...dependencies,
    },
  );
}

class ReviewerIdentityRuntime {
  static async evaluateSuggestion(suggestion = {}, options = {}) {
    return evaluateWithRuntimeSeam(suggestion, options);
  }

  static async evaluateSuggestions(suggestions = [], options = {}, hooks = {}) {
    return evaluateSuggestionsWithRuntimeSeam(suggestions, options, hooks);
  }

  /**
   * Reconcile a server-computed enrichment identity decision with W2 without
   * rerunning the legacy resolver. Unset/legacy/shadow are exact pass-through;
   * only explicit combined mode can replace the result.
   */
  static async evaluateExistingResult(suggestion = {}, legacyResult = {}, options = {}) {
    return evaluateExistingResultWithRuntimeSeam(suggestion, legacyResult, options);
  }
}

module.exports = {
  RESOLVER_MODE,
  REVIEWER_IDENTITY_RESOLVER_MODE,
  SHADOW_TIMEOUT_MS,
  ReviewerIdentityRuntime,
  _internals: {
    buildShadowComparison,
    comparisonDiagnostic,
    configuredResolverMode,
    evaluateCombinedAgainstLegacy,
    evaluateExistingResultWithRuntimeSeam,
    evaluateShadowAgainstLegacy,
    evaluateSuggestionsWithRuntimeSeam,
    evaluateWithRuntimeSeam,
    evaluateWorksFirstSuggestion,
    legacyDecision,
    normalizeResolverMode,
    reportInstitutionResolverMetrics,
    runShadowWithDeadline,
    safeReportShadowComparison,
    safeReportShadowError,
    safeObserveComparison,
    shadowCandidateKey,
  },
};
