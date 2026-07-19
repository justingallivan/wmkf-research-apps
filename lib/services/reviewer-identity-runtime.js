/**
 * Server-owned runtime seam for reviewer identity resolution.
 *
 * Supported modes are deliberately limited to:
 * - legacy (default): run and return ReviewerIdentityEvidence exactly as before.
 * - shadow: settle legacy first, then run bounded W2 comparison work and still
 *   return the exact legacy result.
 *
 * There is intentionally no authoritative W2 mode in this increment. Unknown
 * values, including "w2", collapse to legacy so production cutover requires a
 * later reviewed code change rather than an environment-variable typo.
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
} = require('./reviewer-works-first');

const REVIEWER_IDENTITY_RESOLVER_MODE = 'REVIEWER_IDENTITY_RESOLVER_MODE';
const SHADOW_TIMEOUT_MS = 15_000;
const RESOLVER_MODE = Object.freeze({
  LEGACY: 'legacy',
  SHADOW: 'shadow',
});

function normalizeResolverMode(value) {
  return String(value || '').trim().toLowerCase() === RESOLVER_MODE.SHADOW
    ? RESOLVER_MODE.SHADOW
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
  const anchorsAgree = await anchorsMatch(legacy.anchor, worksResult?.anchor);
  const combined = combineIdentityDecisions(
    suggestion,
    legacy,
    worksResult,
    { anchorsAgree },
  );
  return {
    candidateKey: shadowCandidateKey(suggestion),
    legacyDecision: legacy.decision,
    worksDecision: worksResult?.decision || 'review',
    combinedDecision: combined.decision,
    combinedReason: combined.reason,
    anchorsAgree,
  };
}

function reportShadowComparison(comparison) {
  console.info('[reviewer-identity-runtime] shadow comparison', comparison);
}

function reportShadowError(error) {
  console.warn('[reviewer-identity-runtime] shadow resolver failed; legacy result retained', {
    errorName: error?.name || 'Error',
  });
}

function safeReportShadowError(onShadowError, error) {
  try {
    onShadowError(error);
  } catch {
    // Observability must never alter the authoritative legacy result.
  }
}

function safeReportShadowComparison(onShadowComparison, onShadowError, comparison) {
  try {
    onShadowComparison(comparison);
  } catch (error) {
    safeReportShadowError(onShadowError, error);
  }
}

function shadowDeadlineError() {
  const error = new Error('reviewer_identity_shadow_timeout');
  error.code = 'reviewer_identity_shadow_timeout';
  return error;
}

async function runShadowWithDeadline(task, timeoutMs = SHADOW_TIMEOUT_MS) {
  const controller = new AbortController();
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || SHADOW_TIMEOUT_MS);
  let timeoutId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = shadowDeadlineError();
      controller.abort(error);
      reject(error);
    }, boundedTimeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function evaluateShadowAgainstLegacy(suggestion, options, legacyResult, {
  evaluateWorksFirst = evaluateWorksFirstSuggestion,
  shadowTimeoutMs = SHADOW_TIMEOUT_MS,
  createAnchorsMatch = (signal) => createAnchorMatcher({
    getAuthorById: (authorId) => OpenAlexService.getAuthorById(authorId, { signal }),
  }),
  onShadowComparison = reportShadowComparison,
  onShadowError = reportShadowError,
} = {}) {
  try {
    await runShadowWithDeadline(async (shadowSignal) => {
      const shadowOptions = { ...options, signal: shadowSignal };
      const worksResult = await evaluateWorksFirst(suggestion, shadowOptions);
      const comparison = await buildShadowComparison(suggestion, legacyResult, worksResult, {
        anchorsMatch: createAnchorsMatch(shadowSignal),
      });
      safeReportShadowComparison(onShadowComparison, onShadowError, comparison);
    }, shadowTimeoutMs);
  } catch (error) {
    safeReportShadowError(onShadowError, error);
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
  await evaluateShadowAgainstLegacy(
    suggestion,
    options,
    legacyResult,
    shadowDependencies,
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
  if (normalizeResolverMode(mode) === RESOLVER_MODE.SHADOW) {
    for (let index = 0; index < candidates.length; index += 1) {
      await evaluateShadowAgainstLegacy(
        candidates[index],
        options,
        results[index],
        shadowDependencies,
      );
    }
  }
  return results;
}

class ReviewerIdentityRuntime {
  static async evaluateSuggestion(suggestion = {}, options = {}) {
    return evaluateWithRuntimeSeam(suggestion, options);
  }

  static async evaluateSuggestions(suggestions = [], options = {}, hooks = {}) {
    return evaluateSuggestionsWithRuntimeSeam(suggestions, options, hooks);
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
