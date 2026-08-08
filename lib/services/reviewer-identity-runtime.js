/**
 * Server-owned runtime seam for reviewer identity resolution.
 *
 * Live callers choose these modes independently through entry-point-scoped
 * server environment variables; unset and unknown values fail back to legacy.
 * The older generic variable is retained only for the unscoped internal seam.
 * Supported modes:
 * - legacy (default): run and return ReviewerIdentityEvidence exactly as before.
 * - shadow: settle legacy first, then run bounded W2 comparison work and still
 *   return the exact legacy result.
 * - combined: run both arms and adapt the combined decision into the existing
 *   result contract. This mode is code-available but remains owner-gated and is
 *   not enabled by default or by any tracked environment configuration.
 *
 * Shadow/combined W2 evaluation uses a request-scoped claim-oriented ROR
 * resolver. ROR alone selects; OpenAlex only hydrates one locally selected ROR
 * id into the identity shape works-first consumes. Batch evaluation shares the
 * resolver and a 16-request OpenAlex budget spanning works search, institution
 * hydration, author/anchor profiles, and combined ORCID hydration. Parent
 * callers forward their deadline timestamp; W2 is skipped when its complete
 * allocation plus a reserve no longer fits. Comparison/error observation is
 * inside the same total W2 allocation. Batch evaluation emits one aggregate,
 * data-minimized cache/provider-call metric log. That log is non-authoritative
 * and failure-isolated from reviewer results.
 *
 * Unknown values, including "w2" and "cutover", collapse to legacy so an
 * environment-variable typo cannot enable the authoritative path.
 */

const crypto = require('node:crypto');
const { OpenAlexService } = require('./openalex-service');
const { createInstitutionIdentityResolver } = require('./institution-identity-resolver');
const {
  createRorInstitutionIdentityResolver,
} = require('./institution-resolution/ror-institution-identity-resolver');
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
const REVIEWER_IDENTITY_DISCOVERY_RESOLVER_MODE = 'REVIEWER_IDENTITY_DISCOVERY_RESOLVER_MODE';
const REVIEWER_IDENTITY_WORKBENCH_RESOLVER_MODE = 'REVIEWER_IDENTITY_WORKBENCH_RESOLVER_MODE';
const REVIEWER_IDENTITY_CONTACT_ENRICHMENT_RESOLVER_MODE =
  'REVIEWER_IDENTITY_CONTACT_ENRICHMENT_RESOLVER_MODE';
