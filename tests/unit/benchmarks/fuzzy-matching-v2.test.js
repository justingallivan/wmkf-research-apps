const {
  createCandidateSet,
  normalizeCandidate,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v2/candidate-contract');
const {
  judgePair,
  judgeResolve,
  loadCases,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v2/run');
const {
  relationshipBetween,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v2/relationship');
const {
  createRorCandidateAdapter,
} = require('../../../benchmarks/fuzzy-matching-falsification/versions/v2/adapters-ror-api');

function candidate(id, relationships = []) {
  return normalizeCandidate({
    id,
    status: 'active',
    names: [{ value: id, types: ['ror_display'], lang: null }],
    domains: [],
    locations: [],
    types: ['education'],
    relationships,
  }, { strategy: 'test', rank: 0 });
}

function set(...candidates) {
  return createCandidateSet({
    provider: 'test',
    candidates,
    provenance: {
      adapter_version: 'test/v1',
      observed_on: '2026-08-07',
      input_hash: 'a'.repeat(64),
      strategies: ['test'],
    },
  });
}

describe('falsification suite v2 candidate contract', () => {
  test('overlays all 141 institution cases without replacing the frozen base cases', () => {
    const cases = loadCases();
    expect(cases).toHaveLength(166);
    expect(cases.filter((c) => c.decision === 'institution' && c.v2)).toHaveLength(141);
    expect(cases.filter((c) => c.decision !== 'institution' && c.v2)).toHaveLength(0);
  });

  test('forbids final decision fields in candidate-set output', () => {
    const value = set(candidate('https://ror.org/03vek6s52'));
    value.candidates[0].verdict = 'resolved';
    expect(() => createCandidateSet({
      provider: value.provider,
      candidates: value.candidates,
      provenance: value.provenance,
    })).toThrow('decision field verdict');
  });

  test('judges canonical recall but records veto candidates without failing retrieval', () => {
    const expected = 'https://ror.org/0168r3w48';
    const veto = 'https://ror.org/01kbfgm16';
    const judged = judgeResolve({
      expected_ror_ids: [expected],
      must_not_ror_ids: [veto],
    }, set(candidate(expected), candidate(veto)));
    expect(judged.failures).toEqual([]);
    expect(judged.evidence.present_veto_ror_ids).toEqual([veto]);
  });

  test('keeps registry relationship separate from product consistency', () => {
    const harvard = candidate('https://ror.org/03vek6s52', [{
      id: 'https://ror.org/02jzgtq86', type: 'related', label: 'Dana-Farber',
    }]);
    const dana = candidate('https://ror.org/02jzgtq86');
    expect(relationshipBetween(harvard, dana)).toBe('related');
    const judged = judgePair({
      listed_ror_id: harvard.ror_id,
      evidence_source_ror_id: dana.ror_id,
      evidence_canonical_ror_id: dana.ror_id,
      expected_relationship: 'related',
    }, set(harvard), set(dana));
    expect(judged.failures).toEqual([]);
    expect(judged).not.toHaveProperty('consistent');
  });

  test('fails closed when the expected candidate is absent', () => {
    const judged = judgeResolve({
      expected_ror_ids: ['https://ror.org/0168r3w48'],
      must_not_ror_ids: [],
    }, set());
    expect(judged.failures).toEqual([
      'candidate recall: missing https://ror.org/0168r3w48',
    ]);
  });
});

describe('ROR API v2 candidate adapter', () => {
  function response(body, status = 200, retryAfter = null) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => retryAfter },
      json: async () => body,
    };
  }

  function bodyFor(id = 'https://ror.org/03vek6s52') {
    return {
      items: [{
        chosen: true,
        score: 0.99,
        matching_type: 'SINGLE SEARCH',
        organization: {
          id,
          status: 'active',
          names: [{ value: 'Harvard University', types: ['ror_display'], lang: 'en' }],
          domains: ['harvard.edu'],
          locations: [],
          types: ['education'],
          relationships: [],
        },
      }],
    };
  }

  test('requests API v2 single_search and keeps chosen as provenance only', async () => {
    const fetchImpl = jest.fn(async () => response(bodyFor()));
    const adapter = createRorCandidateAdapter({
      fetchImpl,
      paceMs: 0,
      sleep: async () => {},
      clientId: 'test-client-id',
    });
    const result = await adapter.institutionCandidates({ affiliation_string: 'Harvard University' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/v2/organizations?affiliation=Harvard%20University&single_search');
    expect(fetchImpl.mock.calls[0][1].headers['Client-Id']).toBe('test-client-id');
    expect(result.candidates[0].retrieval[0].provider_chosen).toBe(true);
    expect(result).not.toHaveProperty('outcome');
    expect(result.provenance).toMatchObject({ request_count: 1, retry_count: 0 });
  });

  test('rejects person/contact data at the candidate-retrieval boundary', async () => {
    const adapter = createRorCandidateAdapter({
      fetchImpl: jest.fn(),
      paceMs: 0,
      sleep: async () => {},
    });
    await expect(adapter.institutionCandidates({
      affiliation_string: 'Harvard',
      reviewer_name: 'Do not send this',
    })).rejects.toThrow('candidate input must not contain reviewer_name');
    await expect(adapter.institutionCandidates({
      affiliation_string: 'Harvard reviewer@example.edu',
    })).rejects.toThrow('must not contain an email address');
  });

  test('unions duplicate ROR ids while retaining every retrieval source', () => {
    const id = 'https://ror.org/03vek6s52';
    const first = candidate(id);
    const second = {
      ...candidate(id),
      retrieval: [{
        strategy: 'query-fallback',
        rank: 2,
        score: null,
        matching_type: null,
        provider_chosen: false,
      }],
    };
    const result = createCandidateSet({
      provider: 'test',
      candidates: [first, second],
      provenance: {
        adapter_version: 'test/v1',
        observed_on: '2026-08-07',
        input_hash: 'b'.repeat(64),
        strategies: ['affiliation-single-search', 'query-fallback'],
      },
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].retrieval.map((source) => source.strategy))
      .toEqual(['test', 'query-fallback']);
  });

  test('single-flights only calls sharing the same AbortSignal and then caches settled results', async () => {
    const fetchImpl = jest.fn(async () => response(bodyFor()));
    const adapter = createRorCandidateAdapter({ fetchImpl, paceMs: 0, sleep: async () => {} });
    const controller = new AbortController();
    const [first, second] = await Promise.all([
      adapter.institutionCandidates({ affiliation_string: 'Harvard', signal: controller.signal }),
      adapter.institutionCandidates({ affiliation_string: 'Harvard', signal: controller.signal }),
    ]);
    const third = await adapter.institutionCandidates({ affiliation_string: 'Harvard' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([first.provenance.single_flight_hit, second.provenance.single_flight_hit].sort())
      .toEqual([false, true]);
    expect(third.provenance).toMatchObject({ cache_hit: true, request_count: 0 });
  });

  test('counts retry attempts and does not convert exhausted failures into an empty set', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(bodyFor()));
    const adapter = createRorCandidateAdapter({
      fetchImpl,
      paceMs: 0,
      backoffBaseMs: 0,
      sleep: async () => {},
    });
    const result = await adapter.institutionCandidates({ affiliation_string: 'Harvard' });
    expect(result.provenance).toMatchObject({ request_count: 2, retry_count: 1 });

    const failing = createRorCandidateAdapter({
      fetchImpl: async () => response({}, 503),
      paceMs: 0,
      backoffBaseMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
    });
    await expect(failing.institutionCandidates({ affiliation_string: 'Harvard' }))
      .rejects.toThrow('ROR 503');
  });

  test('treats a malformed successful response as an error, not a clean miss', async () => {
    const adapter = createRorCandidateAdapter({
      fetchImpl: async () => response({ unexpected: [] }),
      paceMs: 0,
      sleep: async () => {},
    });
    await expect(adapter.institutionCandidates({ affiliation_string: 'Harvard' }))
      .rejects.toThrow('ROR malformed response');
  });
});
