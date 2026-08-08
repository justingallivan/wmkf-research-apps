/**
 * @jest-environment node
 */

const {
  assertCandidateInput,
  createCandidateSet,
} = require('../../lib/services/ror-institution-candidate-contract');
const {
  createRorCandidateUnionAdapter,
  parseRetryAfterMs,
} = require('../../lib/services/ror-institution-candidate-adapter');
const {
  createInstitutionDecisionResolver,
  decideSingle,
} = require('../../lib/services/ror-institution-decision');
const {
  createRorInstitutionIdentityResolver,
} = require('../../lib/services/ror-institution-identity-resolver');

const OBSERVED_ON = '2026-08-08';

function organization({
  id = 'https://ror.org/012345678',
  name = 'Example University',
  acronym = null,
  domains = ['example.edu'],
  country = 'US',
  city = 'Example City',
  status = 'active',
  types = ['education'],
  relationships = [],
} = {}) {
  const names = [{ value: name, types: ['ror_display'], lang: 'en' }];
  if (acronym) names.push({ value: acronym, types: ['acronym'], lang: null });
  return {
    id,
    status,
    names,
    domains,
    locations: [{
      geonames_details: {
        country_code: country,
        country_subdivision_code: null,
        name: city,
      },
    }],
    types,
    relationships,
  };
}

function rorResponse(items, { status = 200, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: jest.fn(async () => ({ items })),
  };
}

function candidate({
  id = 'https://ror.org/012345678',
  name = 'Example University',
  acronym = null,
  domains = ['example.edu'],
  country = 'US',
  city = 'Example City',
  status = 'active',
  types = ['education'],
  relationships = [],
  chosen = false,
  rank = 0,
  score = 1,
} = {}) {
  return createCandidateSet({
    provider: 'test',
    candidates: [{
      organization: organization({
        id, name, acronym, domains, country, city, status, types, relationships,
      }),
      retrieval: {
        strategy: 'affiliation-single-search',
        provider_chosen: chosen,
        rank,
        score,
      },
    }],
    provenance: {
      adapter_version: 'test/v1',
      observed_on: OBSERVED_ON,
      input_hash: 'a'.repeat(64),
      strategies: ['affiliation-single-search'],
    },
  }).candidates[0];
}

function candidateSet(candidates) {
  return createCandidateSet({
    provider: 'test',
    candidates,
    provenance: {
      adapter_version: 'test/v1',
      observed_on: OBSERVED_ON,
      input_hash: 'b'.repeat(64),
      strategies: ['affiliation-single-search'],
    },
  });
}

