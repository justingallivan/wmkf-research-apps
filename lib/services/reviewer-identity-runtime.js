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
 * Unknown values, including "w2" and "cutover", collapse to legacy so an
 * environment-variable typo cannot enable the authoritative path.
 */

const crypto = require('node:crypto');
const { OpenAlexService } = require('./openalex-service');
const { createInstitutionIdentityResolver } = require('./institution-identity-resolver');
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

async function evaluateWorksFirstSuggestion(suggestion = {}, { signal } = {}) {
  const institutionResolver = createInstitutionIdentityResolver();
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

async function evaluateShadowAgainstLegacy(suggestion, options, legacyResult, {
  runId = null,
  resolverMode = RESOLVER_MODE.SHADOW,
  evaluateWorksFirst = evaluateWorksFirstSuggestion,
  shadowTimeoutMs = SHADOW_TIMEOUT_MS,
  createAnchorsMatch = (signal) => createAnchorMatcher({
    getAuthorById: (authorId) => OpenAlexService.getAuthorById(authorId, { signal }),
  }),
  onShadowComparison = (comparison) => reportShadowComparison(
    comparison,
    { runId, resolverMode },
  ),
  onShadowError = (error) => reportShadowError(error, { runId, resolverMode }),
} = {}) {
  try {
    const evaluation = await runShadowWithDeadline(async (shadowSignal) => {
      const shadowOptions = { ...options, signal: shadowSignal };
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
    const runDependencies = {
      runId: crypto.randomUUID(),
      resolverMode: normalizedMode,
      ...shadowDependencies,
    };
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
    configuredResolverMode,
    evaluateCombinedAgainstLegacy,
    evaluateExistingResultWithRuntimeSeam,
    evaluateShadowAgainstLegacy,
    evaluateSuggestionsWithRuntimeSeam,
    evaluateWithRuntimeSeam,
    evaluateWorksFirstSuggestion,
    legacyDecision,
    normalizeResolverMode,
    runShadowWithDeadline,
    safeReportShadowComparison,
    safeReportShadowError,
    shadowCandidateKey,
  },
};
