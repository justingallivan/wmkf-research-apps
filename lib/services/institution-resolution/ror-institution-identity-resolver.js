'use strict';

/**
 * Request-scoped bridge from the claim-oriented ROR decision policy to the
 * OpenAlex institution identity shape consumed by reviewer works-first.
 *
 * ROR is the only selection authority. OpenAlex is queried only after exactly
 * one ROR id resolves, and its response must carry that same ROR id. Provider
 * failures degrade to null without poisoning the request cache; caller
 * cancellation propagates.
 */

const { OpenAlexService } = require('../openalex-service');
const {
  freezeInstitutionIdentity,
  normalizedCountryCode,
} = require('../institution-identity-resolver');
const { candidateInputHash } = require('./candidate-contract');
const { createRorCandidateUnionAdapter } = require('./ror-candidate-adapter');
const { createInstitutionDecisionResolver } = require('./ror-decision-resolver');

function normalizedRor(value) {
  const match = String(value || '').trim().match(/^(?:https:\/\/ror\.org\/)?([0-9a-z]{9})$/i);
  return match ? `https://ror.org/${match[1].toLowerCase()}` : null;
}

function decisionHasProviderFailure(decision = {}) {
  return Array.isArray(decision.reasons) && decision.reasons.includes('provider_failure');
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason || new Error('Aborted');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  throw error;
}

function createRorInstitutionIdentityResolver({
  candidateAdapter = createRorCandidateUnionAdapter(),
  decisionResolver = null,
  openAlexService = OpenAlexService,
} = {}) {
  const resolver = decisionResolver || createInstitutionDecisionResolver({ candidateAdapter });
  if (typeof resolver?.resolve !== 'function') {
    throw new Error('decisionResolver must export resolve(input)');
  }
  if (typeof openAlexService?.getInstitution !== 'function') {
    throw new Error('openAlexService must export getInstitution(ror, options)');
  }

  const cache = new Map();
  const counters = {
    resolveCalls: 0,
    cacheHits: 0,
    providerHydrations: 0,
    hydrationProviderFailures: 0,
    resolved: 0,
    definitiveMisses: 0,
  };

  function cacheMiss(cacheKey) {
    cache.set(cacheKey, null);
    counters.definitiveMisses += 1;
    return null;
  }

  async function resolve(affiliation, {
    countryCode = null,
    domainEvidence = null,
    signal,
  } = {}) {
    counters.resolveCalls += 1;
    const query = String(affiliation || '').trim();
    if (!query) return null;
    throwIfAborted(signal);

    const country = normalizedCountryCode(countryCode);
    if (String(countryCode || '').trim() && !country) return null;
    const input = {
      affiliation_string: query,
      ...(country ? { country_code: country } : {}),
      ...(domainEvidence == null ? {} : { domain_evidence: domainEvidence }),
      ...(signal ? { signal } : {}),
    };
    const cacheKey = candidateInputHash(input);
    if (cache.has(cacheKey)) {
      counters.cacheHits += 1;
      return cache.get(cacheKey);
    }

    const decision = await resolver.resolve(input);
    throwIfAborted(signal);
    if (decisionHasProviderFailure(decision)) return null;

    const rawSelectedRorIds = Array.isArray(decision?.selected_ror_ids)
      ? decision.selected_ror_ids
      : [];
    const selectedRorIds = rawSelectedRorIds.map(normalizedRor).filter(Boolean);
    if (decision?.outcome !== 'resolved'
      || rawSelectedRorIds.length !== 1
      || selectedRorIds.length !== 1) {
      return cacheMiss(cacheKey);
    }

    const selectedRor = selectedRorIds[0];
    let hydrated;
    try {
      counters.providerHydrations += 1;
      hydrated = await openAlexService.getInstitution(selectedRor, { signal });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      counters.hydrationProviderFailures += 1;
      return null;
    }

    if (!hydrated || normalizedRor(hydrated.ror) !== selectedRor) {
      return cacheMiss(cacheKey);
    }
    const identity = freezeInstitutionIdentity(hydrated);
    if (!identity) return cacheMiss(cacheKey);
    cache.set(cacheKey, identity);
    counters.resolved += 1;
    return identity;
  }

  const identityResolver = {
    resolve,
    get cacheSize() {
      return cache.size;
    },
  };
  Object.defineProperty(identityResolver, 'metrics', {
    enumerable: true,
    get: () => {
      const adapterMetrics = candidateAdapter?.metrics || {};
      return Object.freeze({
        resolveCalls: counters.resolveCalls,
        cacheHits: counters.cacheHits,
        singleFlightHits: Number(adapterMetrics.single_flight_hits) || 0,
        providerSearches: Number(adapterMetrics.provider_requests) || 0,
        providerHydrations: counters.providerHydrations,
        resolved: counters.resolved,
        definitiveMisses: counters.definitiveMisses,
        providerFailures: (Number(adapterMetrics.provider_failures) || 0)
          + counters.hydrationProviderFailures,
        cacheSize: cache.size,
        inFlightSize: 0,
        rorProviderRequests: Number(adapterMetrics.provider_requests) || 0,
        rorAffiliationLookups: Number(adapterMetrics.affiliation_lookups) || 0,
        rorCandidateSets: Number(adapterMetrics.candidate_sets) || 0,
        rorCandidatesReturned: Number(adapterMetrics.candidates_returned) || 0,
        rorMaxCandidatesReturned: Number(adapterMetrics.max_candidates_returned) || 0,
        rorOrdinaryQueryLookups: Number(adapterMetrics.ordinary_query_lookups) || 0,
        rorParentHydrations: Number(adapterMetrics.parent_hydrations) || 0,
        rorSuccessorHydrations: Number(adapterMetrics.successor_hydrations) || 0,
        rorRetries: Number(adapterMetrics.retries) || 0,
        rorCacheHits: Number(adapterMetrics.cache_hits) || 0,
        rorSingleFlightHits: Number(adapterMetrics.single_flight_hits) || 0,
        openAlexHydrations: counters.providerHydrations,
      });
    },
  });
  return Object.freeze(identityResolver);
}

module.exports = {
  createRorInstitutionIdentityResolver,
  decisionHasProviderFailure,
  normalizedRor,
};
