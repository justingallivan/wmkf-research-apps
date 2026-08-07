#!/usr/bin/env node
'use strict';

/**
 * Benchmark-only ROR API v2 candidate adapter.
 *
 * This is not wired to the application. It requests `single_search`
 * explicitly, returns every affiliation candidate with provider provenance,
 * and never turns `chosen`, rank, or score into a local resolution verdict.
 */
const {
  assertCandidateInput,
  candidateInputHash,
  createCandidateSet,
  normalizeCandidate,
} = require('./candidate-contract');

const ROR_ENDPOINT = 'https://api.ror.org/v2/organizations';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = signal.reason || new Error('Aborted');
  if (!error.name || error.name === 'Error') error.name = 'AbortError';
  throw error;
}

function createRorCandidateAdapter({
  fetchImpl = global.fetch,
  sleep = defaultSleep,
  paceMs = 250,
  maxAttempts = 4,
  backoffBaseMs = 1000,
  clientId = process.env.ROR_CLIENT_ID || null,
  observedOn = new Date().toISOString().slice(0, 10),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const cache = new Map();
  const inFlight = new Map();
  const withoutSignal = Symbol('ror-candidate-adapter-without-signal');
  let queue = Promise.resolve();
  let nextAt = 0;

  async function fetchOnce(affiliation, signal) {
    const url = `${ROR_ENDPOINT}?affiliation=${encodeURIComponent(affiliation)}&single_search`;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'WMKF-falsification-suite/2.0 (candidate benchmark)',
    };
    if (clientId) headers['Client-Id'] = clientId;
    const response = await fetchImpl(url, { headers, signal });
    if (response.status === 429 || response.status >= 500) {
      const retryAfterHeader = response.headers.get('retry-after');
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
    if (!body || !Array.isArray(body.items)) throw new Error('ROR malformed response: items missing');
    return body;
  }

  async function retrieve(affiliation, signal) {
    let lastError = null;
    let requestCount = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      await sleep(Math.max(0, nextAt - Date.now()));
      throwIfAborted(signal);
      nextAt = Date.now() + paceMs;
      try {
        requestCount += 1;
        return { body: await fetchOnce(affiliation, signal), requestCount };
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        lastError = error;
        if (!error.retryable || attempt === maxAttempts - 1) throw error;
        await sleep(error.retryAfterMs ?? backoffBaseMs * (2 ** attempt));
      }
    }
    throw lastError;
  }

  async function responseFor(affiliation, signal) {
    const key = String(affiliation || '').trim();
    if (!key) {
      return {
        body: { items: [] }, cacheHit: false, singleFlightHit: false, requestCount: 0,
      };
    }
    if (cache.has(key)) {
      return {
        body: cache.get(key), cacheHit: true, singleFlightHit: false, requestCount: 0,
      };
    }

    // Share active work only inside the same cancellation scope. This prevents
    // one caller's AbortSignal from cancelling a logically separate caller.
    const signalKey = signal || withoutSignal;
    let flightsBySignal = inFlight.get(key);
    if (flightsBySignal?.has(signalKey)) {
      const settled = await flightsBySignal.get(signalKey);
      return {
        body: settled.body, cacheHit: false, singleFlightHit: true, requestCount: 0,
      };
    }
    if (!flightsBySignal) {
      flightsBySignal = new Map();
      inFlight.set(key, flightsBySignal);
    }

    const run = () => retrieve(key, signal);
    const flight = queue.then(run, run);
    queue = flight.then(() => undefined, () => undefined);
    flightsBySignal.set(signalKey, flight);
    try {
      const settled = await flight;
      cache.set(key, settled.body);
      return {
        body: settled.body,
        cacheHit: false,
        singleFlightHit: false,
        requestCount: settled.requestCount,
      };
    } finally {
      const current = inFlight.get(key);
      if (current?.get(signalKey) === flight) current.delete(signalKey);
      if (current?.size === 0) inFlight.delete(key);
    }
  }

  async function institutionCandidates(input = {}) {
    assertCandidateInput(input);
    const { body, cacheHit, singleFlightHit, requestCount } = await responseFor(
      input.affiliation_string,
      input.signal,
    );
    const items = Array.isArray(body?.items) ? body.items : [];
    const candidates = items
      .filter((item) => item?.organization)
      .map((item, rank) => normalizeCandidate(item.organization, {
        strategy: 'affiliation-single-search',
        rank,
        score: item.score,
        matching_type: item.matching_type,
        provider_chosen: item.chosen,
      }));
    return createCandidateSet({
      provider: 'ror-api-v2',
      candidates,
      provenance: {
        api_version: 'v2',
        adapter_version: 'ror-api-candidate/v1',
        observed_on: observedOn,
        input_hash: candidateInputHash(input),
        strategies: ['affiliation-single-search'],
        request_count: requestCount,
        retry_count: Math.max(0, requestCount - 1),
        cache_hit: cacheHit,
        single_flight_hit: singleFlightHit,
      },
    });
  }

  return Object.freeze({ institutionCandidates });
}

const defaultAdapter = createRorCandidateAdapter();

module.exports = {
  createRorCandidateAdapter,
  institutionCandidates: defaultAdapter.institutionCandidates,
};
