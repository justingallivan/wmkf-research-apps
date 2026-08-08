/**
 * @jest-environment node
 */

jest.mock('../../lib/services/reviewer-identity-shadow-log', () => ({
  recordShadowComparison: jest.fn(),
  recordShadowError: jest.fn(),
}));

const { OpenAlexService } = require('../../lib/services/openalex-service');
const {
  recordShadowComparison,
  recordShadowError,
} = require('../../lib/services/reviewer-identity-shadow-log');
const {
  RESOLVER_MODE,
  _internals,
} = require('../../lib/services/reviewer-identity-runtime');

const {
  configuredResolverMode,
  evaluateCombinedAgainstLegacy,
  evaluateExistingResultWithRuntimeSeam,
  evaluateSuggestionsWithRuntimeSeam,
  evaluateWithRuntimeSeam,
  evaluateWorksFirstSuggestion,
  normalizeResolverMode,
  reportInstitutionResolverMetrics,
} = _internals;

function rorAffiliationResponse({
  id = 'https://ror.org/017zqws13',
  name = 'University of Minnesota',
} = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      items: [{
        chosen: true,
        matching_type: 'SINGLE SEARCH',
        score: 1,
        organization: {
          id,
          status: 'active',
          names: [{ value: name, types: ['ror_display'], lang: 'en' }],
          domains: ['umn.edu'],
          locations: [{
            geonames_details: {
              country_code: 'US',
              country_subdivision_code: 'MN',
              name: 'Minneapolis',
            },
          }],
          types: ['education'],
          relationships: [],
        },
      }],
    }),
  };
}

