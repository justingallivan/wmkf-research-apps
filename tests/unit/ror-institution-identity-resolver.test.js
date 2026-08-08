/**
 * @jest-environment node
 */

const {
  createRorInstitutionIdentityResolver,
} = require('../../lib/services/institution-resolution/ror-institution-identity-resolver');

const ROR = 'https://ror.org/017zqws13';

function resolvedDecision(selectedRorIds = [ROR]) {
  return {
    outcome: 'resolved',
    selected_ror_ids: selectedRorIds,
    reasons: ['unique_scored_candidate'],
  };
}

function reviewDecision(reason = 'insufficient_evidence') {
  return {
    outcome: 'review',
    selected_ror_ids: [],
    reasons: [reason],
  };
}

function createResolver({ decisionResolver, openAlexService, adapterMetrics = {} }) {
  return createRorInstitutionIdentityResolver({
    candidateAdapter: {
      metrics: adapterMetrics,
      institutionCandidates: jest.fn(),
    },
    decisionResolver,
    openAlexService,
  });
}

describe('ROR institution identity resolver', () => {
  test('hydrates exactly one ROR-selected institution through OpenAlex', async () => {
    const decisionResolver = { resolve: jest.fn(async () => resolvedDecision()) };
    const openAlexService = {
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I130238516',
        ror: ROR,
        displayName: 'University of Minnesota Twin Cities',
        country: 'US',
        associatedInstitutions: [{
          openAlexId: 'https://openalex.org/I1',
          ror: 'https://ror.org/012345678',
          displayName: 'University of Minnesota System',
          country: 'US',
          relationship: 'parent',
        }],
      })),
    };
    const resolver = createResolver({ decisionResolver, openAlexService });
    const signal = new AbortController().signal;

    const identity = await resolver.resolve('University of Minnesota', {
      countryCode: 'us',
      domainEvidence: 'umn.edu',
      signal,
    });

    expect(decisionResolver.resolve).toHaveBeenCalledWith({
      affiliation_string: 'University of Minnesota',
      country_code: 'US',
      domain_evidence: 'umn.edu',
      signal,
    });
    expect(openAlexService.getInstitution).toHaveBeenCalledWith(ROR, {
      signal,
      requestScope: undefined,
    });
    expect(identity).toMatchObject({
      openAlexId: 'https://openalex.org/I130238516',
      ror: ROR,
      displayName: 'University of Minnesota Twin Cities',
      country: 'US',
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.associatedInstitutions)).toBe(true);
  });

  test.each([
    ['review', reviewDecision()],
    ['unresolved', { outcome: 'unresolved', selected_ror_ids: [], reasons: ['no_candidates'] }],
    ['multi-organization', resolvedDecision([ROR, 'https://ror.org/05a0ya142'])],
  ])('%s decisions stay unresolved and never hydrate OpenAlex', async (_label, decision) => {
    const openAlexService = { getInstitution: jest.fn() };
    const resolver = createResolver({
      decisionResolver: { resolve: jest.fn(async () => decision) },
      openAlexService,
    });

    await expect(resolver.resolve('Ambiguous Organization')).resolves.toBeNull();
    expect(openAlexService.getInstitution).not.toHaveBeenCalled();
    expect(resolver.metrics.definitiveMisses).toBe(1);
  });

  test('rejects selected and hydrated values that only end with a ROR-like suffix', async () => {
    const selectedOpenAlexService = { getInstitution: jest.fn() };
    const malformedSelection = createResolver({
      decisionResolver: {
        resolve: jest.fn(async () => resolvedDecision(['https://evil.example/017zqws13'])),
      },
      openAlexService: selectedOpenAlexService,
    });
    await expect(malformedSelection.resolve('University of Minnesota')).resolves.toBeNull();
    expect(selectedOpenAlexService.getInstitution).not.toHaveBeenCalled();

    const malformedHydration = createResolver({
      decisionResolver: { resolve: jest.fn(async () => resolvedDecision()) },
      openAlexService: {
        getInstitution: jest.fn(async () => ({
          openAlexId: 'https://openalex.org/I130238516',
          ror: 'garbage017zqws13',
          displayName: 'University of Minnesota Twin Cities',
        })),
      },
    });
    await expect(malformedHydration.resolve('University of Minnesota')).resolves.toBeNull();
    expect(malformedHydration.metrics).toMatchObject({
      definitiveMisses: 1,
      resolved: 0,
    });
  });

  test('ROR provider failures do not poison the settled request cache', async () => {
    const decisionResolver = {
      resolve: jest.fn()
        .mockResolvedValueOnce(reviewDecision('provider_failure'))
        .mockResolvedValueOnce(resolvedDecision()),
    };
    const openAlexService = {
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I130238516',
        ror: ROR,
        displayName: 'University of Minnesota Twin Cities',
      })),
    };
    const resolver = createResolver({ decisionResolver, openAlexService });

    await expect(resolver.resolve('University of Minnesota')).resolves.toBeNull();
    await expect(resolver.resolve('University of Minnesota')).resolves.toMatchObject({ ror: ROR });
    expect(decisionResolver.resolve).toHaveBeenCalledTimes(2);
    expect(openAlexService.getInstitution).toHaveBeenCalledTimes(1);
  });

  test('OpenAlex failure does not cache, but a null or mismatched hydration does', async () => {
    const decisionResolver = { resolve: jest.fn(async () => resolvedDecision()) };
    const openAlexService = {
      getInstitution: jest.fn()
        .mockRejectedValueOnce(new Error('openalex unavailable'))
        .mockResolvedValueOnce({
          openAlexId: 'https://openalex.org/I2',
          ror: 'https://ror.org/05a0ya142',
          displayName: 'Wrong Institution',
        }),
    };
    const resolver = createResolver({ decisionResolver, openAlexService });

    await expect(resolver.resolve('University of Minnesota')).resolves.toBeNull();
    await expect(resolver.resolve('University of Minnesota')).resolves.toBeNull();
    await expect(resolver.resolve('University of Minnesota')).resolves.toBeNull();
    expect(openAlexService.getInstitution).toHaveBeenCalledTimes(2);
    expect(decisionResolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 3,
      cacheHits: 1,
      providerHydrations: 2,
      providerFailures: 1,
      definitiveMisses: 1,
    });
  });

  test('OpenAlex budget exhaustion skips hydration and remains a retryable provider failure', async () => {
    const decisionResolver = { resolve: jest.fn(async () => resolvedDecision()) };
    const openAlexService = { getInstitution: jest.fn() };
    const exhaustedBudget = {
      begin: jest.fn(() => {
        const error = new Error('reviewer_identity_openalex_budget_exhausted');
        error.code = 'reviewer_identity_openalex_budget_exhausted';
        throw error;
      }),
    };
    const resolver = createResolver({ decisionResolver, openAlexService });

    await expect(resolver.resolve('University of Minnesota', {
      openAlexRequestBudget: exhaustedBudget,
    })).resolves.toBeNull();
    await expect(resolver.resolve('University of Minnesota', {
      openAlexRequestBudget: exhaustedBudget,
    })).resolves.toBeNull();

    expect(exhaustedBudget.begin).toHaveBeenCalledTimes(2);
    expect(openAlexService.getInstitution).not.toHaveBeenCalled();
    expect(decisionResolver.resolve).toHaveBeenCalledTimes(2);
    expect(resolver.metrics).toMatchObject({
      providerHydrations: 0,
      providerFailures: 2,
      cacheSize: 0,
    });
  });

  test('caller cancellation propagates and is not cached as a provider failure', async () => {
    const controller = new AbortController();
    const cancellation = new Error('caller cancelled');
    cancellation.name = 'AbortError';
    const openAlexService = {
      getInstitution: jest.fn(async (_ror, { signal }) => {
        controller.abort(cancellation);
        throw signal.reason;
      }),
    };
    const decisionResolver = { resolve: jest.fn(async () => resolvedDecision()) };
    const resolver = createResolver({ decisionResolver, openAlexService });

    await expect(resolver.resolve('University of Minnesota', {
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(resolver.metrics.providerFailures).toBe(0);
    expect(resolver.cacheSize).toBe(0);
  });

  test('settled identities are request-cached and metrics contain counts only', async () => {
    const adapterMetrics = {
      provider_requests: 2,
      affiliation_lookups: 1,
      candidate_sets: 1,
      candidates_returned: 3,
      max_candidates_returned: 3,
      ordinary_query_lookups: 1,
      retries: 1,
      cache_hits: 0,
      single_flight_hits: 0,
      provider_failures: 0,
    };
    const decisionResolver = { resolve: jest.fn(async () => resolvedDecision()) };
    const openAlexService = {
      getInstitution: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I130238516',
        ror: ROR,
        displayName: 'University of Minnesota Twin Cities',
      })),
    };
    const resolver = createResolver({ decisionResolver, openAlexService, adapterMetrics });

    const first = await resolver.resolve('University of Minnesota');
    const second = await resolver.resolve('University of Minnesota');
    expect(second).toBe(first);
    expect(decisionResolver.resolve).toHaveBeenCalledTimes(1);
    expect(openAlexService.getInstitution).toHaveBeenCalledTimes(1);
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 2,
      cacheHits: 1,
      providerSearches: 2,
      providerHydrations: 1,
      resolved: 1,
      rorProviderRequests: 2,
      rorAffiliationLookups: 1,
      rorCandidateSets: 1,
      rorCandidatesReturned: 3,
      rorMaxCandidatesReturned: 3,
      rorOrdinaryQueryLookups: 1,
      rorRetries: 1,
      openAlexHydrations: 1,
    });
    expect(JSON.stringify(resolver.metrics)).not.toContain('Minnesota');
  });
});
