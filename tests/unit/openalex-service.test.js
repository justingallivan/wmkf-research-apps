/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/safe-fetch.js', () => ({
  safeFetch: jest.fn(),
}));

const { safeFetch } = require('../../lib/utils/safe-fetch.js');
const { OpenAlexService } = require('../../lib/services/openalex-service');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn(async () => payload),
});

describe('OpenAlexService.searchAuthors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parses author response into spine records', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 12 },
      results: [{
        id: 'https://openalex.org/A123',
        display_name: 'Robert Sang',
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        // Real current OpenAlex shape: plural array (singular is deprecated/absent live).
        last_known_institutions: [{ display_name: 'Griffith University' }],
        x_concepts: [
          { display_name: 'Attosecond physics', score: 91 },
          { display_name: 'Low score', score: 12 },
        ],
        works_count: 345,
      }],
    }));

    const out = await OpenAlexService.searchAuthors('Robert Sang', { limit: 5 });

    expect(out.totalCount).toBe(12);
    expect(out.records).toEqual([{
      openAlexId: 'https://openalex.org/A123',
      displayName: 'Robert Sang',
      orcid: '0000-0002-1825-0097',
      lastKnownInstitution: 'Griffith University',
      topics: ['Attosecond physics'],
      worksCount: 345,
    }]);
    expect(safeFetch.mock.calls[0][0]).toMatch(/api\.openalex\.org\/authors/);
    expect(safeFetch.mock.calls[0][1].signal).toBeTruthy();
  });

  test('falls back to legacy singular last_known_institution when present', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 1 },
      results: [{ id: 'A1', display_name: 'X', last_known_institution: { display_name: 'Legacy U' } }],
    }));
    const out = await OpenAlexService.searchAuthors('X');
    expect(out.records[0].lastKnownInstitution).toBe('Legacy U');
  });

  test('topTopics accepts current 0-1 x_concepts scores', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 1 },
      results: [{
        id: 'A1',
        display_name: 'Scaled Author',
        x_concepts: [
          { display_name: 'Computational biology', score: 0.91 },
          { display_name: 'Low score', score: 0.12 },
        ],
      }],
    }));

    const out = await OpenAlexService.searchAuthors('Scaled Author');
    expect(out.records[0].topics).toEqual(['Computational biology']);
  });

  test('throws on source outage after retry so adapter can abstain', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503));

    await expect(OpenAlexService.searchAuthors('Robert Sang')).rejects.toThrow(/OpenAlex request failed/);
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });
});

describe('OpenAlexService work lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('looks up works by DOI and maps authorships', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 1 },
      results: [{
        id: 'https://openalex.org/W1',
        display_name: 'A surfacing work',
        doi: 'https://doi.org/10.123/example',
        authorships: [{
          author: {
            id: 'https://openalex.org/A1',
            display_name: 'Jane Roe',
            orcid: 'https://orcid.org/0000-0002-1825-0097',
          },
          institutions: [{ display_name: 'Example University' }],
        }],
        x_concepts: [{ display_name: 'Regeneration', score: 0.8 }],
      }],
    }));

    const out = await OpenAlexService.getWorkByExternalId('doi', '10.123/example');
    expect(out.records[0].authorships[0]).toMatchObject({
      openAlexAuthorId: 'https://openalex.org/A1',
      displayName: 'Jane Roe',
      orcid: '0000-0002-1825-0097',
      institution: 'Example University',
      topics: ['Regeneration'],
    });
    expect(safeFetch.mock.calls[0][0]).toMatch(/filter=doi%3A10\.123%2Fexample/);
  });

  test('arxiv lookup falls back to the arxiv DOI form', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 }, results: [] }));
    await OpenAlexService.getWorkByExternalId('arxiv', '2301.07041');
    expect(safeFetch.mock.calls[0][0]).toMatch(/10\.48550%2FarXiv\.2301\.07041/);
  });

  test('title lookup uses the top-level search parameter', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 }, results: [] }));
    await OpenAlexService.getWorkByTitle('Exact title');
    const url = safeFetch.mock.calls[0][0];
    expect(url).toContain('search=Exact+title');
    expect(url).not.toContain('filter=');
  });
});

describe('OpenAlexService.getAuthorByOrcid (S240)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const VALID_ORCID = '0000-0002-1825-0097'; // canonical, checksum-valid

  test('resolves an ORCID to a single author record via the path form (no percent-encoding)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/A5060668110',
      display_name: 'Wen Li',
      orcid: `https://orcid.org/${VALID_ORCID}`,
      last_known_institutions: [{ display_name: 'Wayne State University' }],
      works_count: 69,
    }));

    const out = await OpenAlexService.getAuthorByOrcid(VALID_ORCID);

    expect(out).toMatchObject({
      openAlexId: 'https://openalex.org/A5060668110',
      displayName: 'Wen Li',
      orcid: VALID_ORCID,
      lastKnownInstitution: 'Wayne State University',
    });
    // Codex #11: pin the exact URL form — the embedded ORCID URL is NOT percent-encoded.
    const url = safeFetch.mock.calls[0][0];
    expect(url).toContain(`/authors/https://orcid.org/${VALID_ORCID}`);
    expect(url).not.toContain('https%3A%2F%2Forcid.org');
  });

  test('threads the abort signal through to safeFetch (Codex #10)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ id: 'A1', display_name: 'X' }));
    const controller = new AbortController();
    await OpenAlexService.getAuthorByOrcid(VALID_ORCID, { signal: controller.signal });
    expect(safeFetch.mock.calls[0][1].signal).toBeTruthy();
  });

  test('tolerates a defensive results[] wrapper (Codex #10)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      results: [{ id: 'https://openalex.org/A1', display_name: 'Wrapped Author' }],
    }));
    const out = await OpenAlexService.getAuthorByOrcid(VALID_ORCID);
    expect(out.openAlexId).toBe('https://openalex.org/A1');
    expect(out.displayName).toBe('Wrapped Author');
  });

  test('returns null on 404 (no OpenAlex record for the ORCID)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({}, 404));
    const out = await OpenAlexService.getAuthorByOrcid(VALID_ORCID);
    expect(out).toBeNull();
  });

  test('returns null for a malformed / checksum-invalid ORCID WITHOUT calling the API', async () => {
    const out = await OpenAlexService.getAuthorByOrcid('1234567'); // wrong shape
    expect(out).toBeNull();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('returns null when the payload has no author id', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 } }));
    const out = await OpenAlexService.getAuthorByOrcid(VALID_ORCID);
    expect(out).toBeNull();
  });

  test('propagates non-404 errors (e.g. abort/timeout)', async () => {
    safeFetch.mockRejectedValue(Object.assign(new Error('boom'), { code: 'openalex_timeout' }));
    await expect(OpenAlexService.getAuthorByOrcid(VALID_ORCID)).rejects.toThrow('boom');
  });
});