describe('production ROR institution resolution', () => {
  test('candidate input is institution-only and rejects contact or arbitrary payload fields', () => {
    expect(() => assertCandidateInput({
      affiliation_string: 'Example University',
      reviewer_name: 'Private Person',
    })).toThrow('must not contain reviewer_name');
    expect(() => assertCandidateInput({
      affiliation_string: 'person@example.edu',
    })).toThrow('must not contain an email address');
    expect(() => assertCandidateInput({
      affiliation_string: 'Example University',
      domain_evidence: 'https://example.edu/path',
    })).toThrow('bare domains only');
  });

  test('candidate contract rejects provider-supplied decision authority', () => {
    const resolvedCandidate = candidate();
    expect(() => createCandidateSet({
      provider: 'unsafe-provider',
      candidates: [{ ...resolvedCandidate, verdict: 'resolved' }],
      provenance: {
        adapter_version: 'unsafe/v1',
        observed_on: OBSERVED_ON,
        input_hash: 'c'.repeat(64),
        strategies: ['affiliation-single-search'],
      },
    })).toThrow('must not contain decision field verdict');
    expect(() => createCandidateSet({
      provider: 'unsafe-provider',
      candidates: [{
        ...resolvedCandidate,
        retrieval: [{ ...resolvedCandidate.retrieval[0], selected: true }],
      }],
      provenance: {
        adapter_version: 'unsafe/v1',
        observed_on: OBSERVED_ON,
        input_hash: 'c'.repeat(64),
        strategies: ['affiliation-single-search'],
      },
    })).toThrow('retrieval must not contain decision field selected');
  });

  test('adapter explicitly requests single_search and keeps local evidence out of the request', async () => {
    const fetchImpl = jest.fn(async () => rorResponse([{
      chosen: true,
      score: 1,
      matching_type: 'SINGLE SEARCH',
      organization: organization(),
    }]));
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl,
      clientId: 'test-client-id',
      paceMs: 0,
      observedOn: OBSERVED_ON,
    });

    const result = await adapter.institutionCandidates({
      affiliation_string: 'Example University',
      country_code: 'US',
      domain_evidence: 'example.edu',
    });

    expect(result.candidates).toHaveLength(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('affiliation=Example%20University');
    expect(url).toContain('&single_search');
    expect(url).not.toContain('example.edu');
    expect(url).not.toContain('country');
    expect(options.headers['Client-Id']).toBe('test-client-id');
    expect(JSON.stringify(options)).not.toContain('Example University');
  });

  test('adapter single-flights an identical lookup only inside the same resolution scope', async () => {
    let release;
    const fetchImpl = jest.fn(() => new Promise((resolve) => {
      release = () => resolve(rorResponse([{
        chosen: true,
        score: 1,
        matching_type: 'SINGLE SEARCH',
        organization: organization(),
      }]));
    }));
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl,
      paceMs: 0,
      observedOn: OBSERVED_ON,
      requestTimeoutMs: 1000,
      resolutionTimeoutMs: 1000,
    });
    const scope = adapter.beginResolution();
    const input = { affiliation_string: 'Example University' };
    const first = adapter.institutionCandidates(input, { resolutionScope: scope });
    const second = adapter.institutionCandidates(input, { resolutionScope: scope });
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.candidates).toHaveLength(1);
    expect(secondResult.candidates).toHaveLength(1);
    expect(adapter.metrics.singleFlightHits).toBe(1);
  });

  test('adapter retries only transient responses and does not cache malformed provider data', async () => {
    const sleep = jest.fn(async () => {});
    const transientFetch = jest.fn()
      .mockResolvedValueOnce(rorResponse([], { status: 500 }))
      .mockResolvedValueOnce(rorResponse([{
        chosen: true,
        score: 1,
        matching_type: 'SINGLE SEARCH',
        organization: organization(),
      }]));
    const retrying = createRorCandidateUnionAdapter({
      fetchImpl: transientFetch,
      sleep,
      paceMs: 0,
      maxAttempts: 2,
      backoffBaseMs: 1,
      maxRetryDelayMs: 10,
      observedOn: OBSERVED_ON,
    });
    await expect(retrying.institutionCandidates({
      affiliation_string: 'Example University',
    })).resolves.toMatchObject({ candidates: [expect.any(Object)] });
    expect(transientFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1);
    expect(retrying.metrics).toMatchObject({ retries: 1, response2xx: 1, response5xx: 1 });

    const nonRetryableFetch = jest.fn(async () => rorResponse([], { status: 400 }));
    const nonRetrying = createRorCandidateUnionAdapter({
      fetchImpl: nonRetryableFetch,
      sleep,
      paceMs: 0,
      observedOn: OBSERVED_ON,
    });
    await expect(nonRetrying.institutionCandidates({
      affiliation_string: 'Example University',
    })).rejects.toThrow('non-retryable');
    expect(nonRetryableFetch).toHaveBeenCalledTimes(1);

    const networkFetch = jest.fn(async () => {
      throw new TypeError('connection reset');
    });
    const networkNonRetrying = createRorCandidateUnionAdapter({
      fetchImpl: networkFetch,
      sleep,
      paceMs: 0,
      observedOn: OBSERVED_ON,
    });
    await expect(networkNonRetrying.institutionCandidates({
      affiliation_string: 'Example University',
    })).rejects.toThrow('connection reset');
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(networkNonRetrying.metrics.transportFailures).toBe(1);

    const malformedFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: 'not-an-array' }),
    }));
    const malformed = createRorCandidateUnionAdapter({
      fetchImpl: malformedFetch,
      paceMs: 0,
      observedOn: OBSERVED_ON,
    });
    await expect(malformed.institutionCandidates({
      affiliation_string: 'Example University',
    })).rejects.toThrow('malformed affiliation-single-search response');
    await expect(malformed.institutionCandidates({
      affiliation_string: 'Example University',
    })).rejects.toThrow('malformed affiliation-single-search response');
    expect(malformedFetch).toHaveBeenCalledTimes(2);
    expect(malformed.metrics).toMatchObject({
      cacheSize: 0,
      malformedResponses: 2,
      response2xx: 2,
    });
  });

  test('adapter obeys both Retry-After formats within its cap', async () => {
    const success = rorResponse([{
      chosen: true,
      score: 1,
      matching_type: 'SINGLE SEARCH',
      organization: organization(),
    }]);
    const now = Date.parse('2026-08-08T12:00:00Z');
    expect(parseRetryAfterMs('3', now)).toBe(3000);
    expect(parseRetryAfterMs('Sat, 08 Aug 2026 12:00:03 GMT', now)).toBe(3000);
    expect(parseRetryAfterMs('invalid', now)).toBeNull();

    const dateSleep = jest.fn(async () => {});
    const dateFetch = jest.fn()
      .mockResolvedValueOnce(rorResponse([], {
        status: 429,
        retryAfter: 'Sat, 08 Aug 2026 12:00:03 GMT',
      }))
      .mockResolvedValueOnce(success);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const dateAdapter = createRorCandidateUnionAdapter({
        fetchImpl: dateFetch,
        sleep: dateSleep,
        paceMs: 0,
        maxAttempts: 2,
        maxRetryDelayMs: 2000,
        observedOn: OBSERVED_ON,
      });
      await expect(dateAdapter.institutionCandidates({
        affiliation_string: 'Example University',
      })).resolves.toMatchObject({ candidates: [expect.any(Object)] });
      expect(dateSleep).toHaveBeenCalledWith(2000);
      expect(dateAdapter.metrics).toMatchObject({ response2xx: 1, response4xx: 1 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('decision seam rejects a provider candidate set that bypasses the verdict-free contract', async () => {
    const safeSet = candidateSet([candidate()]);
    const unsafeSet = {
      ...safeSet,
      candidates: [{ ...safeSet.candidates[0], selected: true }],
    };
    const resolver = createInstitutionDecisionResolver({
      candidateAdapter: {
        institutionCandidates: jest.fn(async () => unsafeSet),
      },
    });
    await expect(resolver.resolve({
      affiliation_string: 'Example University',
    })).resolves.toMatchObject({
      outcome: 'review',
      reasons: ['provider_failure'],
    });
  });

  test('an aborted caller cannot start, reuse, or hydrate institution work', async () => {
    const reason = new Error('caller stopped');
    reason.name = 'AbortError';
    const controller = new AbortController();
    controller.abort(reason);
    const fetchImpl = jest.fn();
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl,
      paceMs: 0,
      observedOn: OBSERVED_ON,
    });
    await expect(adapter.institutionCandidates({
      affiliation_string: 'Example University',
      signal: controller.signal,
    })).rejects.toBe(reason);
    expect(fetchImpl).not.toHaveBeenCalled();

    const institutionCandidates = jest.fn(async () => candidateSet([
      candidate({ name: 'Example University' }),
    ]));
    const getInstitution = jest.fn();
    const resolver = createRorInstitutionIdentityResolver({
      candidateAdapter: { institutionCandidates, metrics: {} },
      openAlexService: { getInstitution },
    });
    await expect(resolver.resolve('Example University', {
      signal: controller.signal,
    })).rejects.toBe(reason);
    expect(institutionCandidates).not.toHaveBeenCalled();
    expect(getInstitution).not.toHaveBeenCalled();
  });

  test('provider chosen, score, and first rank cannot resolve without local evidence', () => {
    const misleading = candidate({
      name: 'Unrelated Research Foundation',
      chosen: true,
      rank: 0,
      score: 1,
      types: ['education'],
    });
    const decision = decideSingle(
      { affiliation_string: 'Example University' },
      candidateSet([misleading]),
    );
    expect(decision.outcome).toBe('review');
    expect(decision.selected_ror_ids).toEqual([]);
    expect(decision.reasons).toEqual(['insufficient_evidence']);
  });

  test('domain conflict vetoes an otherwise exact, provider-chosen candidate before scoring', () => {
    const exact = candidate({ chosen: true, domains: ['other.edu'] });
    const decision = decideSingle(
      { affiliation_string: 'Example University', domain_evidence: 'example.edu' },
      candidateSet([exact]),
    );
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toEqual(['all_candidates_vetoed']);
    expect(decision.evaluations[0].score).toBeGreaterThan(200);
    expect(decision.evaluations[0].vetoes).toContain('domain_conflict');
  });

  test('contradictory sibling evidence forces review even when both candidates score', () => {
    const parent = 'https://ror.org/000000001';
    const left = candidate({
      id: 'https://ror.org/000000002',
      name: 'University of California Berkeley',
      acronym: 'UCB',
      relationships: [{ id: parent, type: 'parent', label: 'University of California' }],
    });
    const right = candidate({
      id: 'https://ror.org/000000003',
      name: 'University of California Los Angeles',
      acronym: 'UCLA',
      relationships: [{ id: parent, type: 'parent', label: 'University of California' }],
    });
    const decision = decideSingle(
      { affiliation_string: 'University of California Berkeley (UCLA)' },
      candidateSet([left, right]),
    );
    expect(decision.outcome).toBe('review');
    expect(decision.reasons).toEqual(['sibling_conflict']);
    expect(decision.evaluations.every((entry) => entry.vetoes.includes('sibling_conflict')))
      .toBe(true);
  });

  test('provider failure and a shared multi-span budget both fail closed to review', async () => {
    const failing = createInstitutionDecisionResolver({
      candidateAdapter: {
        institutionCandidates: jest.fn(async () => {
          throw new Error('provider unavailable');
        }),
      },
    });
    await expect(failing.resolve({ affiliation_string: 'Example University' }))
      .resolves.toMatchObject({
        outcome: 'review',
        reasons: ['provider_failure'],
        selected_ror_ids: [],
      });

    const fetchImpl = jest.fn(async (url) => {
      const name = decodeURIComponent(new URL(url).searchParams.get('affiliation'));
      return rorResponse([{
        chosen: true,
        score: 1,
        matching_type: 'SINGLE SEARCH',
        organization: organization({
          id: name.startsWith('First')
            ? 'https://ror.org/000000011'
            : 'https://ror.org/000000012',
          name,
        }),
      }]);
    });
    const adapter = createRorCandidateUnionAdapter({
      fetchImpl,
      paceMs: 0,
      maxProviderRequestsPerResolution: 1,
      observedOn: OBSERVED_ON,
    });
    const bounded = createInstitutionDecisionResolver({ candidateAdapter: adapter });
    const boundedDecision = await bounded.resolve({
      affiliation_string: 'First University and Second University',
    });
    expect(boundedDecision).toMatchObject({
      outcome: 'review',
      reasons: ['provider_failure'],
      selected_ror_ids: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('OpenAlex bridge runs only after one local ROR resolution and verifies the exact ROR', async () => {
    const selectedRor = 'https://ror.org/012345678';
    const institutionCandidates = jest.fn(async () => candidateSet([
      candidate({ id: selectedRor, name: 'Example University' }),
    ]));
    const openAlexService = {
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I123',
        displayName: 'Example University',
        ror: selectedRor,
        associatedInstitutions: [],
      })),
    };
    const resolver = createRorInstitutionIdentityResolver({
      candidateAdapter: { institutionCandidates, metrics: {} },
      openAlexService,
    });

    const first = await resolver.resolve('Example University');
    const second = await resolver.resolve('Example University');
    expect(first).toMatchObject({
      openAlexId: 'https://openalex.org/I123',
      ror: selectedRor,
    });
    expect(second).toBe(first);
    expect(institutionCandidates).toHaveBeenCalledTimes(1);
    expect(openAlexService.getInstitution).toHaveBeenCalledTimes(1);
    expect(openAlexService.getInstitution).toHaveBeenCalledWith(selectedRor, { signal: undefined });
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 2,
      cacheHits: 1,
      bridgeAttempts: 1,
      bridgeMismatches: 0,
      resolved: 1,
    });
  });

  test('bridge mismatch is a cached miss while provider failure remains retryable', async () => {
    const selectedRor = 'https://ror.org/012345678';
    const candidateAdapter = {
      institutionCandidates: jest.fn(async () => candidateSet([
        candidate({ id: selectedRor, name: 'Example University' }),
      ])),
      metrics: {},
    };
    const mismatchService = {
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I999',
        displayName: 'Wrong University',
        ror: 'https://ror.org/999999999',
      })),
    };
    const mismatchResolver = createRorInstitutionIdentityResolver({
      candidateAdapter,
      openAlexService: mismatchService,
    });
    await expect(mismatchResolver.resolve('Example University')).resolves.toBeNull();
    await expect(mismatchResolver.resolve('Example University')).resolves.toBeNull();
    expect(mismatchService.getInstitution).toHaveBeenCalledTimes(1);
    expect(mismatchResolver.metrics).toMatchObject({ bridgeMismatches: 1, cacheHits: 1 });

    const failingAdapter = {
      institutionCandidates: jest.fn(async () => {
        throw new Error('ROR unavailable');
      }),
      metrics: { providerFailures: 2 },
    };
    const failureResolver = createRorInstitutionIdentityResolver({
      candidateAdapter: failingAdapter,
      openAlexService: { getInstitution: jest.fn() },
    });
    await expect(failureResolver.resolve('Example University')).resolves.toBeNull();
    await expect(failureResolver.resolve('Example University')).resolves.toBeNull();
    expect(failingAdapter.institutionCandidates).toHaveBeenCalledTimes(2);
    expect(failureResolver.metrics.cacheHits).toBe(0);
    expect(failureResolver.metrics.definitiveMisses).toBe(0);
  });

  test('metrics are aggregate-only and never retain affiliation or organization names', async () => {
    const resolver = createRorInstitutionIdentityResolver({
      candidateAdapter: {
        institutionCandidates: jest.fn(async () => candidateSet([])),
        metrics: {
          cacheHits: 2,
          candidateSets: 1,
          candidatesReturned: 0,
          singleFlightHits: 3,
        },
      },
      openAlexService: { getInstitution: jest.fn() },
    });
    await resolver.resolve('Sensitive Named Institution');
    const serialized = JSON.stringify(resolver.metrics);
    expect(serialized).not.toContain('Sensitive');
    expect(serialized).not.toContain('Institution');
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 1,
      cacheHits: 2,
      decisionUnresolved: 1,
      definitiveMisses: 1,
      providerCacheHits: 2,
      providerSingleFlightHits: 3,
      resolverCacheHits: 0,
      resolverSingleFlightHits: 0,
      singleFlightHits: 3,
    });
  });
});
