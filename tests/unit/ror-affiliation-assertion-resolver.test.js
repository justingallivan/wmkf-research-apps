const {
  candidateInputHash,
  createCandidateSet,
} = require('../../lib/services/ror-institution-candidate-contract');
const {
  createRorAffiliationAssertionResolver,
} = require('../../lib/services/ror-affiliation-assertion-resolver');

const IDS = {
  parent: 'https://ror.org/000000001',
  child: 'https://ror.org/000000002',
  extra: 'https://ror.org/000000003',
};

function candidate(rorId, name, relationships = []) {
  return {
    ror_id: rorId,
    status: 'active',
    display_name: name,
    names: [{ value: name, types: ['ror_display'], lang: 'en' }],
    domains: [],
    locations: [],
    types: ['education'],
    relationships: relationships.map((relationship) => ({
      ror_id: relationship.rorId,
      type: relationship.type,
      label: null,
    })),
    retrieval: [{
      strategy: 'fixture',
      rank: 0,
      score: null,
      matching_type: null,
      provider_chosen: false,
    }],
  };
}

function candidateSet(input, candidates) {
  return createCandidateSet({
    provider: 'fixture-ror',
    candidates,
    provenance: {
      api_version: 'fixture',
      adapter_version: 'fixture/v1',
      observed_on: '2026-08-19',
      input_hash: candidateInputHash(input),
      strategies: ['fixture'],
      request_count: 0,
      retry_count: 0,
      cache_hit: true,
      single_flight_hit: false,
    },
  });
}

test('resolves explicit segments independently and preserves partial success', async () => {
  const adapter = {
    beginResolution: jest.fn(() => ({ scope: true })),
    institutionCandidates: jest.fn(async (input) => {
      if (input.affiliation_string === 'Provider failure institute') throw new Error('down');
      return candidateSet(input, [
        candidate(IDS.child, input.affiliation_string, [{ type: 'parent', rorId: IDS.parent }]),
      ]);
    }),
  };
  const resolver = createRorAffiliationAssertionResolver({ candidateAdapter: adapter });
  const result = await resolver.resolve({
    rawText: 'Child University; Provider failure institute',
    segments: [
      { rawText: 'Child University' },
      { rawText: 'Provider failure institute' },
    ],
  });

  expect(result.resolutionSummary).toMatchObject({ resolvedSegments: 1, unresolvedSegments: 1 });
  expect(result.segments[0].resolution).toMatchObject({
    status: 'resolved',
    sourceRorId: IDS.child,
    canonicalRorId: IDS.child,
    relationships: [{ type: 'parent', rorId: IDS.parent }],
  });
  expect(result.segments[1].resolution).toMatchObject({
    status: 'unresolved',
    reason: 'provider_failure',
  });
  expect(adapter.beginResolution).toHaveBeenCalledTimes(1);
});

test('provider failure does not become distinct or discard the other segment', async () => {
  const adapter = {
    institutionCandidates: jest.fn(async (input) => {
      if (input.affiliation_string === 'Unknown institute') throw new Error('timeout');
      return candidateSet(input, [candidate(IDS.extra, 'Known institute')]);
    }),
  };
  const resolver = createRorAffiliationAssertionResolver({ candidateAdapter: adapter });
  const result = await resolver.resolve({
    rawText: 'Known institute; Unknown institute',
    segments: [{ rawText: 'Known institute' }, { rawText: 'Unknown institute' }],
  });
  expect(result.segments.map((segment) => segment.resolution.status)).toEqual(['resolved', 'unresolved']);
});

test('abort propagates instead of being converted to provider failure', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const adapter = {
    institutionCandidates: jest.fn(async () => {
      throw new Error('cancelled');
    }),
  };
  const resolver = createRorAffiliationAssertionResolver({ candidateAdapter: adapter });
  await expect(resolver.resolve({ rawText: 'Child University' }, { signal: controller.signal }))
    .rejects.toThrow('cancelled');
});
