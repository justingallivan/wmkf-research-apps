/**
 * @jest-environment node
 */

const {
  MATCH,
  createInstitutionIdentityResolver,
  institutionNameMatchRank,
  selectInstitutionCandidate,
} = require('../../lib/services/institution-identity-resolver');

const INSTITUTIONS = {
  hhmi: {
    openAlexId: 'https://openalex.org/I1344073410',
    displayName: 'Howard Hughes Medical Institute',
    ror: 'https://ror.org/006w34k90',
    country: 'US',
  },
  broad: {
    openAlexId: 'https://openalex.org/I107606265',
    displayName: 'Broad Institute',
    ror: 'https://ror.org/05a0ya142',
    country: 'US',
    associatedInstitutions: [
      {
        openAlexId: 'https://openalex.org/I136199984',
        displayName: 'Harvard University',
        ror: 'https://ror.org/03vek6s52',
        country: 'US',
        relationship: 'related',
      },
      {
        openAlexId: 'https://openalex.org/I63966007',
        displayName: 'Massachusetts Institute of Technology',
        ror: 'https://ror.org/042nb2s44',
        country: 'US',
        relationship: 'related',
      },
    ],
  },
  whitehead: {
    openAlexId: 'https://openalex.org/I4210157710',
    displayName: 'Whitehead Institute for Biomedical Research',
    ror: 'https://ror.org/04vqm6w82',
    country: 'US',
  },
  iasUs: {
    openAlexId: 'https://openalex.org/I40036882',
    displayName: 'Institute for Advanced Study',
    ror: 'https://ror.org/00f809463',
    country: 'US',
  },
  iasDe: {
    openAlexId: 'https://openalex.org/I4210137766',
    displayName: 'Institute for Advanced Study',
    ror: 'https://ror.org/03xg85719',
    country: 'DE',
  },
  iasDe2: {
    openAlexId: 'https://openalex.org/I4210163803',
    displayName: 'Institute for Advanced Study',
    ror: 'https://ror.org/05fj6by70',
    country: 'DE',
  },
  harvard: {
    openAlexId: 'https://openalex.org/I136199984',
    displayName: 'Harvard University',
    ror: 'https://ror.org/03vek6s52',
    country: 'US',
  },
  harvardPress: {
    openAlexId: 'https://openalex.org/I2801851002',
    displayName: 'Harvard University Press',
    ror: 'https://ror.org/006v7bf86',
    country: 'US',
  },
  danaFarber: {
    openAlexId: 'https://openalex.org/I4210117453',
    displayName: 'Dana-Farber Cancer Institute',
    ror: 'https://ror.org/02jzgtq86',
    country: 'US',
  },
};

function serviceFor(searchRows, hydratedById = {}) {
  return {
    searchInstitutions: jest.fn(async () => searchRows),
    getInstitution: jest.fn(async (id) => hydratedById[id] || null),
  };
}

describe('institution identity name selection', () => {
  test('recognizes exact, containment, and explicit-acronym matches', () => {
    expect(institutionNameMatchRank(
      'Harvard University',
      'Harvard University',
    )).toBe(MATCH.EXACT);
    expect(institutionNameMatchRank(
      'Broad Institute of MIT and Harvard',
      'Broad Institute',
    )).toBe(MATCH.CONTAINMENT);
    expect(institutionNameMatchRank(
      'Whitehead Institute',
      'Whitehead Institute for Biomedical Research',
    )).toBe(MATCH.CONTAINMENT);
    expect(institutionNameMatchRank(
      'HHMI',
      'Howard Hughes Medical Institute',
    )).toBe(MATCH.ACRONYM);
    expect(institutionNameMatchRank(
      'Rice University',
      'Price University',
    )).toBe(MATCH.NONE);
    expect(institutionNameMatchRank(
      'MIT',
      'MIT Media Lab',
    )).toBe(MATCH.NONE);
    expect(institutionNameMatchRank(
      'Harvard',
      'Harvard University',
    )).toBe(MATCH.NONE);
  });

  test('never resolves equally strong names by result order', () => {
    expect(selectInstitutionCandidate(
      'Institute for Advanced Study',
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe],
    )).toBeNull();
    expect(selectInstitutionCandidate(
      'IAS',
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe],
    )).toBeNull();
  });

  test('an explicit country code safely disambiguates identical names', () => {
    expect(selectInstitutionCandidate(
      'Institute for Advanced Study',
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe, INSTITUTIONS.iasDe2],
      { countryCode: 'US' },
    )).toBe(INSTITUTIONS.iasUs);
    expect(selectInstitutionCandidate(
      'Institute for Advanced Study',
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe, INSTITUTIONS.iasDe2],
      { countryCode: 'DE' },
    )).toBeNull();
    expect(selectInstitutionCandidate(
      'Institute for Advanced Study',
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe],
      { countryCode: 'USA' },
    )).toBeNull();
  });

  test('exact Harvard beats a weaker Harvard University Press containment', () => {
    expect(selectInstitutionCandidate(
      'Harvard University',
      [INSTITUTIONS.harvardPress, INSTITUTIONS.harvard],
    )).toBe(INSTITUTIONS.harvard);
  });
});