const SHADOW_TIMEOUT_MS = 15_000;
const SHADOW_OBSERVER_TIMEOUT_MS = 2_500;
const SHADOW_PARENT_DEADLINE_RESERVE_MS = 1_000;
// Covers the normal three works queries, ROR hydration, and bounded profile
// work. Retries and redirects consume the same cap; high fragmentation fails safe.
const OPENALEX_REQUESTS_PER_RESOLUTION = 16;
const RESOLVER_MODE = Object.freeze({
  LEGACY: 'legacy',
  SHADOW: 'shadow',
  COMBINED: 'combined',
});
const RESOLVER_ENTRY_POINT = Object.freeze({
  DISCOVERY: 'reviewer_discovery',
  WORKBENCH_RECOMMENDED: 'workbench_recommended',
  CONTACT_ENRICHMENT: 'contact_enrichment',
});
const RESOLVER_MODE_ENV_BY_ENTRY_POINT = Object.freeze({
  [RESOLVER_ENTRY_POINT.DISCOVERY]: REVIEWER_IDENTITY_DISCOVERY_RESOLVER_MODE,
  [RESOLVER_ENTRY_POINT.WORKBENCH_RECOMMENDED]: REVIEWER_IDENTITY_WORKBENCH_RESOLVER_MODE,
  [RESOLVER_ENTRY_POINT.CONTACT_ENRICHMENT]:
    REVIEWER_IDENTITY_CONTACT_ENRICHMENT_RESOLVER_MODE,
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

function configuredResolverModeForEntryPoint(entryPoint, env = process.env) {
  const envName = RESOLVER_MODE_ENV_BY_ENTRY_POINT[entryPoint];
  return envName ? normalizeResolverMode(env?.[envName]) : RESOLVER_MODE.LEGACY;
}

function openAlexBudgetError(operation) {
  const error = new Error('reviewer_identity_openalex_budget_exhausted');
  error.code = 'reviewer_identity_openalex_budget_exhausted';
  error.operation = operation;
  return error;
}

function createOpenAlexRequestBudget(maxRequests = OPENALEX_REQUESTS_PER_RESOLUTION) {
  if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
    throw new Error('OpenAlex request budget must be a positive integer');
  }
  let used = 0;
  return Object.freeze({
    consume(operation) {
      if (used >= maxRequests) throw openAlexBudgetError(operation);
      used += 1;
      return used;
    },
    begin(operation) {
      if (used >= maxRequests) throw openAlexBudgetError(operation);
      used += 1;
      let firstRequest = true;
      return Object.freeze({
        consumeRequest() {
          if (firstRequest) {
            firstRequest = false;
            return used;
          }
          if (used >= maxRequests) throw openAlexBudgetError(operation);
          used += 1;
          return used;
        },
      });
    },
    get used() {
      return used;
    },
    get remaining() {
      return maxRequests - used;
    },
    maxRequests,
  });
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

async function evaluateWorksFirstSuggestion(suggestion = {}, {
  signal,
  institutionResolver = createInstitutionIdentityResolver(),
  openAlexService = OpenAlexService,
  openAlexRequestBudget = createOpenAlexRequestBudget(),
} = {}) {
  return resolveWorksFirst({
    name: suggestion.name,
    claimedAffiliation: suggestion.suggestedInstitution || null,
    fieldSamplingHint: suggestion.field
      || (Array.isArray(suggestion.expertiseAreas) ? suggestion.expertiseAreas[0] : null),
  }, {
    searchWorks: async (variant) => {
      const requestScope = openAlexRequestBudget.begin('works_search');
      const result = await openAlexService.searchWorksByRawAuthorName(
        variant,
        { signal, limit: 50, requestScope },
      );
      return result.records;
    },
    searchInstitution: async (query) => {
      const identity = await institutionResolver.resolve(query, {
        signal,
        openAlexRequestBudget,
      });
      return identity ? [identity] : [];
    },
    getAuthor: (authorId) => {
      const requestScope = openAlexRequestBudget.begin('author_profile');
      return openAlexService.getAuthorById(authorId, { signal, requestScope });
    },
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
      providerSearches: nonNegativeIntegerMetric(metrics.providerSearches),
      providerHydrations: nonNegativeIntegerMetric(metrics.providerHydrations),
      resolved: nonNegativeIntegerMetric(metrics.resolved),
      definitiveMisses: nonNegativeIntegerMetric(metrics.definitiveMisses),
      providerFailures: nonNegativeIntegerMetric(metrics.providerFailures),
      cacheSize: nonNegativeIntegerMetric(metrics.cacheSize),
      inFlightSize: nonNegativeIntegerMetric(metrics.inFlightSize),
      rorProviderRequests: nonNegativeIntegerMetric(metrics.rorProviderRequests),
      rorAffiliationLookups: nonNegativeIntegerMetric(metrics.rorAffiliationLookups),
      rorCandidateSets: nonNegativeIntegerMetric(metrics.rorCandidateSets),
      rorCandidatesReturned: nonNegativeIntegerMetric(metrics.rorCandidatesReturned),
      rorMaxCandidatesReturned: nonNegativeIntegerMetric(metrics.rorMaxCandidatesReturned),
      rorOrdinaryQueryLookups: nonNegativeIntegerMetric(metrics.rorOrdinaryQueryLookups),
      rorParentHydrations: nonNegativeIntegerMetric(metrics.rorParentHydrations),
      rorSuccessorHydrations: nonNegativeIntegerMetric(metrics.rorSuccessorHydrations),
      rorRetries: nonNegativeIntegerMetric(metrics.rorRetries),
      rorCacheHits: nonNegativeIntegerMetric(metrics.rorCacheHits),
      rorSingleFlightHits: nonNegativeIntegerMetric(metrics.rorSingleFlightHits),
      openAlexHydrations: nonNegativeIntegerMetric(metrics.openAlexHydrations),
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

function shadowPhaseBudgets(timeoutMs) {
  const totalMs = Math.max(1, Number(timeoutMs) || SHADOW_TIMEOUT_MS);
  if (totalMs === 1) {
    return { evaluationMs: 1, observerMs: 0 };
  }
  const observerMs = Math.max(
    1,
    Math.min(SHADOW_OBSERVER_TIMEOUT_MS, Math.floor(totalMs / 6)),
  );
  return {
    evaluationMs: Math.max(1, totalMs - observerMs),
    observerMs,
  };
}

function hasShadowAllocation({ deadlineAt } = {}, timeoutMs = SHADOW_TIMEOUT_MS, now = Date.now) {
  if (!Number.isFinite(deadlineAt)) return true;
  const requiredMs = Math.max(1, Number(timeoutMs) || SHADOW_TIMEOUT_MS)
    + SHADOW_PARENT_DEADLINE_RESERVE_MS;
  return deadlineAt - now() >= requiredMs;
}

async function runShadowObserver(task, timeoutMs, { signal } = {}) {
  if (!(timeoutMs > 0)) return;
  try {
    await runShadowWithDeadline(() => task(), timeoutMs, { signal });
  } catch {
    // Best-effort observability is skipped when its reserved allocation ends.
  }
}

async function evaluateShadowAgainstLegacy(suggestion, options, legacyResult, {
  runId = null,
  resolverMode = RESOLVER_MODE.SHADOW,
  evaluateWorksFirst = evaluateWorksFirstSuggestion,
  institutionResolver = null,
  shadowTimeoutMs = SHADOW_TIMEOUT_MS,
  openAlexService = OpenAlexService,
  createOpenAlexBudget = createOpenAlexRequestBudget,
  openAlexRequestBudget = null,
  createAnchorsMatch = (signal, requestBudget) => createAnchorMatcher({
    getAuthorById: (authorId) => {
      const requestScope = requestBudget.begin('anchor_author_profile');
      return openAlexService.getAuthorById(authorId, { signal, requestScope });
    },
    propagateProviderErrors: true,
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
} = {}) {
  if (!hasShadowAllocation(options, shadowTimeoutMs)) return null;
  const phaseBudgets = shadowPhaseBudgets(shadowTimeoutMs);
  try {
    const requestBudget = openAlexRequestBudget || createOpenAlexBudget();
    const evaluation = await runShadowWithDeadline(async (shadowSignal) => {
      const shadowOptions = {
        ...options,
        signal: shadowSignal,
        openAlexService,
        openAlexRequestBudget: requestBudget,
      };
      if (institutionResolver) shadowOptions.institutionResolver = institutionResolver;
      const worksResult = await evaluateWorksFirst(suggestion, shadowOptions);
      const combinedEvaluation = await buildShadowComparison(suggestion, legacyResult, worksResult, {
        anchorsMatch: createAnchorsMatch(shadowSignal, requestBudget),
      });
      return {
        worksResult,
        openAlexRequestBudget: requestBudget,
        ...combinedEvaluation,
      };
    }, phaseBudgets.evaluationMs, { signal: options.signal });
    await runShadowObserver(
      () => safeReportShadowComparison(
        onShadowComparison,
        onShadowError,
        evaluation.comparison,
      ),
      phaseBudgets.observerMs,
      { signal: options.signal },
    );
    return evaluation;
  } catch (error) {
    await runShadowObserver(
      () => safeReportShadowError(onShadowError, error),
      phaseBudgets.observerMs,
      { signal: options.signal },
    );
    return null;
  }
}

async function evaluateCombinedAgainstLegacy(suggestion, options, legacyResult, {
  openAlexService = OpenAlexService,
  getAuthorByOrcid = null,
  ...dependencies
} = {}) {
  const shadowTimeoutMs = dependencies.shadowTimeoutMs || SHADOW_TIMEOUT_MS;
  const profilePhaseBudgets = shadowPhaseBudgets(shadowTimeoutMs);
  const evaluation = await evaluateShadowAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    { resolverMode: RESOLVER_MODE.COMBINED, openAlexService, ...dependencies },
  );
  if (!evaluation) return legacyResult;
  const hydrateAuthorByOrcid = getAuthorByOrcid
    || ((orcid, { signal } = {}) => openAlexService.getRichestAuthorByOrcid(orcid, { signal }));
  try {
    return await runShadowWithDeadline((profileSignal) => adaptCombinedIdentityResult({
      suggestion,
      legacyResult,
      worksResult: evaluation.worksResult,
      combinedResult: evaluation.combined,
    }, {
      getAuthorByOrcid: (orcid) => {
        const requestScope = evaluation.openAlexRequestBudget.begin('author_by_orcid');
        return hydrateAuthorByOrcid(orcid, { signal: profileSignal, requestScope });
      },
    }), profilePhaseBudgets.evaluationMs, { signal: options.signal });
  } catch (error) {
    const onShadowError = dependencies.onShadowError
      || ((loggedError) => reportShadowError(loggedError, {
        runId: dependencies.runId || null,
        resolverMode: RESOLVER_MODE.COMBINED,
        candidateKey: shadowCandidateKey(suggestion),
      }));
    await runShadowObserver(
      () => safeReportShadowError(onShadowError, error),
      profilePhaseBudgets.observerMs,
      { signal: options.signal },
    );
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
  const { runDependencies } = prepareShadowRunDependencies(
    shadowDependencies,
    normalizedMode,
  );
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

function prepareShadowRunDependencies(shadowDependencies = {}, resolverMode) {
  const {
    createInstitutionResolver = createRorInstitutionIdentityResolver,
    ...dependencies
  } = shadowDependencies;
  let institutionResolver = dependencies.institutionResolver || null;
  if (!institutionResolver && typeof dependencies.evaluateWorksFirst !== 'function') {
    try {
      institutionResolver = dependencies.openAlexService
        ? createInstitutionResolver({ openAlexService: dependencies.openAlexService })
        : createInstitutionResolver();
    } catch (error) {
      dependencies.evaluateWorksFirst = async () => {
        throw error;
      };
    }
  }
  const runDependencies = {
    ...dependencies,
    ...(institutionResolver ? { institutionResolver } : {}),
    runId: crypto.randomUUID(),
    resolverMode,
  };
  return { institutionResolver, runDependencies };
}

async function evaluateSuggestionsWithRuntimeSeam(suggestions = [], options = {}, {
  entryPoint = null,
  mode = configuredResolverModeForEntryPoint(entryPoint),
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
    const { institutionResolver, runDependencies } = prepareShadowRunDependencies(
      shadowDependencies,
      normalizedMode,
    );
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
  const normalizedMode = normalizeResolverMode(mode);
  if (normalizedMode !== RESOLVER_MODE.COMBINED) return legacyResult;
  const { runDependencies } = prepareShadowRunDependencies(
    dependencies,
    normalizedMode,
  );
  return evaluateCombinedAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    runDependencies,
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
    return evaluateExistingResultWithRuntimeSeam(suggestion, legacyResult, options, {
      mode: configuredResolverModeForEntryPoint(RESOLVER_ENTRY_POINT.CONTACT_ENRICHMENT),
    });
  }
}

module.exports = {
  OPENALEX_REQUESTS_PER_RESOLUTION,
  RESOLVER_MODE,
  RESOLVER_ENTRY_POINT,
  REVIEWER_IDENTITY_RESOLVER_MODE,
  REVIEWER_IDENTITY_DISCOVERY_RESOLVER_MODE,
  REVIEWER_IDENTITY_WORKBENCH_RESOLVER_MODE,
  REVIEWER_IDENTITY_CONTACT_ENRICHMENT_RESOLVER_MODE,
  SHADOW_OBSERVER_TIMEOUT_MS,
  SHADOW_PARENT_DEADLINE_RESERVE_MS,
  SHADOW_TIMEOUT_MS,
  ReviewerIdentityRuntime,
  _internals: {
    buildShadowComparison,
    configuredResolverMode,
    configuredResolverModeForEntryPoint,
    createOpenAlexRequestBudget,
    evaluateCombinedAgainstLegacy,
    evaluateExistingResultWithRuntimeSeam,
    evaluateShadowAgainstLegacy,
    evaluateSuggestionsWithRuntimeSeam,
    evaluateWithRuntimeSeam,
    evaluateWorksFirstSuggestion,
    hasShadowAllocation,
    legacyDecision,
    normalizeResolverMode,
    prepareShadowRunDependencies,
    reportInstitutionResolverMetrics,
    runShadowObserver,
    runShadowWithDeadline,
    safeReportShadowComparison,
    safeReportShadowError,
    shadowCandidateKey,
    shadowPhaseBudgets,
  },
};
