'use strict';

/**
 * Request-scoped ROR API v2 candidate-union adapter.
 *
 * Affiliation `single_search` is primary. Ordinary query is a bounded recall
 * fallback and contradiction probe. This module returns candidates plus
 * aggregate provenance only; it never selects an institution.
 */
const crypto = require('node:crypto');
const {
  assertCandidateInput,
  candidateInputHash,
  createCandidateSet,
  normalizeCandidate,
} = require('./ror-institution-candidate-contract');
const {
  candidateSignals,
  explicitAcronyms,
  hasStrongLexicalMatch,
  ordinaryFallbackQueries,
} = require('./ror-institution-evidence');

const ROR_ENDPOINT = 'https://api.ror.org/v2/organizations';
const API_VERSION = 'v2';
const ADAPTER_VERSION = 'ror-api-claim-candidates/v1';
const AFFILIATION_STRATEGY = 'single_search';
const MAX_HYDRATIONS = 4;
const MAX_ORDINARY_QUERIES = 3;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(value, now = Date.now()) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

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
  fetchImpl = globalThis.fetch,
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
    maxRetryDelayMs,
    maxProviderRequestsPerResolution,
    requestTimeoutMs,
    resolutionTimeoutMs,
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
    affiliationLookups: 0,
    cacheHits: 0,
    candidateSets: 0,
    candidatesReturned: 0,
    maxCandidatesReturned: 0,
    malformedResponses: 0,
    ordinaryQueryLookups: 0,
    parentHydrations: 0,
    providerFailures: 0,
    providerLatencyMs: 0,
    providerRequests: 0,
    providerTimeouts: 0,
    response2xx: 0,
    response3xx: 0,
    response4xx: 0,
    response5xx: 0,
    retries: 0,
    singleFlightHits: 0,
    successorHydrations: 0,
    transportFailures: 0,
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
    counters.providerFailures += 1;
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
    counters.providerRequests += 1;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'WMKF-Apps/1.0 (institution resolution)',
    };
    if (clientId) headers['Client-Id'] = clientId;
    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const startedAt = Date.now();
    let response = null;
    try {
      response = await fetchImpl(url, { headers, signal: requestSignal });
      if (response.status >= 200 && response.status < 300) counters.response2xx += 1;
      else if (response.status >= 300 && response.status < 400) counters.response3xx += 1;
      else if (response.status >= 400 && response.status < 500) counters.response4xx += 1;
      else if (response.status >= 500 && response.status < 600) counters.response5xx += 1;
      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers?.get?.('retry-after');
        const error = new Error(`ROR ${response.status}`);
        error.retryable = true;
        error.retryAfterMs = parseRetryAfterMs(retryAfterHeader);
        throw error;
      }
      if (!response.ok) throw new Error(`ROR ${response.status} (non-retryable)`);
      let body;
      try {
        body = await response.json();
      } catch (error) {
        counters.malformedResponses += 1;
        throw error;
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        counters.malformedResponses += 1;
        throw new Error('ROR malformed response');
      }
      return body;
    } catch (error) {
      if (!response) {
        if (timeoutSignal.aborted) counters.providerTimeouts += 1;
        else if (!signal?.aborted) counters.transportFailures += 1;
      }
      throw error;
    } finally {
      counters.providerLatencyMs += Math.max(0, Date.now() - startedAt);
    }
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
      counters.cacheHits += 1;
      return {
        body: cache.get(key),
        cacheKey: key,
        requestCount: 0,
        cacheHit: true,
        singleFlightHit: false,
      };
    }
    let flights = inFlight.get(key);
    if (flights?.has(flightScope)) {
      counters.singleFlightHits += 1;
      const settled = await withAbort(flights.get(flightScope), signal);
      throwIfAborted(signal);
      return {
        body: settled.body,
        cacheKey: key,
        requestCount: 0,
        cacheHit: false,
        singleFlightHit: true,
      };
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
      return {
        ...settled,
        cacheKey: key,
        cacheHit: false,
        singleFlightHit: false,
      };
    } finally {
      const current = inFlight.get(key);
      if (current?.get(flightScope) === flight) current.delete(flightScope);
      if (current?.size === 0) inFlight.delete(key);
    }
  }

  async function lookup({ url, strategy, resolution, parse }) {
    if (strategy === 'affiliation-single-search') counters.affiliationLookups += 1;
    if (strategy === 'ordinary-query') counters.ordinaryQueryLookups += 1;
    if (strategy === 'successor-hydration') counters.successorHydrations += 1;
    if (strategy === 'parent-hydration') counters.parentHydrations += 1;
    const response = await responseFor(url, resolution);
    const organizations = parse(response.body);
    if (!Array.isArray(organizations)) {
      counters.malformedResponses += 1;
      throw new Error(`ROR malformed ${strategy} response`);
    }
    const candidates = organizations.filter(Boolean).map((organization, rank) => normalizeCandidate(
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
    ));
    if (!response.cacheHit) cache.set(response.cacheKey, response.body);
    return {
      candidates,
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
          api_version: API_VERSION,
          adapter_version: ADAPTER_VERSION,
          observed_on: observedOn,
          input_hash: candidateInputHash(input),
          strategies: ['affiliation-single-search'],
          request_count: 0,
          retry_count: 0,
          cache_hit: false,
          single_flight_hit: false,
        },
      });
      counters.candidateSets += 1;
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
      const ordinary = await lookup({
        url: ordinaryUrl(query),
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
        retry_count: Math.max(
          0,
          requestCount - lookups.filter((item) => item.response.requestCount > 0).length,
        ),
        cache_hit: lookups.length > 0 && lookups.every((item) => item.response.cacheHit),
        single_flight_hit: lookups.some((item) => item.response.singleFlightHit),
      },
    });
    counters.candidateSets += 1;
    counters.candidatesReturned += candidateSet.candidates.length;
    counters.maxCandidatesReturned = Math.max(
      counters.maxCandidatesReturned,
      candidateSet.candidates.length,
    );
    return candidateSet;
  }

  const adapter = {
    beginResolution,
    institutionCandidates,
    metadata: Object.freeze({
      adapterVersion: ADAPTER_VERSION,
      affiliationStrategy: AFFILIATION_STRATEGY,
      apiVersion: API_VERSION,
      endpoint: ROR_ENDPOINT,
      observedOn,
      strategies: Object.freeze([
        'affiliation-single-search',
        'ordinary-query',
        'successor-hydration',
        'parent-hydration',
      ]),
    }),
  };
  Object.defineProperty(adapter, 'metrics', {
    enumerable: true,
    get: () => Object.freeze({
      ...counters,
      cacheSize: cache.size,
      inFlightSize: [...inFlight.values()].reduce((sum, flights) => sum + flights.size, 0),
    }),
  });
  return Object.freeze(adapter);
}

module.exports = {
  ADAPTER_VERSION,
  AFFILIATION_STRATEGY,
  API_VERSION,
  ROR_ENDPOINT,
  createRorCandidateUnionAdapter,
  ordinaryUrl,
  parseRetryAfterMs,
};
