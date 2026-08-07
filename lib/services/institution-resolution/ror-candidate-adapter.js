'use strict';

/**
 * ROR API v2 candidate-union adapter shared by production shadow resolution
 * and the frozen falsification benchmark.
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
} = require('./candidate-contract');
const crypto = require('crypto');
const { ordinaryFallbackQueries } = require('./organization-parser');
const {
  candidateSignals,
  explicitAcronyms,
  hasStrongLexicalMatch,
} = require('./text-evidence');

const ROR_ENDPOINT = 'https://api.ror.org/v2/organizations';
const API_VERSION = 'v2';
const ADAPTER_VERSION = 'ror-api-claim-candidates/v1';
const AFFILIATION_STRATEGY = 'single_search';
const MAX_HYDRATIONS = 4;
const MAX_ORDINARY_QUERIES = 3;
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

function requestKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function createRorCandidateUnionAdapter({
  fetchImpl = global.fetch,
  sleep = defaultSleep,
  paceMs = 250,
  maxAttempts = 4,
  backoffBaseMs = 1000,
  maxRetryDelayMs = 5000,
  maxProviderRequestsPerResolution = 24,
  requestTimeoutMs = 8000,
  resolutionTimeoutMs = 20000,
  clientId = process.env.ROR_CLIENT_ID || null,
  observedOn = new Date().toISOString().slice(0, 10),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  for (const [name, value] of Object.entries({
    maxRetryDelayMs, maxProviderRequestsPerResolution, requestTimeoutMs, resolutionTimeoutMs,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  }
  if (!Number.isInteger(maxProviderRequestsPerResolution)) {
    throw new Error('maxProviderRequestsPerResolution must be an integer');
  }
  const cache = new Map();
  const inFlight = new Map();
  const resolutionScopes = new WeakSet();
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

  function beginResolution({ signal } = {}) {
    const deadlineSignal = AbortSignal.timeout(resolutionTimeoutMs);
    const scope = {
      budget: { remaining: maxProviderRequestsPerResolution },
      callerSignal: signal || null,
      failureRecorded: false,
      flightScope: null,
      operationSignal: signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal,
    };
    scope.flightScope = scope;
    resolutionScopes.add(scope);
    return scope;
  }

  function requireResolutionScope(input, suppliedScope) {
    if (suppliedScope != null) {
      if (!resolutionScopes.has(suppliedScope)) {
        throw new Error('resolutionScope must come from beginResolution()');
      }
      if (input.signal && suppliedScope.callerSignal !== input.signal) {
        throw new Error('resolutionScope signal does not match candidate input signal');
      }
      return suppliedScope;
    }
    return beginResolution({ signal: input.signal });
  }

  function recordResolutionFailure(scope) {
    if (scope.callerSignal?.aborted || scope.failureRecorded) return;
    scope.failureRecorded = true;
    counters.provider_failures += 1;
  }

  async function withAbort(promise, signal) {
    throwIfAborted(signal);
    let onAbort;
    const aborted = new Promise((resolve, reject) => {
      onAbort = () => reject(signal.reason || new Error('Aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async function wait(ms, signal) {
    throwIfAborted(signal);
    if (ms <= 0) return;
    await withAbort(sleep(ms), signal);
    throwIfAborted(signal);
  }

  async function fetchOnce(url, signal, budget) {
    if (budget.remaining <= 0) throw new Error('ROR per-resolution request budget exhausted');
    budget.remaining -= 1;
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

  async function retrieve(url, signal, budget) {
    let requestCount = 0;
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      await wait(Math.max(0, nextAt - Date.now()), signal);
      throwIfAborted(signal);
      nextAt = Date.now() + paceMs;
      try {
        requestCount += 1;
        return { body: await fetchOnce(url, signal, budget), requestCount };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        lastError = error;
        if (!error.retryable || attempt === maxAttempts - 1) throw error;
        counters.retries += 1;
        const retryDelay = Math.min(
          maxRetryDelayMs,
          error.retryAfterMs ?? backoffBaseMs * (2 ** attempt),
        );
        await wait(retryDelay, signal);
      }
    }
    throw lastError;
  }

  async function responseFor(url, resolution) {
    const key = requestKey(url);
    const { operationSignal: signal, flightScope, budget } = resolution;
    throwIfAborted(signal);
    if (cache.has(key)) {
      counters.cache_hits += 1;
      return { body: cache.get(key), requestCount: 0, cacheHit: true, singleFlightHit: false };
    }
    let flights = inFlight.get(key);
    if (flights?.has(flightScope)) {
      counters.single_flight_hits += 1;
      const settled = await withAbort(flights.get(flightScope), signal);
      throwIfAborted(signal);
      return { body: settled.body, requestCount: 0, cacheHit: false, singleFlightHit: true };
    }
    if (!flights) {
      flights = new Map();
      inFlight.set(key, flights);
    }
    const run = () => retrieve(url, signal, budget);
    const queuedRun = queue.then(run, run);
    queue = queuedRun.then(() => undefined, () => undefined);
    const flight = withAbort(queuedRun, signal);
    flights.set(flightScope, flight);
    try {
      const settled = await flight;
      cache.set(key, settled.body);
      return { ...settled, cacheHit: false, singleFlightHit: false };
    } finally {
      const current = inFlight.get(key);
      if (current?.get(flightScope) === flight) current.delete(flightScope);
      if (current?.size === 0) inFlight.delete(key);
    }
  }

  async function lookup({ url, strategy, resolution, parse }) {
    if (strategy === 'affiliation-single-search') counters.affiliation_lookups += 1;
    if (strategy === 'ordinary-query') counters.ordinary_query_lookups += 1;
    if (strategy === 'successor-hydration') counters.successor_hydrations += 1;
    if (strategy === 'parent-hydration') counters.parent_hydrations += 1;
    const response = await responseFor(url, resolution);
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

  async function institutionCandidates(input = {}, { resolutionScope } = {}) {
    assertCandidateInput(input);
    const resolution = requireResolutionScope(input, resolutionScope);
    try {
      return await institutionCandidatesInScope(input, resolution);
    } catch (error) {
      recordResolutionFailure(resolution);
      throw error;
    }
  }

  async function institutionCandidatesInScope(input, resolution) {
    const affiliation = String(input.affiliation_string || '').trim();
    if (!affiliation) {
      const emptySet = createCandidateSet({
        provider: 'ror-api-v2-union',
        candidates: [],
        provenance: {
          api_version: API_VERSION, adapter_version: ADAPTER_VERSION,
          observed_on: observedOn, input_hash: candidateInputHash(input),
          strategies: ['affiliation-single-search'], request_count: 0, retry_count: 0,
          cache_hit: false, single_flight_hit: false,
        },
      });
      counters.candidate_sets += 1;
      return emptySet;
    }

    const lookups = [];
    const affiliationUrl = `${ROR_ENDPOINT}?affiliation=${encodeURIComponent(affiliation)}&single_search`;
    const affiliationLookup = await lookup({
      url: affiliationUrl,
      strategy: 'affiliation-single-search',
      resolution,
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
    ])].slice(0, MAX_ORDINARY_QUERIES);
    for (const query of ordinaryQueries) {
        const url = ordinaryUrl(query);
        const ordinary = await lookup({
          url,
          strategy: 'ordinary-query',
          resolution,
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
    if (successorIds.size > MAX_HYDRATIONS) {
      throw new Error('ROR successor hydration limit exceeded');
    }
    for (const successorId of successorIds) {
      if (candidates.some((candidate) => candidate.ror_id === successorId)) continue;
      const suffix = successorId.slice('https://ror.org/'.length);
      const successor = await lookup({
        url: `${ROR_ENDPOINT}/${suffix}`,
        strategy: 'successor-hydration',
        resolution,
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
      if (parentIds.size > MAX_HYDRATIONS) {
        throw new Error('ROR parent hydration limit exceeded');
      }
      for (const parentId of parentIds) {
        if (candidates.some((candidate) => candidate.ror_id === parentId)) continue;
        const suffix = parentId.slice('https://ror.org/'.length);
        const parent = await lookup({
          url: `${ROR_ENDPOINT}/${suffix}`,
          strategy: 'parent-hydration',
          resolution,
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
        api_version: API_VERSION,
        adapter_version: ADAPTER_VERSION,
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

  const adapter = {
    beginResolution,
    institutionCandidates,
    metadata: Object.freeze({
      adapter_version: ADAPTER_VERSION,
      affiliation_strategy: AFFILIATION_STRATEGY,
      api_version: API_VERSION,
      endpoint: ROR_ENDPOINT,
      observed_on: observedOn,
      strategies: Object.freeze([
        'affiliation-single-search', 'ordinary-query', 'successor-hydration', 'parent-hydration',
      ]),
    }),
  };
  Object.defineProperty(adapter, 'metrics', {
    enumerable: true,
    get: () => Object.freeze({ ...counters }),
  });
  return Object.freeze(adapter);
}

const defaultAdapter = createRorCandidateUnionAdapter();

const exported = {
  beginResolution: defaultAdapter.beginResolution,
  createRorCandidateUnionAdapter,
  institutionCandidates: defaultAdapter.institutionCandidates,
  metadata: defaultAdapter.metadata,
  ordinaryUrl,
};
Object.defineProperty(exported, 'metrics', {
  enumerable: true,
  get: () => defaultAdapter.metrics,
});
module.exports = exported;
