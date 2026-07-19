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
} = _internals;

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
    jest.spyOn(OpenAlexService, 'searchInstitutions').mockResolvedValue([{
      openAlexId: 'https://openalex.org/I1',
      displayName: 'University of Minnesota',
      country: 'US',
    }]);
    jest.spyOn(OpenAlexService, 'getInstitution').mockResolvedValue({
      openAlexId: 'https://openalex.org/I1',
      displayName: 'University of Minnesota',
      country: 'US',
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
    expect(OpenAlexService.searchInstitutions)
      .toHaveBeenCalledWith('University of Minnesota', { signal, limit: 10 });
    expect(OpenAlexService.getInstitution)
      .toHaveBeenCalledWith('https://openalex.org/I1', { signal });
    expect(OpenAlexService.getAuthorById)
      .toHaveBeenCalledWith('A1', { signal });
  });
});
