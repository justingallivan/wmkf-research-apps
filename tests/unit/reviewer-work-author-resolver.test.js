/**
 * @jest-environment node
 */

jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: {
    getWorkByExternalId: jest.fn(),
    getWorkByTitle: jest.fn(),
  },
}));

const { OpenAlexService } = require('../../lib/services/openalex-service');
const { ReviewerWorkAuthorResolver } = require('../../lib/services/reviewer-work-author-resolver');

const work = (overrides = {}) => ({
  openAlexId: 'https://openalex.org/W1',
  title: 'A surfacing work',
  doi: '10.123/example',
  authorships: [{
    openAlexAuthorId: 'https://openalex.org/A1',
    displayName: 'Jane Roe',
    orcid: '0000-0002-1825-0097',
    institution: 'Example University',
    topics: ['Regeneration'],
  }],
  ...overrides,
});

describe('ReviewerWorkAuthorResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    OpenAlexService.getWorkByExternalId.mockResolvedValue({ totalCount: 0, records: [] });
    OpenAlexService.getWorkByTitle.mockResolvedValue({ totalCount: 0, records: [] });
  });

  test('resolves by DOI and uniquely matches the author', async () => {
    OpenAlexService.getWorkByExternalId.mockResolvedValueOnce({ totalCount: 1, records: [work()] });

    const out = await ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work', doi: '10.123/example' }],
    });

    expect(out.status).toBe('confirmed');
    expect(out.openAlexAuthorId).toBe('https://openalex.org/A1');
    expect(out.orcid).toBe('0000-0002-1825-0097');
    expect(out.anchors.map((a) => a.type)).toContain('authorship_grounded');
    expect(OpenAlexService.getWorkByExternalId).toHaveBeenCalledWith('doi', '10.123/example', expect.any(Object));
  });

  test('falls through DOI to PMID to arxiv to title', async () => {
    OpenAlexService.getWorkByExternalId
      .mockResolvedValueOnce({ totalCount: 0, records: [] })
      .mockResolvedValueOnce({ totalCount: 0, records: [] })
      .mockResolvedValueOnce({ totalCount: 0, records: [] });
    OpenAlexService.getWorkByTitle.mockResolvedValueOnce({ totalCount: 1, records: [work()] });

    const out = await ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work', doi: '10.bad', pmid: '123', arxivId: '2301.07041' }],
    });

    expect(out.status).toBe('confirmed');
    expect(OpenAlexService.getWorkByExternalId.mock.calls.map((c) => c[0])).toEqual(['doi', 'pmid', 'arxiv']);
    expect(OpenAlexService.getWorkByTitle).toHaveBeenCalledWith('A surfacing work', expect.any(Object));
  });

  test('authorship grounded alone is probable when no topic or ORCID exists', async () => {
    OpenAlexService.getWorkByTitle.mockResolvedValueOnce({
      totalCount: 1,
      records: [work({ authorships: [{ openAlexAuthorId: 'A2', displayName: 'Jane Roe', orcid: null, institution: null, topics: [] }] })],
    });

    const out = await ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work' }],
    });

    expect(out.status).toBe('probable');
  });

  test('ambiguous, missing, title-collision, and outage all abstain', async () => {
    OpenAlexService.getWorkByTitle.mockResolvedValueOnce({
      totalCount: 1,
      records: [work({ authorships: [
        { openAlexAuthorId: 'A1', displayName: 'Jane Roe', topics: [] },
        { openAlexAuthorId: 'A2', displayName: 'J. Roe', topics: [] },
      ] })],
    });
    await expect(ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work' }],
    })).resolves.toMatchObject({ status: 'abstain', reason: 'ambiguous_author_match' });

    OpenAlexService.getWorkByTitle.mockResolvedValueOnce({ totalCount: 1, records: [work()] });
    await expect(ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Pat Lee',
      publications: [{ title: 'A surfacing work' }],
    })).resolves.toMatchObject({ status: 'abstain', reason: 'no_author_match' });

    OpenAlexService.getWorkByTitle.mockResolvedValueOnce({ totalCount: 2, records: [work(), work({ openAlexId: 'W2' })] });
    await expect(ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work' }],
    })).resolves.toMatchObject({ status: 'abstain', reason: 'title_collision' });

    OpenAlexService.getWorkByTitle.mockRejectedValueOnce(new Error('offline'));
    await expect(ReviewerWorkAuthorResolver.resolveCandidate({
      name: 'Jane Roe',
      publications: [{ title: 'A surfacing work' }],
    })).resolves.toMatchObject({ status: 'abstain', reason: 'source_outage' });
  });
});
