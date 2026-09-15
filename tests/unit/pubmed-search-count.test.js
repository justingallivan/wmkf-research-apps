const { PubMedService } = require('../../lib/services/pubmed-service');

describe('PubMedService count-preserving search', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('retains the provider total alongside the bounded PMID page', async () => {
    jest.spyOn(PubMedService, 'request').mockResolvedValue({
      json: async () => ({
        esearchresult: {
          count: '31',
          idlist: ['100', '101'],
        },
      }),
    });

    await expect(PubMedService.searchPMIDsWithCount(
      'Alice Example[Author]',
      2,
    )).resolves.toEqual({ totalCount: 31, pmids: ['100', '101'] });
  });

  test('searchWithCount preserves the total while fetching the bounded records', async () => {
    jest.spyOn(PubMedService, 'searchPMIDsWithCount').mockResolvedValue({
      totalCount: 31,
      pmids: ['100', '101'],
    });
    jest.spyOn(PubMedService, 'fetchArticles').mockResolvedValue([
      { pmid: '100' },
      { pmid: '101' },
    ]);

    await expect(PubMedService.searchWithCount(
      'Alice Example[Author]',
      2,
      { throwOnError: true },
    )).resolves.toEqual({
      totalCount: 31,
      records: [{ pmid: '100' }, { pmid: '101' }],
    });
  });

  test('a swallowed provider error cannot look like a complete empty corpus', async () => {
    jest.spyOn(PubMedService, 'searchPMIDsWithCount').mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(PubMedService.searchWithCount(
      'Alice Example[Author]',
      2,
    )).resolves.toEqual({ totalCount: null, records: [] });
  });
});