describe('createInstitutionIdentityResolver', () => {
  test.each([
    ['HHMI', INSTITUTIONS.hhmi],
    ['Broad Institute of MIT and Harvard', INSTITUTIONS.broad],
    ['Whitehead Institute', INSTITUTIONS.whitehead],
    ['Harvard University', INSTITUTIONS.harvard],
    ['Dana-Farber Cancer Institute', INSTITUTIONS.danaFarber],
  ])('resolves a unique grounded institution: %s', async (query, institution) => {
    const service = serviceFor([institution], {
      [institution.openAlexId]: institution,
    });
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    const result = await resolver.resolve(query);

    expect(result).toMatchObject({
      openAlexId: institution.openAlexId,
      ror: institution.ror,
      country: institution.country,
      displayName: institution.displayName,
      associatedInstitutions: institution.associatedInstitutions || [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.associatedInstitutions)).toBe(true);
  });

  test('unqualified IAS abstains and caches the definitive ambiguity', async () => {
    const service = serviceFor([INSTITUTIONS.iasUs, INSTITUTIONS.iasDe]);
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('Institute for Advanced Study')).resolves.toBeNull();
    await expect(resolver.resolve('Institute for Advanced Study')).resolves.toBeNull();
    expect(service.searchInstitutions).toHaveBeenCalledTimes(1);
    expect(service.getInstitution).not.toHaveBeenCalled();
    expect(resolver.cacheSize).toBe(1);
  });

  test('country-qualified IAS resolves only when the country leaves one identity', async () => {
    const service = serviceFor(
      [INSTITUTIONS.iasUs, INSTITUTIONS.iasDe, INSTITUTIONS.iasDe2],
      { [INSTITUTIONS.iasUs.openAlexId]: INSTITUTIONS.iasUs },
    );
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve(
      'Institute for Advanced Study',
      { countryCode: 'US' },
    )).resolves.toMatchObject({
      openAlexId: INSTITUTIONS.iasUs.openAlexId,
      country: 'US',
    });
    await expect(resolver.resolve(
      'Institute for Advanced Study',
      { countryCode: 'DE' },
    )).resolves.toBeNull();
  });

  test('a specific Berlin affiliation resolves the German IAS identity', async () => {
    const service = serviceFor(
      [INSTITUTIONS.iasDe],
      { [INSTITUTIONS.iasDe.openAlexId]: INSTITUTIONS.iasDe },
    );
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve(
      'Institute for Advanced Study Berlin',
    )).resolves.toMatchObject({
      openAlexId: INSTITUTIONS.iasDe.openAlexId,
      country: 'DE',
    });
  });

  test('successful results are cached per resolver instance', async () => {
    const service = serviceFor(
      [INSTITUTIONS.broad],
      { [INSTITUTIONS.broad.openAlexId]: INSTITUTIONS.broad },
    );
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    const first = await resolver.resolve('Broad Institute');
    const second = await resolver.resolve(' broad institute ');

    expect(second).toBe(first);
    expect(service.searchInstitutions).toHaveBeenCalledTimes(1);
    expect(service.getInstitution).toHaveBeenCalledTimes(1);
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 2,
      cacheHits: 1,
      singleFlightHits: 0,
      providerSearches: 1,
      providerHydrations: 1,
      resolved: 1,
      cacheSize: 1,
      inFlightSize: 0,
    });
    expect(Object.isFrozen(resolver.metrics)).toBe(true);
  });

  test('single-flights concurrent identical lookups in the same cancellation scope', async () => {
    let releaseSearch;
    const service = {
      searchInstitutions: jest.fn(() => new Promise((resolve) => {
        releaseSearch = () => resolve([INSTITUTIONS.broad]);
      })),
      getInstitution: jest.fn(async () => INSTITUTIONS.broad),
    };
    const resolver = createInstitutionIdentityResolver({ openAlexService: service });

    const first = resolver.resolve('Broad Institute');
    const second = resolver.resolve(' broad institute ');

    expect(service.searchInstitutions).toHaveBeenCalledTimes(1);
    expect(resolver.metrics).toMatchObject({
      resolveCalls: 2,
      singleFlightHits: 1,
      inFlightSize: 1,
    });
    releaseSearch();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(service.getInstitution).toHaveBeenCalledTimes(1);
    expect(resolver.metrics).toMatchObject({
      providerSearches: 1,
      providerHydrations: 1,
      resolved: 1,
      cacheSize: 1,
      inFlightSize: 0,
    });
  });

  test('does not let one abort scope cancel an independent lookup', async () => {
    const releaseSearches = [];
    const service = {
      searchInstitutions: jest.fn(() => new Promise((resolve) => {
        releaseSearches.push(() => resolve([INSTITUTIONS.broad]));
      })),
      getInstitution: jest.fn(async () => INSTITUTIONS.broad),
    };
    const resolver = createInstitutionIdentityResolver({ openAlexService: service });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = resolver.resolve('Broad Institute', { signal: firstController.signal });
    const second = resolver.resolve('Broad Institute', { signal: secondController.signal });

    expect(service.searchInstitutions).toHaveBeenCalledTimes(2);
    expect(resolver.metrics).toMatchObject({
      singleFlightHits: 0,
      inFlightSize: 2,
    });
    const firstExpectation = expect(first).rejects.toThrow('first_lookup_cancelled');
    const secondExpectation = expect(second).resolves.toMatchObject({
      openAlexId: INSTITUTIONS.broad.openAlexId,
    });
    firstController.abort(new Error('first_lookup_cancelled'));
    releaseSearches.forEach((release) => release());
    await firstExpectation;
    await secondExpectation;
    expect(resolver.metrics.cacheSize).toBe(1);
    expect(resolver.metrics.inFlightSize).toBe(0);
  });

  test('empty, garbage, and uncorroborated inputs abstain', async () => {
    const service = serviceFor([INSTITUTIONS.harvard]);
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('')).resolves.toBeNull();
    await expect(resolver.resolve('Harvard University', {
      countryCode: 'USA',
    })).resolves.toBeNull();
    await expect(resolver.resolve('unrelated garbage')).resolves.toBeNull();
    expect(service.searchInstitutions).toHaveBeenCalledTimes(1);
    expect(service.getInstitution).not.toHaveBeenCalled();
  });

  test('provider failure degrades to null without poisoning later retries', async () => {
    const service = {
      searchInstitutions: jest.fn()
        .mockRejectedValueOnce(new Error('OpenAlex unavailable'))
        .mockResolvedValueOnce([INSTITUTIONS.hhmi]),
      getInstitution: jest.fn(async () => INSTITUTIONS.hhmi),
    };
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('HHMI')).resolves.toBeNull();
    await expect(resolver.resolve('HHMI')).resolves.toMatchObject({
      openAlexId: INSTITUTIONS.hhmi.openAlexId,
    });
    expect(service.searchInstitutions).toHaveBeenCalledTimes(2);
  });

  test('caller cancellation propagates and is never cached as a miss', async () => {
    const controller = new AbortController();
    const cancelled = new Error('caller_cancelled');
    const service = {
      searchInstitutions: jest.fn(async () => {
        controller.abort(cancelled);
        throw cancelled;
      }),
      getInstitution: jest.fn(),
    };
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('Broad Institute', {
      signal: controller.signal,
    })).rejects.toThrow('caller_cancelled');
    expect(resolver.cacheSize).toBe(0);
  });

  test('caller cancellation propagates even when the provider ignores the signal', async () => {
    const controller = new AbortController();
    const cancelled = new Error('caller_cancelled_after_search');
    const service = {
      searchInstitutions: jest.fn(async () => {
        controller.abort(cancelled);
        return [INSTITUTIONS.broad];
      }),
      getInstitution: jest.fn(),
    };
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('Broad Institute', {
      signal: controller.signal,
    })).rejects.toThrow('caller_cancelled_after_search');
    expect(service.getInstitution).not.toHaveBeenCalled();
    expect(resolver.cacheSize).toBe(0);
  });

  test('a mismatched hydration response abstains and caches the safe miss', async () => {
    const service = serviceFor(
      [INSTITUTIONS.broad],
      { [INSTITUTIONS.broad.openAlexId]: INSTITUTIONS.harvard },
    );
    const resolver = createInstitutionIdentityResolver({
      openAlexService: service,
    });

    await expect(resolver.resolve('Broad Institute')).resolves.toBeNull();
    expect(resolver.cacheSize).toBe(1);
  });
});
