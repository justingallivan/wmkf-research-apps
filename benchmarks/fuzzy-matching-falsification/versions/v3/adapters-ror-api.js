#!/usr/bin/env node
'use strict';

/**
 * Benchmark-only ROR API v2 candidate-union adapter.
 *
 * Affiliation single-search is always primary. Ordinary query is a bounded
 * fallback for unreliable primary evidence and narrow contradiction probes;
 * withdrawn records may hydrate an explicitly linked active successor. The
 * adapter returns candidates and aggregate metrics only, never a verdict.
 */
const {
  assertCandidateInput,
  candidateInputHash,
  createCandidateSet,
  normalizeCandidate,
} = require('../v2/candidate-contract');
const { ordinaryFallbackQueries, supplementalEvidenceQueries } = require('./organization-parser');
const {
  candidateSignals,
  explicitAcronyms,
  hasStrongLexicalMatch,
  normalizeText,
} = require('./text-evidence');

const ROR_ENDPOINT = 'https://api.ror.org/v2/organizations';
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason || new Error('Aborted');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  throw error;
}

function ordinaryUrl(query) {
  const escaped = String(query || '').replace(/([+\-=!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
  const value = escaped.includes(' ') ? `"${escaped}"` : escaped;
  return `${ROR_ENDPOINT}?query=${encodeURIComponent(value)}&all_status`;
}

function createRorCandidateUnionAdapter({
  fetchImpl = global.fetch,
  sleep = defaultSleep,
  paceMs = 250,
  maxAttempts = 4,
  backoffBaseMs = 1000,
  requestTimeoutMs = 8000,
  clientId = process.env.ROR_CLIENT_ID || null,
  observedOn = new Date().toISOString().slice(0, 10),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('requestTimeoutMs must be positive');
  }
  const cache = new Map();
  const inFlight = new Map();
  const withoutSignal = Symbol('ror-v3-without-signal');
  const counters = {
    affiliation_lookups: 0,
    cache_hits: 0,
    candidate_sets: 0,
    candidates_returned: 0,
    max_candidates_returned: 0,
    ordinary_query_lookups: 0,
    parent_hydrations: 0,
    provider_failures: 0,
    provider_requests: 0,
    retries: 0,
    single_flight_hits: 0,
    successor_hydrations: 0,
  };
  let queue = Promise.resolve();
  let nextAt = 0;

  async function fetchOnce(url, signal) {
    counters.provider_requests += 1;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'WMKF-falsification-suite/3.0 (decision benchmark)',
    };
    if (clientId) headers['Client-Id'] = clientId;
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetchImpl(url, { headers, signal: requestSignal });
    if (response.status === 429 || response.status >= 500) {
      const retryAfterHeader = response.headers?.get?.('retry-after');
      const retryAfter = retryAfterHeader == null || retryAfterHeader === ''
        ? Number.NaN
        : Number(retryAfterHeader);
      const error = new Error(`ROR ${response.status}`);
      error.retryable = true;
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0
        ? retryAfter * 1000
        : null;
      throw error;
    }
    if (!response.ok) throw new Error(`ROR ${response.status} (non-retryable)`);
    const body = await response.json();
    if (!body || typeof body !== 'object') throw new Error('ROR malformed response');
    return body;
  }

  async function retrieve(url, signal) {
    let requestCount = 0;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      await sleep(Math.max(0, nextAt - Date.now()));
      throwIfAborted(signal);
      nextAt = Date.now() + paceMs;
      try {
        requestCount += 1;
        return { body: await fetchOnce(url, signal), requestCount };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        lastError = error;
        if (!error.retryable || attempt === maxAttempts - 1) throw error;
        counters.retries += 1;
        await sleep(error.retryAfterMs ?? backoffBaseMs * (2 ** attempt));
      }
    }
    throw lastError;
  }

  async function responseFor(key, url, signal) {
    throwIfAborted(signal);
    if (cache.has(key)) {
      counters.cache_hits += 1;
      return { body: cache.get(key), requestCount: 0, cacheHit: true, singleFlightHit: false };
    }
    const signalKey = signal || withoutSignal;
    let flights = inFlight.get(key);
    if (flights?.has(signalKey)) {
      counters.single_flight_hits += 1;
      const settled = await flights.get(signalKey);
      throwIfAborted(signal);
      return { body: settled.body, requestCount: 0, cacheHit: false, singleFlightHit: true };
    }
    if (!flights) {
      flights = new Map();
      inFlight.set(key, flights);
    }
    const run = () => retrieve(url, signal);
    const flight = queue.then(run, run);
    queue = flight.then(() => undefined, () => undefined);
    flights.set(signalKey, flight);
    try {
      const settled = await flight;
      cache.set(key, settled.body);
      return { ...settled, cacheHit: false, singleFlightHit: false };
    } catch (error) {
      if (!signal?.aborted) counters.provider_failures += 1;
      throw error;
    } finally {
      const current = inFlight.get(key);
      if (current?.get(signalKey) === flight) current.delete(signalKey);
      if (current?.size === 0) inFlight.delete(key);
    }
  }

  async function lookup({ key, url, strategy, signal, parse }) {
    if (strategy === 'affiliation-single-search') counters.affiliation_lookups += 1;
    if (strategy === 'ordinary-query') counters.ordinary_query_lookups += 1;
    if (strategy === 'successor-hydration') counters.successor_hydrations += 1;
    if (strategy === 'parent-hydration') counters.parent_hydrations += 1;
    const response = await responseFor(key, url, signal);
    const organizations = parse(response.body);
    if (!Array.isArray(organizations)) throw new Error(`ROR malformed ${strategy} response`);
    return {
      candidates: organizations.filter(Boolean).map((organization, rank) => normalizeCandidate(
        organization.organization || organization,
        organization.organization ? {
          strategy,
          rank,
          score: organization.score,
          matching_type: organization.matching_type,
          provider_chosen: organization.chosen,
        } : {
          strategy,
          rank,
          score: null,
          matching_type: null,
          provider_chosen: false,
        },
      )),
      response,
      strategy,
    };
  }

  async function institutionCandidates(input = {}) {
    assertCandidateInput(input);
    const affiliation = String(input.affiliation_string || '').trim();
    if (!affiliation) {
      const emptySet = createCandidateSet({
        provider: 'ror-api-v2-union',
        candidates: [],
        provenance: {
          api_version: 'v2', adapter_version: 'ror-api-claim-candidates/v1',
          observed_on: observedOn, input_hash: candidateInputHash(input),
          strategies: ['affiliation-single-search'], request_count: 0, retry_count: 0,
          cache_hit: false, single_flight_hit: false,
        },
      });
      counters.candidate_sets += 1;
      return emptySet;
    }

    const lookups = [];
    const affiliationLookup = await lookup({
      key: `affiliation:${normalizeText(affiliation)}`,
      url: `${ROR_ENDPOINT}?affiliation=${encodeURIComponent(affiliation)}&single_search`,
      strategy: 'affiliation-single-search',
      signal: input.signal,
      parse: (body) => body.items,
    });
    lookups.push(affiliationLookup);
    const candidates = [...affiliationLookup.candidates];

    const reliablePrimary = candidates.some((candidate) => {
      const signals = candidateSignals(candidate, input);
      return signals.exact_name || (hasStrongLexicalMatch(candidate, input)
        && candidate.retrieval.some((source) => source.provider_chosen));
    });
    const supplementalQueries = explicitAcronyms(affiliation).filter((acronym) => (
      !candidates.some((candidate) => candidateSignals(candidate, {
        affiliation_string: acronym,
      }).acronym)
    ));
    const ordinaryQueries = [...new Set([
      ...(!reliablePrimary ? ordinaryFallbackQueries(affiliation) : []),
      ...supplementalQueries,
      ...supplementalEvidenceQueries(affiliation),
    ])];
    for (const query of ordinaryQueries) {
        const ordinary = await lookup({
          key: `query:${normalizeText(query)}`,
          url: ordinaryUrl(query),
          strategy: 'ordinary-query',
          signal: input.signal,
          parse: (body) => body.items,
        });
        lookups.push(ordinary);
        candidates.push(...ordinary.candidates);
    }

    const successorIds = new Set();
    for (const candidate of candidates) {
      if (candidate.status === 'active') continue;
      for (const relationship of candidate.relationships) {
        if (relationship.type === 'successor') successorIds.add(relationship.ror_id);
      }
    }
    for (const successorId of successorIds) {
      if (candidates.some((candidate) => candidate.ror_id === successorId)) continue;
      const suffix = successorId.slice('https://ror.org/'.length);
      const successor = await lookup({
        key: `ror:${suffix}`,
        url: `${ROR_ENDPOINT}/${suffix}`,
        strategy: 'successor-hydration',
        signal: input.signal,
        parse: (body) => [body],
      });
      lookups.push(successor);
      candidates.push(...successor.candidates);
    }

    if (/\boffice of the president\b/i.test(affiliation)) {
      const parentIds = new Set(candidates.flatMap((candidate) => (
        candidate.relationships
          .filter((relationship) => relationship.type === 'parent')
          .map((relationship) => relationship.ror_id)
      )));
      for (const parentId of parentIds) {
        if (candidates.some((candidate) => candidate.ror_id === parentId)) continue;
        const suffix = parentId.slice('https://ror.org/'.length);
        const parent = await lookup({
          key: `ror:${suffix}`,
          url: `${ROR_ENDPOINT}/${suffix}`,
          strategy: 'parent-hydration',
          signal: input.signal,
          parse: (body) => [body],
        });
        lookups.push(parent);
        candidates.push(...parent.candidates);
      }
    }

    const requestCount = lookups.reduce((total, item) => total + item.response.requestCount, 0);
    const strategies = [...new Set(lookups.map((item) => item.strategy))];
    const candidateSet = createCandidateSet({
      provider: 'ror-api-v2-union',
      candidates,
      provenance: {
        api_version: 'v2',
        adapter_version: 'ror-api-claim-candidates/v1',
        observed_on: observedOn,
        input_hash: candidateInputHash(input),
        strategies,
        request_count: requestCount,
        retry_count: Math.max(0, requestCount - lookups.filter((item) => item.response.requestCount > 0).length),
        cache_hit: lookups.length > 0 && lookups.every((item) => item.response.cacheHit),
        single_flight_hit: lookups.some((item) => item.response.singleFlightHit),
      },
    });
    counters.candidate_sets += 1;
    counters.candidates_returned += candidateSet.candidates.length;
    counters.max_candidates_returned = Math.max(
      counters.max_candidates_returned,
      candidateSet.candidates.length,
    );
    return candidateSet;
  }

  const adapter = { institutionCandidates };
  Object.defineProperty(adapter, 'metrics', {
    enumerable: true,
    get: () => Object.freeze({ ...counters }),
  });
  return Object.freeze(adapter);
}

const defaultAdapter = createRorCandidateUnionAdapter();

const exported = {
  createRorCandidateUnionAdapter,
  institutionCandidates: defaultAdapter.institutionCandidates,
  ordinaryUrl,
};
Object.defineProperty(exported, 'metrics', {
  enumerable: true,
  get: () => defaultAdapter.metrics,
});
module.exports = exported;
