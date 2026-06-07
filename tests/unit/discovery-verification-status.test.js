/**
 * @jest-environment node
 */

jest.mock('../../lib/services/pubmed-service', () => ({
  PubMedService: {
    search: jest.fn(),
  },
}));

const { DiscoveryService } = require('../../lib/services/discovery-service');
const { PubMedService } = require('../../lib/services/pubmed-service');

const article = (pmid, authorName, title = 'Relevant publication') => ({
  pmid,
  title,
  year: new Date().getFullYear(),
  journal: 'Journal of Tests',
  abstract: '',
  authors: [{
    name: authorName,
    affiliation: 'University of North Carolina, Chapel Hill, NC',
  }],
});

const runVerification = (suggestion, articlesByQuery) => {
  PubMedService.search.mockImplementation(async (query) => {
    for (const [needle, articles] of Object.entries(articlesByQuery)) {
      if (query.includes(needle)) return articles;
    }
    return [];
  });
  return DiscoveryService.verifyClaudeSuggestions([suggestion], () => {});
};

describe('DiscoveryService.verifyClaudeSuggestions identity states', () => {
  let setTimeoutSpy;
  let originalMinPublications;

  beforeEach(() => {
    jest.clearAllMocks();
    originalMinPublications = DiscoveryService.MIN_PUBLICATIONS;
    DiscoveryService.MIN_PUBLICATIONS = 3;
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => {
      cb();
      return 0;
    });
  });

  afterEach(() => {
    DiscoveryService.MIN_PUBLICATIONS = originalMinPublications;
    setTimeoutSpy.mockRestore();
  });

  test('fabricated Alfred Laederach does not verify against Alain Laederach initial-only PubMed hits', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'Dr. Alfred Laederach', expertiseAreas: [] },
      { 'A Laederach[Author]': alainArticles },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      name: 'Dr. Alfred Laederach',
      verified: false,
      verificationStatus: 'unresolved',
      identityStatus: 'unresolved',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.unverified[0].reason).toMatch(/forename|initial/i);
  });

  test('correct full-name match is verified', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'Alain Laederach', expertiseAreas: [] },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      name: 'Alain Laederach',
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.verified[0].nameEvidence.hasFullForenameMatch).toBe(true);
  });

  test('initial-only suggestion with no corroboration stays unresolved', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'A Laederach', expertiseAreas: [] },
      { 'A Laederach[Author]': alainArticles },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      verified: false,
      verificationStatus: 'unresolved',
      identityStatus: 'unresolved',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.unverified[0].nameEvidence).toMatchObject({
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: true,
    });
  });

  test('ungrounded parametric suggestion is marked barred_parametric', async () => {
    const result = await runVerification(
      { name: 'Imaginary Reviewer', expertiseAreas: [] },
      {},
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      verified: false,
      provenance: {
        kind: 'barred_parametric',
        sources: [],
        seedRole: 'query_seed',
      },
    });
  });

  test('institution mismatch stays verified for a full-name match and sets advisory flag', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        suggestedInstitution: 'Salk Institute',
        expertiseAreas: [],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      institutionMismatch: true,
    });
  });

  test('expertise mismatch stays verified for a full-name match and sets advisory flag', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach', 'Cell mechanics'),
      article('2', 'Alain Laederach', 'RNA structure'),
      article('3', 'Alain Laederach', 'Molecular folding'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        expertiseAreas: ['photosynthetic coral bleaching'],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      expertiseMismatch: true,
    });
  });

  test('institution and expertise mismatch both stay verified for a full-name match', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach', 'Cell mechanics'),
      article('2', 'Alain Laederach', 'RNA structure'),
      article('3', 'Alain Laederach', 'Molecular folding'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        suggestedInstitution: 'Salk Institute',
        expertiseAreas: ['photosynthetic coral bleaching'],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      institutionMismatch: true,
      expertiseMismatch: true,
    });
  });
});
