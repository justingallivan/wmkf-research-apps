/**
 * @jest-environment node
 *
 * Locks the OpenAlex publication-list backfill (S235): a reviewer confirmed via the
 * OpenAlex/ORCID identity paths (spine / Track-B) attaches identity + metrics but no works
 * list, so a non-biomedical confirmed reviewer (e.g. an attosecond physicist resolved
 * without PubMed) showed "0 publications" and got publicationCount5yr=0 (ranking penalty).
 * backfillOpenAlexPublications fetches the SAME confirmed author's recent works.
 */
const { DiscoveryService } = require('../../lib/services/discovery-service');
const { OpenAlexService } = require('../../lib/services/openalex-service');

describe('DiscoveryService.dedupePublicationsByTitle (shared PubMed + OpenAlex dedup)', () => {
  test('collapses same-title duplicates, preserving first-seen order', () => {
    const out = DiscoveryService.dedupePublicationsByTitle([
      { title: 'Paper A', year: 2025 },
      { title: 'paper  a', year: 2025 }, // case/whitespace variant of the same title
      { title: 'Paper B', year: 2024 },
    ]);
    expect(out.map((p) => p.title)).toEqual(['Paper A', 'Paper B']);
  });

  test('prefers the PUBLISHED version over a bioRxiv preprint (by journal)', () => {
    const out = DiscoveryService.dedupePublicationsByTitle([
      { title: 'Gene paper', year: 2025, journal: 'bioRxiv : the preprint server for biology' },
      { title: 'Gene paper', year: 2025, journal: 'Nature' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].journal).toBe('Nature');
  });

  test('prefers the published version over a preprint (by arXiv/bioRxiv DOI in url)', () => {
    const out = DiscoveryService.dedupePublicationsByTitle([
      { title: 'Physics paper', year: 2026, url: 'https://doi.org/10.48550/arxiv.2604.07543' },
      { title: 'Physics paper', year: 2026, url: 'https://doi.org/10.1038/s41586-026-00000' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain('10.1038');
  });

  test('keeps the preprint if no published version exists', () => {
    const out = DiscoveryService.dedupePublicationsByTitle([
      { title: 'Only preprint', year: 2026, journal: 'bioRxiv' },
    ]);
    expect(out).toEqual([{ title: 'Only preprint', year: 2026, journal: 'bioRxiv' }]);
  });

  test('caps at limit and drops untitled rows', () => {
    const out = DiscoveryService.dedupePublicationsByTitle(
      [{ title: 'A' }, { title: null }, { title: 'B' }, { title: 'C' }],
      { limit: 2 },
    );
    expect(out.map((p) => p.title)).toEqual(['A', 'B']);
  });
});

describe('DiscoveryService.backfillOpenAlexPublications', () => {
  afterEach(() => jest.restoreAllMocks());

  test('attaches recent OpenAlex works to a trusted empty-pubs candidate + sets publicationCount5yr', async () => {
    const yr = new Date().getFullYear();
    jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({
      totalCount: 2,
      records: [
        { title: 'Recent attosecond paper', year: yr, url: 'https://doi.org/10.1/x' },
        { title: 'Old paper', year: yr - 20, url: null },
      ],
    });
    const c = { name: 'David Villeneuve', verified: true, identityStatus: 'confirmed', openAlexId: 'https://openalex.org/A123', publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([c], {});
    expect(c.publications).toEqual([
      { title: 'Recent attosecond paper', year: yr, url: 'https://doi.org/10.1/x' },
      { title: 'Old paper', year: yr - 20, url: null },
    ]);
    expect(c.publicationCount5yr).toBe(1); // only the recent one is within the lookback window
  });

  test('reads the Track-B author-id field name too (openAlexAuthorId)', async () => {
    const spy = jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [{ title: 'p', year: 2025, url: 'u' }] });
    const c = { name: 'Track B', verificationStatus: 'probable', openAlexAuthorId: 'A9', publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([c], {});
    expect(spy).toHaveBeenCalledWith('A9', expect.objectContaining({ limit: expect.any(Number) }));
    expect(c.publications).toHaveLength(1);
  });

  test('never clobbers an existing (PubMed) publication list — not even fetched', async () => {
    const spy = jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [{ title: 'x', year: 2024 }] });
    const c = { name: 'Has Pubs', verified: true, openAlexAuthorId: 'A9', publications: [{ title: 'PubMed paper', year: 2023, url: 'u' }] };
    await DiscoveryService.backfillOpenAlexPublications([c], {});
    expect(c.publications).toEqual([{ title: 'PubMed paper', year: 2023, url: 'u' }]);
    expect(spy).not.toHaveBeenCalled();
  });

  test('skips untrusted candidates and candidates with no OpenAlex author id', async () => {
    const spy = jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [] });
    const untrusted = { name: 'Unresolved', identityStatus: 'unresolved', openAlexId: 'A1', publications: [] };
    const noId = { name: 'No Id', verified: true, publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([untrusted, noId], {});
    expect(spy).not.toHaveBeenCalled();
    expect(untrusted.publications).toEqual([]);
    expect(noId.publications).toEqual([]);
  });

  test('degrades to a no-op on OpenAlex failure (never throws)', async () => {
    jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockRejectedValue(new Error('openalex down'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const c = { name: 'X', verified: true, openAlexId: 'A1', publications: [] };
    await expect(DiscoveryService.backfillOpenAlexPublications([c], {})).resolves.toBeUndefined();
    expect(c.publications).toEqual([]);
  });

  test('respects the abort signal — fetches nothing once aborted', async () => {
    const spy = jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [{ title: 'x', year: 2024 }] });
    const c = { name: 'X', verified: true, openAlexId: 'A1', publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([c], { signal: { aborted: true } });
    expect(spy).not.toHaveBeenCalled();
    expect(c.publications).toEqual([]);
  });

  test('dedups duplicate work records by title (OpenAlex preprint + published version)', async () => {
    jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({
      records: [
        { title: 'Phonon-driven decoherence', year: 2026, url: 'https://doi.org/10.x' },
        { title: 'phonon-driven  decoherence', year: 2026, url: 'https://openalex.org/W1' }, // same title, diff case/whitespace + url
        { title: 'Another paper', year: 2025, url: 'u2' },
      ],
    });
    const c = { name: 'X', verified: true, openAlexId: 'A1', publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([c], {});
    expect(c.publications).toHaveLength(2);
    expect(c.publications.map((p) => p.title)).toEqual(['Phonon-driven decoherence', 'Another paper']);
  });

  test('a fetch that returns no usable works leaves the candidate empty (no crash)', async () => {
    jest.spyOn(OpenAlexService, 'getWorksByAuthor').mockResolvedValue({ records: [{ title: null, year: null, url: null }] });
    const c = { name: 'X', verified: true, openAlexId: 'A1', publications: [] };
    await DiscoveryService.backfillOpenAlexPublications([c], {});
    expect(c.publications).toEqual([]);
    expect(c.publicationCount5yr).toBeUndefined();
  });
});
