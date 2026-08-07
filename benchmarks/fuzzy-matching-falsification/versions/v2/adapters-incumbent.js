#!/usr/bin/env node
'use strict';

/**
 * v2 bridge for the frozen incumbent comparator. The incumbent resolves a
 * single OpenAlex winner, so this exposes at most one candidate; it does not
 * pretend to be the new candidate-union interface. Provider failures throw so
 * they cannot masquerade as clean retrieval misses.
 */
const { createInstitutionIdentityResolver } = require('../../../../lib/services/institution-identity-resolver');
const {
  assertCandidateInput,
  candidateInputHash,
  createCandidateSet,
  normalizeCandidate,
} = require('./candidate-contract');

const resolver = createInstitutionIdentityResolver({ propagateProviderErrors: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function institutionCandidates(input = {}) {
  assertCandidateInput(input);
  await sleep(150);
  const before = resolver.metrics;
  const identity = await resolver.resolve(input.affiliation_string, { signal: input.signal });
  const after = resolver.metrics;
  const candidates = [];
  if (identity?.ror) {
    candidates.push(normalizeCandidate({
      id: identity.ror,
      status: null,
      names: [{ value: identity.displayName, types: ['provider_display'], lang: null }],
      domains: [],
      locations: identity.country ? [{ country_code: identity.country }] : [],
      types: [],
      relationships: (identity.associatedInstitutions || [])
        .filter((associated) => associated.ror)
        .map((associated) => ({
          id: associated.ror,
          type: associated.relationship || 'related',
          label: associated.displayName,
        })),
    }, {
      strategy: 'incumbent-openalex-single-winner',
      rank: 0,
    }));
  }
  return createCandidateSet({
    provider: 'incumbent-openalex-single-winner',
    candidates,
    provenance: {
      api_version: 'openalex',
      adapter_version: 'incumbent-openalex-single-winner/v1',
      observed_on: new Date().toISOString().slice(0, 10),
      input_hash: candidateInputHash(input),
      strategies: ['incumbent-openalex-single-winner'],
      request_count: (after.providerSearches - before.providerSearches)
        + (after.providerHydrations - before.providerHydrations),
      // The incumbent service owns any provider retry policy; this bridge can
      // count its search/hydration calls but cannot observe lower-level retries.
      retry_count: null,
      cache_hit: after.cacheHits > before.cacheHits,
      single_flight_hit: after.singleFlightHits > before.singleFlightHits,
    },
  });
}

module.exports = { institutionCandidates };