describe('reviewer identity runtime seam', () => {
  const suggestion = {
    name: 'Will Harcombe',
    suggestedInstitution: 'University of Minnesota',
    expertiseAreas: ['microbial ecology'],
  };
  const legacyResult = {
    status: 'probable',
    orcid: '0000-0001-8445-2052',
    selectedRecord: { openAlexId: 'https://openalex.org/A1' },
  };

  afterEach(() => {
    jest.restoreAllMocks();
    recordShadowComparison.mockReset();
    recordShadowError.mockReset();
  });

  test('defaults to legacy and never starts W2', async () => {
    const evaluateLegacy = jest.fn(async () => legacyResult);
    const evaluateWorksFirst = jest.fn(async () => ({
      decision: 'bind',
      anchor: 'orcid:0000-0001-8445-2052',
    }));

    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: undefined,
      evaluateLegacy,
      evaluateWorksFirst,
    });

    expect(result).toBe(legacyResult);
    expect(evaluateLegacy).toHaveBeenCalledTimes(1);
    expect(evaluateWorksFirst).not.toHaveBeenCalled();
  });

  test.each(['w2', 'cutover', 'enabled', 'garbage'])(
    'unknown/authoritative-looking mode %s fails back to legacy',
    async (mode) => {
      const evaluateLegacy = jest.fn(async () => legacyResult);
      const evaluateWorksFirst = jest.fn();
      const result = await evaluateWithRuntimeSeam(suggestion, {}, {
        mode,
        evaluateLegacy,
        evaluateWorksFirst,
      });
      expect(result).toBe(legacyResult);
      expect(evaluateWorksFirst).not.toHaveBeenCalled();
    },
  );

  test('shadow runs both arms but returns the exact legacy object', async () => {
    const onShadowComparison = jest.fn();
    const callOrder = [];
    const callerSignal = new AbortController().signal;
    let shadowSignal;
    const options = { signal: callerSignal, proposalInfo: { title: 'Microbes' } };
    const result = await evaluateWithRuntimeSeam(suggestion, options, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async (_candidate, receivedOptions) => {
        callOrder.push('legacy');
        expect(receivedOptions).toBe(options);
        return legacyResult;
      }),
      evaluateWorksFirst: jest.fn(async (_candidate, receivedOptions) => {
        callOrder.push('shadow');
        expect(receivedOptions).not.toBe(options);
        shadowSignal = receivedOptions.signal;
        expect(shadowSignal).not.toBe(callerSignal);
        expect(receivedOptions.proposalInfo).toBe(options.proposalInfo);
        return {
          decision: 'bind',
          anchor: 'orcid:0000-0001-8445-2052',
          reason: 'unique_orcid_institution_cluster',
        };
      }),
      onShadowComparison,
    });

    expect(result).toBe(legacyResult);
    expect(callOrder).toEqual(['legacy', 'shadow']);
    expect(onShadowComparison).toHaveBeenCalledWith(expect.objectContaining({
      candidateKey: expect.stringMatching(/^[a-f0-9]{16}$/),
      legacyDecision: 'bind',
      worksDecision: 'bind',
      combinedDecision: 'bind',
      combinedReason: 'spine_works_consensus',
      anchorsAgree: true,
    }));
    const serialized = JSON.stringify(onShadowComparison.mock.calls[0][0]);
    expect(serialized).not.toContain('Will Harcombe');
    expect(serialized).not.toContain('0000-0001-8445-2052');
  });

  test('shadow failure is reported without changing the legacy result', async () => {
    const onShadowError = jest.fn();
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
      onShadowError,
    });

    expect(result).toBe(legacyResult);
    expect(onShadowError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'provider unavailable',
    }));
  });

  test('default shadow errors retain run, mode, and candidate attribution', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
    });

    expect(result).toBe(legacyResult);
    expect(recordShadowError).toHaveBeenCalledWith(expect.objectContaining({
      runId: expect.any(String),
      resolverMode: RESOLVER_MODE.SHADOW,
      candidateKey: expect.stringMatching(/^[a-f0-9]{16}$/),
      errorCode: 'Error',
    }));
  });

  test('legacy failure preserves the pre-seam rejection contract', async () => {
    const error = new Error('legacy failed');
    const evaluateWorksFirst = jest.fn();
    await expect(evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => {
        throw error;
      }),
      evaluateWorksFirst,
    })).rejects.toBe(error);
    expect(evaluateWorksFirst).not.toHaveBeenCalled();
  });

  test('shadow canonicalizes OpenAlex and ORCID anchors before comparing them', async () => {
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue({
      orcid: '0000-0001-8445-2052',
    });
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => ({
        status: 'probable',
        orcid: null,
        selectedRecord: { openAlexId: 'https://openalex.org/A1' },
      })),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      onShadowComparison: (comparison) => {
        expect(comparison).toMatchObject({
          anchorsAgree: true,
          combinedDecision: 'bind',
          combinedReason: 'spine_works_consensus',
        });
      },
    });

    expect(result.selectedRecord.openAlexId).toBe('https://openalex.org/A1');
    expect(OpenAlexService.getAuthorById).toHaveBeenCalledWith(
      'A1',
      { signal: expect.any(AbortSignal) },
    );
  });

  test('shadow links an exact sparse author fragment through matched byline ORCID evidence', async () => {
    const onShadowComparison = jest.fn();
    await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => ({
        status: 'probable',
        orcid: null,
        selectedRecord: { openAlexId: 'https://openalex.org/A5121975749' },
      })),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0002-7356-4814',
        candidates: [{
          authorId: 'A5121975749',
          orcids: ['0000-0002-7356-4814'],
        }],
      })),
      createAnchorsMatch: () => async () => false,
      onShadowComparison,
    });

    expect(onShadowComparison).toHaveBeenCalledWith(expect.objectContaining({
      anchorsAgree: true,
      combinedDecision: 'bind',
      combinedReason: 'spine_works_consensus',
    }));
  });

  test('batch seam settles every legacy candidate before any shadow traffic', async () => {
    const candidates = [
      { ...suggestion, name: 'First Candidate' },
      { ...suggestion, name: 'Second Candidate' },
    ];
    const callOrder = [];
    const results = await evaluateSuggestionsWithRuntimeSeam(candidates, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async (candidate) => {
        callOrder.push(`legacy:${candidate.name}`);
        return { ...legacyResult, candidate: candidate.name };
      }),
      evaluateWorksFirst: jest.fn(async (candidate) => {
        callOrder.push(`shadow:${candidate.name}`);
        return {
          decision: 'bind',
          anchor: 'orcid:0000-0001-8445-2052',
        };
      }),
    });

    expect(results.map((result) => result.candidate)).toEqual([
      'First Candidate',
      'Second Candidate',
    ]);
    expect(callOrder).toEqual([
      'legacy:First Candidate',
      'legacy:Second Candidate',
      'shadow:First Candidate',
      'shadow:Second Candidate',
    ]);
  });

  test('hard shadow deadline returns legacy even when W2 never settles', async () => {
    let receivedSignal;
    const onShadowError = jest.fn();
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async (_candidate, options) => {
        receivedSignal = options.signal;
        return new Promise(() => {});
      }),
      shadowTimeoutMs: 5,
      onShadowError,
    });

    expect(result).toBe(legacyResult);
    expect(receivedSignal.aborted).toBe(true);
    expect(onShadowError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'reviewer_identity_shadow_timeout',
    }));
  });

  test('throwing shadow observers cannot change the legacy result', async () => {
    const onShadowError = jest.fn(() => {
      throw new Error('error observer failed');
    });
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      onShadowComparison: () => {
        throw new Error('comparison observer failed');
      },
      onShadowError,
    });
    expect(result).toBe(legacyResult);
    expect(onShadowError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'comparison observer failed',
    }));

    const resolverFailure = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => {
        throw new Error('shadow failed');
      }),
      onShadowError,
    });
    expect(resolverFailure).toBe(legacyResult);
  });

  test('batch default observers share one durable run id per batch', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const candidates = [
      { ...suggestion, name: 'First Candidate' },
      { ...suggestion, name: 'Second Candidate' },
    ];
    const results = await evaluateSuggestionsWithRuntimeSeam(candidates, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
    });

    expect(results).toHaveLength(2);
    expect(recordShadowComparison).toHaveBeenCalledTimes(2);
    const [first, second] = recordShadowComparison.mock.calls.map(([entry]) => entry);
    expect(first.runId).toEqual(expect.any(String));
    expect(first.runId).toBe(second.runId);
    expect(first.candidateKey).not.toBe(second.candidateKey);
  });

  test('request-local comparison observer receives names while durable telemetry stays pseudonymous', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const onComparisonObserved = jest.fn();

    const results = await evaluateSuggestionsWithRuntimeSeam([suggestion], {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
      onComparisonObserved,
    });

    expect(results).toEqual([legacyResult]);
    expect(onComparisonObserved).toHaveBeenCalledWith(expect.objectContaining({
      runId: expect.any(String),
      resolverMode: RESOLVER_MODE.SHADOW,
      reviewerName: 'Will Harcombe',
      claimedInstitution: 'University of Minnesota',
      legacyDecision: 'bind',
      worksDecision: 'bind',
      combinedDecision: 'bind',
    }));

    const durableEntry = recordShadowComparison.mock.calls[0][0];
    expect(durableEntry).not.toHaveProperty('reviewerName');
    expect(durableEntry).not.toHaveProperty('claimedInstitution');
    expect(JSON.stringify(durableEntry)).not.toContain('Harcombe');
    expect(JSON.stringify(durableEntry)).not.toContain('Minnesota');
    const runtimeLog = info.mock.calls.find(
      ([message]) => message === '[reviewer-identity-runtime] shadow comparison',
    );
    expect(JSON.stringify(runtimeLog)).not.toContain('Harcombe');
    expect(JSON.stringify(runtimeLog)).not.toContain('Minnesota');
  });

  test('request-local comparison observer failure cannot change the legacy result', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const results = await evaluateSuggestionsWithRuntimeSeam([suggestion], {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
      onComparisonObserved: () => { throw new Error('admin panel unavailable'); },
    });

    expect(results).toEqual([legacyResult]);
    expect(recordShadowComparison).toHaveBeenCalledTimes(1);
  });

  test('batch default W2 resolver reuses institutions and emits data-minimized metrics', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const candidates = [suggestion, { ...suggestion }];
    jest.spyOn(global, 'fetch').mockResolvedValue(rorAffiliationResponse());
    jest.spyOn(OpenAlexService, 'searchWorksByRawAuthorName').mockResolvedValue({
      totalCount: 1,
      records: [{
        authorships: [{
          openAlexAuthorId: 'https://openalex.org/A1',
          displayName: 'William Harcombe',
          orcid: '0000-0001-8445-2052',
          raw: {
            raw_author_name: 'Will Harcombe',
            institutions: [{ id: 'https://openalex.org/I1' }],
          },
        }],
      }],
    });
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue({
      openAlexId: 'https://openalex.org/I1',
      displayName: 'University of Minnesota',
      country: 'US',
      ror: 'https://ror.org/017zqws13',
      associatedInstitutions: [],
    });
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue({
      openAlexId: 'https://openalex.org/A1',
      displayName: 'William Harcombe',
      orcid: '0000-0001-8445-2052',
      lastKnownInstitutionId: 'https://openalex.org/I1',
      worksCount: 100,
    });

    const results = await evaluateSuggestionsWithRuntimeSeam(candidates, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      createAnchorsMatch: () => async () => true,
      onShadowComparison: jest.fn(),
    });

    expect(results).toEqual([legacyResult, legacyResult]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('&single_search');
    expect(OpenAlexService.getInstitution).toHaveBeenCalledTimes(1);
    const metricsCall = info.mock.calls.find(
      ([message]) => message === '[reviewer-identity-runtime] institution resolver metrics',
    );
    expect(metricsCall).toBeDefined();
    expect(metricsCall[1]).toMatchObject({
      runId: expect.any(String),
      resolverMode: RESOLVER_MODE.SHADOW,
      candidateCount: 2,
      batchDurationMs: expect.any(Number),
      resolveCalls: 2,
      cacheHits: 1,
      singleFlightHits: 0,
      providerSearches: 1,
      providerHydrations: 1,
      providerRequests: 1,
      resolved: 1,
      definitiveMisses: 0,
      providerFailures: 0,
      cacheSize: 1,
      inFlightSize: 0,
    });
    const serialized = JSON.stringify(metricsCall[1]);
    expect(serialized).not.toContain('Harcombe');
    expect(serialized).not.toContain('Minnesota');
    expect(serialized).not.toContain('0000-0001-8445-2052');
  });

  test('combined batches share the W2 resolver, adapt rescues, and isolate per-row fallback', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const candidates = [suggestion, { ...suggestion }];
    jest.spyOn(global, 'fetch').mockResolvedValue(rorAffiliationResponse());
    const firstLegacy = { status: 'abstain', reason: 'first-legacy-safe-result' };
    const secondLegacy = { status: 'abstain', reason: 'second-legacy-safe-result' };
    jest.spyOn(OpenAlexService, 'searchWorksByRawAuthorName').mockResolvedValue({
      totalCount: 3,
      records: ['one', 'two', 'three'].map((suffix) => ({
        doi: `https://doi.org/10.1000/harcombe-${suffix}`,
        authorships: [{
          openAlexAuthorId: 'https://openalex.org/A1',
          displayName: 'William Harcombe',
          orcid: '0000-0001-8445-2052',
          raw: {
            raw_author_name: 'Will Harcombe',
            institutions: [{ id: 'https://openalex.org/I1' }],
          },
        }],
      })),
    });
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue({
      openAlexId: 'https://openalex.org/I1',
      displayName: 'University of Minnesota',
      country: 'US',
      ror: 'https://ror.org/017zqws13',
      associatedInstitutions: [],
    });
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue({
      openAlexId: 'https://openalex.org/A1',
      displayName: 'William Harcombe',
      orcid: '0000-0001-8445-2052',
      lastKnownInstitutionId: 'https://openalex.org/I1',
      worksCount: 100,
    });
    const getAuthorByOrcid = jest.fn()
      .mockResolvedValueOnce({
        openAlexId: 'https://openalex.org/A1',
        displayName: 'Will Harcombe',
        orcid: '0000-0001-8445-2052',
        lastKnownInstitution: 'University of Minnesota',
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    const results = await evaluateSuggestionsWithRuntimeSeam(candidates, {}, {
      mode: RESOLVER_MODE.COMBINED,
      shadowTimeoutMs: 10,
      evaluateLegacy: jest.fn()
        .mockResolvedValueOnce(firstLegacy)
        .mockResolvedValueOnce(secondLegacy),
      createAnchorsMatch: () => async () => false,
      getAuthorByOrcid,
      onShadowComparison: jest.fn(),
      onShadowError: jest.fn(),
    });

    expect(results[0]).toMatchObject({
      status: 'probable',
      orcid: '0000-0001-8445-2052',
      selectedRecord: { openAlexId: 'https://openalex.org/A1' },
    });
    expect(results[1]).toBe(secondLegacy);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(OpenAlexService.getInstitution).toHaveBeenCalledTimes(1);
    const metricsCall = info.mock.calls.find(
      ([message]) => message === '[reviewer-identity-runtime] institution resolver metrics',
    );
    expect(metricsCall?.[1]).toMatchObject({
      resolverMode: RESOLVER_MODE.COMBINED,
      candidateCount: 2,
      resolveCalls: 2,
      cacheHits: 1,
      providerSearches: 1,
    });
  });

  test('institution resolver measurement logging and metric access are failure-isolated', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('logging unavailable');
    });
    expect(() => reportInstitutionResolverMetrics({
      institutionResolver: { metrics: { resolveCalls: 1 } },
    })).not.toThrow();

    const throwingResolver = {
      get metrics() {
        throw new Error('metrics unavailable');
      },
    };
    const result = await evaluateSuggestionsWithRuntimeSeam([suggestion], {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
      onShadowComparison: jest.fn(),
      institutionResolver: throwingResolver,
    });
    expect(result).toEqual([legacyResult]);
  });

  test('institution resolver metrics use an explicit PII-free field allowlist', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    reportInstitutionResolverMetrics({
      institutionResolver: {
        metrics: {
          resolveCalls: 1,
          rawQuery: 'University of Minnesota',
          candidateName: 'Will Harcombe',
        },
      },
      runId: 'Will Harcombe | University of Minnesota',
      resolverMode: RESOLVER_MODE.SHADOW,
      candidateCount: 1,
      batchDurationMs: 2,
    });

    const entry = info.mock.calls[0][1];
    expect(entry).toMatchObject({
      runId: null,
      resolveCalls: 1,
      candidateCount: 1,
      batchDurationMs: 2,
    });
    expect(entry).not.toHaveProperty('rawQuery');
    expect(entry).not.toHaveProperty('candidateName');
    expect(JSON.stringify(entry)).not.toContain('Minnesota');
    expect(JSON.stringify(entry)).not.toContain('Harcombe');
  });

  test('a throwing durable logger cannot change the legacy result', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    recordShadowComparison.mockImplementation(() => {
      throw new Error('durable logger exploded');
    });
    const result = await evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
    });
    expect(result).toBe(legacyResult);
    expect(recordShadowError).toHaveBeenCalled();
  });

  test('default observer settles its durable insert before returning', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    let releaseInsert;
    recordShadowComparison.mockImplementation(() => new Promise((resolve) => {
      releaseInsert = resolve;
    }));
    let settled = false;
    const pending = evaluateWithRuntimeSeam(suggestion, {}, {
      mode: RESOLVER_MODE.SHADOW,
      evaluateLegacy: jest.fn(async () => legacyResult),
      evaluateWorksFirst: jest.fn(async () => ({
        decision: 'bind',
        anchor: 'orcid:0000-0001-8445-2052',
      })),
      createAnchorsMatch: () => async () => true,
    }).then((value) => {
      settled = true;
      return value;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    releaseInsert('inserted');
    await expect(pending).resolves.toBe(legacyResult);
  });

  test('combined mode adapts only a W2 rescue and retains legacy on provider failure', async () => {
    const worksResult = {
      decision: 'bind',
      anchor: 'orcid:0000-0003-2195-6258',
      evidenceBundle: {
        orcids: ['0000-0003-2195-6258'],
        anchorDois: ['10.1000/one', '10.1000/two', '10.1000/three'],
        rors: ['https://ror.org/05a0ya142'],
        openAlexAuthorIds: ['A100'],
      },
      candidates: [{
        authorId: 'A100',
        orcids: ['0000-0003-2195-6258'],
      }],
    };
    const rescued = await evaluateCombinedAgainstLegacy(
      { name: 'Taekjip Ha', suggestedInstitution: 'Johns Hopkins University' },
      {},
      { status: 'abstain' },
      {
        evaluateWorksFirst: jest.fn(async () => worksResult),
        createAnchorsMatch: () => async () => false,
        onShadowComparison: jest.fn(),
        getAuthorByOrcid: jest.fn(async () => ({
          openAlexId: 'https://openalex.org/A100',
          displayName: 'Taekjip Ha',
          orcid: '0000-0003-2195-6258',
          lastKnownInstitution: 'Boston Children’s Hospital',
        })),
      },
    );
    expect(rescued).toMatchObject({
      status: 'probable',
      orcid: '0000-0003-2195-6258',
      selectedRecord: {
        lastKnownInstitution: 'Boston Children’s Hospital',
      },
    });

    const legacy = { status: 'abstain', reason: 'legacy-safe-result' };
    const failed = await evaluateCombinedAgainstLegacy(suggestion, {}, legacy, {
      evaluateWorksFirst: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
      onShadowError: jest.fn(),
    });
    expect(failed).toBe(legacy);
  });

  test('combined mode retains the exact legacy result when profile hydration exceeds its deadline', async () => {
    const legacy = { status: 'abstain', reason: 'legacy-safe-result' };
    const onShadowError = jest.fn();
    const result = await evaluateCombinedAgainstLegacy(
      { name: 'Taekjip Ha', suggestedInstitution: 'Johns Hopkins University' },
      {},
      legacy,
      {
        shadowTimeoutMs: 5,
        evaluateWorksFirst: jest.fn(async () => ({
          decision: 'bind',
          anchor: 'orcid:0000-0003-2195-6258',
          evidenceBundle: {
            orcids: ['0000-0003-2195-6258'],
            anchorDois: ['10.1000/one'],
            rors: [],
            openAlexAuthorIds: ['A100'],
          },
        })),
        createAnchorsMatch: () => async () => false,
        onShadowComparison: jest.fn(),
        onShadowError,
        getAuthorByOrcid: jest.fn(() => new Promise(() => {})),
      },
    );

    expect(result).toBe(legacy);
    expect(onShadowError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'reviewer_identity_shadow_timeout',
    }));
  });

  test('default combined hydration errors retain candidate attribution', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    recordShadowComparison.mockResolvedValue('inserted');
    recordShadowError.mockResolvedValue('inserted');
    const legacy = { status: 'abstain', reason: 'legacy-safe-result' };
    const result = await evaluateCombinedAgainstLegacy(
      suggestion,
      {},
      legacy,
      {
        runId: 'combined-run',
        shadowTimeoutMs: 5,
        evaluateWorksFirst: jest.fn(async () => ({
          decision: 'bind',
          anchor: 'orcid:0000-0003-2195-6258',
          evidenceBundle: {
            orcids: ['0000-0003-2195-6258'],
            anchorDois: ['10.1000/one'],
            rors: [],
            openAlexAuthorIds: ['A100'],
          },
        })),
        createAnchorsMatch: () => async () => false,
        getAuthorByOrcid: jest.fn(() => new Promise(() => {})),
      },
    );

    expect(result).toBe(legacy);
    expect(recordShadowError).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'combined-run',
      resolverMode: RESOLVER_MODE.COMBINED,
      candidateKey: expect.stringMatching(/^[a-f0-9]{16}$/),
      errorCode: 'reviewer_identity_shadow_timeout',
    }));
  });

  test('existing enrichment decisions are pass-through unless combined is explicit', async () => {
    const legacy = { status: 'unresolved', identity: { status: 'unresolved' } };
    const evaluateWorksFirst = jest.fn();
    await expect(evaluateExistingResultWithRuntimeSeam(
      suggestion,
      legacy,
      {},
      { mode: RESOLVER_MODE.SHADOW, evaluateWorksFirst },
    )).resolves.toBe(legacy);
    expect(evaluateWorksFirst).not.toHaveBeenCalled();
  });

  test('only explicit supported modes are opt-in; unset and unknown configuration are legacy', () => {
    expect(configuredResolverMode({})).toBe(RESOLVER_MODE.LEGACY);
    expect(configuredResolverMode({ REVIEWER_IDENTITY_RESOLVER_MODE: 'shadow' }))
      .toBe(RESOLVER_MODE.SHADOW);
    expect(configuredResolverMode({ REVIEWER_IDENTITY_RESOLVER_MODE: 'combined' }))
      .toBe(RESOLVER_MODE.COMBINED);
    expect(configuredResolverMode({ REVIEWER_IDENTITY_RESOLVER_MODE: 'W2' }))
      .toBe(RESOLVER_MODE.LEGACY);
    expect(normalizeResolverMode(' SHADOW ')).toBe(RESOLVER_MODE.SHADOW);
    expect(Object.values(RESOLVER_MODE)).toEqual(['legacy', 'shadow', 'combined']);
  });

  test('runtime W2 adapter resolves mapped OpenAlex authorships', async () => {
    const signal = new AbortController().signal;
    jest.spyOn(global, 'fetch').mockResolvedValue(rorAffiliationResponse());
    jest.spyOn(OpenAlexService, 'searchWorksByRawAuthorName').mockResolvedValue({
      totalCount: 1,
      records: [{
        authorships: [{
          openAlexAuthorId: 'https://openalex.org/A1',
          displayName: 'William Harcombe',
          orcid: '0000-0001-8445-2052',
          raw: {
            raw_author_name: 'Will Harcombe',
            institutions: [{ id: 'https://openalex.org/I1' }],
          },
        }],
      }],
    });
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue({
      openAlexId: 'https://openalex.org/I1',
      displayName: 'University of Minnesota',
      country: 'US',
      ror: 'https://ror.org/017zqws13',
      associatedInstitutions: [],
    });
    jest.spyOn(OpenAlexService, 'getAuthorById').mockResolvedValue({
      openAlexId: 'https://openalex.org/A1',
      displayName: 'William Harcombe',
      orcid: '0000-0001-8445-2052',
      lastKnownInstitutionId: 'https://openalex.org/I1',
      worksCount: 100,
    });

    const result = await evaluateWorksFirstSuggestion(suggestion, { signal });

    expect(result).toMatchObject({
      decision: 'bind',
      anchor: 'orcid:0000-0001-8445-2052',
      reason: 'unique_orcid_institution_cluster',
    });
    expect(OpenAlexService.searchWorksByRawAuthorName)
      .toHaveBeenCalledWith('Will Harcombe', { signal, limit: 50 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('&single_search');
    expect(OpenAlexService.getInstitution)
      .toHaveBeenCalledWith('https://ror.org/017zqws13', { signal });
    expect(OpenAlexService.getAuthorById)
      .toHaveBeenCalledWith('A1', { signal });
  });
});
