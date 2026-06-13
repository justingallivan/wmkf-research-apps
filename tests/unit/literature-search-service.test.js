/**
 * @jest-environment node
 *
 * Slice 2 of the SerpAPI→free-stack migration: the novelty + PI-publication literature
 * searches moved from paid SerpAPI `google_scholar` to free OpenAlex works. These lock the
 * OpenAlex mapping (source label 'openalex', recency filter, abstract→snippet, cites) and
 * the PI-author institution disambiguation.
 */
const { LiteratureSearchService } = require('../../lib/services/literature-search-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');

const work = (over = {}) => ({
  openAlexId: 'https://openalex.org/W1',
  title: 'A relevant work',
  year: 2024,
  url: 'https://doi.org/10.1/x',
  citedByCount: 42,
  abstract: 'We demonstrate a novel method. '.repeat(40), // > 300 chars to test truncation
  authorships: [{ displayName: 'Jane Roe' }, { displayName: 'John Doe' }],
  ...over,
});

describe('LiteratureSearchService._searchOpenAlexWorks (novelty)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('maps OpenAlex works to the collation shape with source=openalex + truncated snippet', async () => {
    const spy = jest.spyOn(OpenAlexService, 'searchWorks').mockResolvedValue({ totalCount: 1, records: [work()] });

    const out = await LiteratureSearchService._searchOpenAlexWorks(['novel claim query']);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'openalex',
      title: 'A relevant work',
      authors: 'Jane Roe, John Doe',
      year: '2024',
      citedBy: 42,
      url: 'https://doi.org/10.1/x',
      searchQuery: 'novel claim query',
    });
    expect(out[0].snippet.length).toBe(300); // abstract truncated
    // Recency filter: yearFrom = current year - 5.
    expect(spy).toHaveBeenCalledWith('novel claim query', expect.objectContaining({ yearFrom: new Date().getFullYear() - 5 }));
  });

  test('caps to the top 4 novelty queries and tolerates a per-query failure', async () => {
    const spy = jest.spyOn(OpenAlexService, 'searchWorks')
      .mockResolvedValueOnce({ records: [work({ title: 'q1' })] })
      .mockRejectedValueOnce(new Error('openalex_timeout'))
      .mockResolvedValueOnce({ records: [work({ title: 'q3' })] })
      .mockResolvedValueOnce({ records: [] });

    const out = await LiteratureSearchService._searchOpenAlexWorks(['q1', 'q2', 'q3', 'q4', 'q5']);

    expect(spy).toHaveBeenCalledTimes(4); // 5th query dropped by the cap
    expect(out.map((r) => r.title)).toEqual(['q1', 'q3']); // q2 failed → skipped, not thrown
  });
});

describe('LiteratureSearchService._searchPIPubs (PI publications)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('resolves the PI author by institution overlap, then maps recent works', async () => {
    jest.spyOn(OpenAlexService, 'searchAuthors').mockResolvedValue({
      records: [
        { openAlexId: 'A_WRONG', displayName: 'Bo Li', lastKnownInstitution: 'Tsinghua University' },
        { openAlexId: 'A_RIGHT', displayName: 'Bo Li', lastKnownInstitution: 'Massachusetts Institute of Technology' },
      ],
    });
    const worksSpy = jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [work({ title: 'PI paper' })] });

    // Institution disambiguation is distinctive-token overlap (≥4 chars), so it works on
    // shared real words, not acronyms (an "MIT" → full-name match is out of scope; the
    // collation prompt re-filters). 'Massachusetts'/'Technology' overlap the right author.
    const out = await LiteratureSearchService._searchPIPubs(
      [{ name: 'Bo Li', institution: 'Massachusetts Institute of Technology' }], 'biology');

    // institution-matched author + recency filter threaded through (Codex S251 MEDIUM)
    expect(worksSpy).toHaveBeenCalledWith('A_RIGHT', expect.objectContaining({ yearFrom: new Date().getFullYear() - 5 }));
    expect(out[0]).toMatchObject({
      piName: 'Bo Li',
      institution: 'Massachusetts Institute of Technology',
      resolvedInstitution: 'Massachusetts Institute of Technology', // surfaced for the LLM cross-check
    });
    expect(out[0].publications[0]).toMatchObject({ title: 'PI paper', citedBy: 42, year: '2024' });
  });

  test('no author resolved → empty publications (no throw)', async () => {
    jest.spyOn(OpenAlexService, 'searchAuthors').mockResolvedValue({ records: [] });
    const worksSpy = jest.spyOn(OpenAlexService, 'getWorksByAuthor');

    const out = await LiteratureSearchService._searchPIPubs([{ name: 'Nobody', institution: 'Nowhere' }]);

    expect(worksSpy).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ piName: 'Nobody', institution: 'Nowhere', publications: [] });
  });

  test('falls back to the top author when no institution overlaps', async () => {
    jest.spyOn(OpenAlexService, 'searchAuthors').mockResolvedValue({
      records: [
        { openAlexId: 'A_TOP', displayName: 'Wei Wang', lastKnownInstitution: 'Some Other Place' },
        { openAlexId: 'A_TWO', displayName: 'Wei Wang', lastKnownInstitution: 'Another Place' },
      ],
    });
    jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [] });

    const out = await LiteratureSearchService._searchPIPubs([{ name: 'Wei Wang', institution: 'Unmatched University' }]);
    expect(OpenAlexService.getWorksByAuthor).toHaveBeenCalledWith('A_TOP', expect.anything());
    expect(out[0].publications).toEqual([]);
  });
});

describe('LiteratureSearchService.searchAll — OpenAlex key', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns the openAlex key (not googleScholar) and routes novelty queries to OpenAlex', async () => {
    jest.spyOn(OpenAlexService, 'searchWorks').mockResolvedValue({ records: [work()] });
    jest.spyOn(OpenAlexService, 'searchAuthors').mockResolvedValue({ records: [] });
    jest.spyOn(LiteratureSearchService, '_searchPubMed').mockResolvedValue([]);
    jest.spyOn(LiteratureSearchService, '_searchArXiv').mockResolvedValue([]);
    jest.spyOn(LiteratureSearchService, '_searchBioRxiv').mockResolvedValue([]);
    jest.spyOn(LiteratureSearchService, '_searchChemRxiv').mockResolvedValue([]);

    const out = await LiteratureSearchService.searchAll({
      noveltySearchStrings: ['claim'],
      techniqueSearchStrings: [],
      piDetails: [],
      field: 'physics',
    });

    expect(out).toHaveProperty('openAlex');
    expect(out).not.toHaveProperty('googleScholar');
    expect(out.openAlex[0].source).toBe('openalex');
  });
});
