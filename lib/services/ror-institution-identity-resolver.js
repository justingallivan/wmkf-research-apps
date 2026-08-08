'use strict';

/**
 * Production institution resolver used by the reviewer-identity shadow arm.
 *
 * ROR supplies a candidate union; the local veto-first resolver chooses at
 * most one ROR id. Only then may OpenAlex hydrate that exact ROR into the
 * institution identity shape consumed by works-first. A missing or mismatched
 * bridge result returns null and never broadens the legacy result.
 */
const {
  assertCandidateInput,
  candidateInputHash,
} = require('./ror-institution-candidate-contract');
const {
  createRorCandidateUnionAdapter,
} = require('./ror-institution-candidate-adapter');
const {
  createInstitutionDecisionResolver,
} = require('./ror-institution-decision');
const { OpenAlexService } = require('./openalex-service');

function normalizeRorId(value) {
  const match = String(value || '').trim().match(/(?:https?:\/\/ror\.org\/)?([0-9a-z]{9})$/i);
  return match ? `https://ror.org/${match[1].toLowerCase()}` : null;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason || new Error('Aborted');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  throw error;
}

function activeFlightCount(inFlight) {
  let count = 0;
  for (const flightsBySignal of inFlight.values()) count += flightsBySignal.size;
  return count;
}

function createRorInstitutionIdentityResolver({
  candidateAdapter = createRorCandidateUnionAdapter(),
  openAlexService = OpenAlexService,
} = {}) {
  const decisionResolver = createInstitutionDecisionResolver({ candidateAdapter });
  const cache = new Map();
  const inFlight = new Map();
  const withoutSignal = Symbol('ror-institution-resolver-without-signal');
  const counters = {
    bridgeAttempts: 0,
    bridgeFailures: 0,
    bridgeMismatches: 0,
    cacheHits: 0,
    definitiveMisses: 0,
    decisionResolved: 0,
    decisionReview: 0,
    decisionUnresolved: 0,
    resolveCalls: 0,
    resolved: 0,
    singleFlightHits: 0,
  };

  async function resolveUncached(input) {
    const decision = await decisionResolver.resolve(input);
    throwIfAborted(input.signal);
    if (decision.outcome === 'review') counters.decisionReview += 1;
    if (decision.outcome === 'unresolved') counters.decisionUnresolved += 1;
    if (decision.outcome !== 'resolved' || decision.selected_ror_ids.length !== 1) {
      const providerFailed = decision.reasons.includes('provider_failure');
      if (!providerFailed) counters.definitiveMisses += 1;
      return {
        cacheable: !providerFailed,
        identity: null,
      };
    }

    counters.decisionResolved += 1;
    const selectedRor = normalizeRorId(decision.selected_ror_ids[0]);
    if (!selectedRor) {
      counters.definitiveMisses += 1;
      return { cacheable: true, identity: null };
    }

    let hydrated;
    try {
      counters.bridgeAttempts += 1;
      hydrated = await openAlexService.getInstitution(selectedRor, { signal: input.signal });
      throwIfAborted(input.signal);
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason || error;
      counters.bridgeFailures += 1;
      return { cacheable: false, identity: null };
    }

    const hydratedRor = normalizeRorId(hydrated?.ror);
    if (!hydrated?.openAlexId || hydratedRor !== selectedRor) {
      counters.bridgeMismatches += 1;
      counters.definitiveMisses += 1;
      return { cacheable: true, identity: null };
    }

    counters.resolved += 1;
    return {
      cacheable: true,
      identity: Object.freeze({
        ...hydrated,
        ror: selectedRor,
        associatedInstitutions: Object.freeze([
          ...(Array.isArray(hydrated.associatedInstitutions)
            ? hydrated.associatedInstitutions
            : []),
        ]),
      }),
    };
  }

  async function resolve(affiliation, {
    countryCode = null,
    domainEvidence = null,
    signal,
  } = {}) {
    counters.resolveCalls += 1;
    const input = {
      affiliation_string: String(affiliation || '').trim(),
      country_code: countryCode,
      domain_evidence: domainEvidence,
      signal,
    };
    assertCandidateInput(input);
    throwIfAborted(signal);
    const cacheKey = candidateInputHash(input);
    if (cache.has(cacheKey)) {
      counters.cacheHits += 1;
      return cache.get(cacheKey);
    }

    const signalKey = signal || withoutSignal;
    let flightsBySignal = inFlight.get(cacheKey);
    if (flightsBySignal?.has(signalKey)) {
      counters.singleFlightHits += 1;
      return flightsBySignal.get(signalKey);
    }
    if (!flightsBySignal) {
      flightsBySignal = new Map();
      inFlight.set(cacheKey, flightsBySignal);
    }

    let flight;
    flight = resolveUncached(input).then(({ cacheable, identity }) => {
      if (cacheable) cache.set(cacheKey, identity);
      return identity;
    }).finally(() => {
      const currentFlights = inFlight.get(cacheKey);
      if (currentFlights?.get(signalKey) !== flight) return;
      currentFlights.delete(signalKey);
      if (currentFlights.size === 0) inFlight.delete(cacheKey);
    });
    flightsBySignal.set(signalKey, flight);
    return flight;
  }

  const resolver = { resolve };
  Object.defineProperty(resolver, 'metrics', {
    enumerable: true,
    get: () => {
      const candidateMetrics = candidateAdapter.metrics || {};
      return Object.freeze({
        ...counters,
        affiliationLookups: candidateMetrics.affiliationLookups || 0,
        cacheHits: counters.cacheHits + (candidateMetrics.cacheHits || 0),
        cacheSize: cache.size,
        candidateSets: candidateMetrics.candidateSets || 0,
        candidatesReturned: candidateMetrics.candidatesReturned || 0,
        inFlightSize: activeFlightCount(inFlight),
        maxCandidatesReturned: candidateMetrics.maxCandidatesReturned || 0,
        malformedResponses: candidateMetrics.malformedResponses || 0,
        ordinaryQueryLookups: candidateMetrics.ordinaryQueryLookups || 0,
        parentHydrations: candidateMetrics.parentHydrations || 0,
        providerFailures: (candidateMetrics.providerFailures || 0) + counters.bridgeFailures,
        providerHydrations: (candidateMetrics.successorHydrations || 0)
          + (candidateMetrics.parentHydrations || 0)
          + counters.bridgeAttempts,
        providerLatencyMs: candidateMetrics.providerLatencyMs || 0,
        providerRequests: candidateMetrics.providerRequests || 0,
        providerSearches: (candidateMetrics.affiliationLookups || 0)
          + (candidateMetrics.ordinaryQueryLookups || 0),
        providerCacheHits: candidateMetrics.cacheHits || 0,
        providerSingleFlightHits: candidateMetrics.singleFlightHits || 0,
        providerTimeouts: candidateMetrics.providerTimeouts || 0,
        response2xx: candidateMetrics.response2xx || 0,
        response3xx: candidateMetrics.response3xx || 0,
        response4xx: candidateMetrics.response4xx || 0,
        response5xx: candidateMetrics.response5xx || 0,
        resolverCacheHits: counters.cacheHits,
        resolverSingleFlightHits: counters.singleFlightHits,
        retries: candidateMetrics.retries || 0,
        singleFlightHits: counters.singleFlightHits
          + (candidateMetrics.singleFlightHits || 0),
        successorHydrations: candidateMetrics.successorHydrations || 0,
        transportFailures: candidateMetrics.transportFailures || 0,
      });
    },
  });
  return Object.freeze(resolver);
}

module.exports = {
  createRorInstitutionIdentityResolver,
  normalizeRorId,
};
