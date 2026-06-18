/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/safe-fetch.js', () => ({
  safeFetch: jest.fn(),
}));

const { safeFetch } = require('../../lib/utils/safe-fetch.js');
const { OpenAlexService, registrableDomainFromUrl, reconstructAbstract } = require('../../lib/services/openalex-service');

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
      lastKnownInstitutionId: null,
      lastKnownInstitutionRor: null,
      hIndex: null,
      i10Index: null,
      citedByCount: null,
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

describe('OpenAlexService.getRichestAuthorByOrcid (S266 — ORCID author-split)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const VALID_ORCID = '0000-0002-1825-0097';

  test('picks the richest entity when an ORCID is split across multiple authors', async () => {
    // The Landsman case: one ORCID → a 139-work record AND a 1-work stub.
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 2 },
      results: [
        { id: 'https://openalex.org/A_STUB', display_name: 'Alexandra Landsman',
          orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 1,
          summary_stats: { h_index: 0 }, cited_by_count: 0 },
        { id: 'https://openalex.org/A_FULL', display_name: 'Alexandra S. Landsman',
          orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 139,
          summary_stats: { h_index: 25 }, cited_by_count: 4200 },
      ],
    }));

    const out = await OpenAlexService.getRichestAuthorByOrcid(VALID_ORCID);
    expect(out.openAlexId).toBe('https://openalex.org/A_FULL');
    expect(out.worksCount).toBe(139);
    expect(out.hIndex).toBe(25);
    expect(out.orcid).toBe(VALID_ORCID);
    // Uses the LIST/filter form, not the single-object path form.
    const url = safeFetch.mock.calls[0][0];
    expect(url).toContain(`filter=orcid%3A${VALID_ORCID}`);
    expect(url).not.toContain('/authors/https://orcid.org/');
  });

  test('tiebreaks on h-index then citations when works_count ties', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      results: [
        { id: 'https://openalex.org/A1', orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 10, summary_stats: { h_index: 5 }, cited_by_count: 100 },
        { id: 'https://openalex.org/A2', orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 10, summary_stats: { h_index: 9 }, cited_by_count: 50 },
      ],
    }));
    const out = await OpenAlexService.getRichestAuthorByOrcid(VALID_ORCID);
    expect(out.openAlexId).toBe('https://openalex.org/A2'); // higher h-index wins the tie
  });

  test('falls back to the canonical single-entity lookup when the list form is empty', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ meta: { count: 0 }, results: [] })) // list form: empty
      .mockResolvedValueOnce(jsonResponse({ // path-form fallback
        id: 'https://openalex.org/A_ONLY', display_name: 'Solo', orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 42,
      }));
    const out = await OpenAlexService.getRichestAuthorByOrcid(VALID_ORCID);
    expect(out.openAlexId).toBe('https://openalex.org/A_ONLY');
    expect(safeFetch.mock.calls[1][0]).toContain(`/authors/https://orcid.org/${VALID_ORCID}`);
  });

  test('returns null for an invalid ORCID WITHOUT calling the API', async () => {
    const out = await OpenAlexService.getRichestAuthorByOrcid('1234567');
    expect(out).toBeNull();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('threads the abort signal through to safeFetch', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ results: [{ id: 'A1', orcid: `https://orcid.org/${VALID_ORCID}`, works_count: 1 }] }));
    const controller = new AbortController();
    await OpenAlexService.getRichestAuthorByOrcid(VALID_ORCID, { signal: controller.signal });
    expect(safeFetch.mock.calls[0][1].signal).toBeTruthy();
  });
});

describe('mapAuthorRecord — Slice 1b bibliometrics + institution refs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('surfaces h-index / i10 / cites + the institution id & ror', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/A1',
      display_name: 'Metric Author',
      orcid: 'https://orcid.org/0000-0002-1825-0097',
      summary_stats: { h_index: 24, i10_index: 32 },
      cited_by_count: 5577,
      last_known_institutions: [{
        id: 'https://openalex.org/I63966007',
        display_name: 'Massachusetts Institute of Technology',
        ror: 'https://ror.org/042nb2s44',
      }],
      works_count: 100,
    }));

    const out = await OpenAlexService.getAuthorByOrcid('0000-0002-1825-0097');
    expect(out).toMatchObject({
      hIndex: 24,
      i10Index: 32,
      citedByCount: 5577,
      lastKnownInstitution: 'Massachusetts Institute of Technology',
      lastKnownInstitutionId: 'https://openalex.org/I63966007',
      lastKnownInstitutionRor: 'https://ror.org/042nb2s44',
    });
  });

  test('missing summary_stats / cited_by_count → null metrics (never fabricated)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/A2', display_name: 'No Metrics', works_count: 3,
    }));
    const out = await OpenAlexService.getAuthorByOrcid('0000-0002-1825-0097');
    expect(out.hIndex).toBeNull();
    expect(out.i10Index).toBeNull();
    expect(out.citedByCount).toBeNull();
    expect(out.lastKnownInstitutionId).toBeNull();
    expect(out.lastKnownInstitutionRor).toBeNull();
  });
});

describe('OpenAlexService.getAuthorById (Slice 1b)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resolves a short A-id via /authors/I-less path form', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/A777', display_name: 'Spine Author',
      summary_stats: { h_index: 9, i10_index: 4 }, cited_by_count: 123, works_count: 20,
    }));
    const out = await OpenAlexService.getAuthorById('https://openalex.org/A777');
    expect(out).toMatchObject({ openAlexId: 'https://openalex.org/A777', hIndex: 9, citedByCount: 123 });
    expect(safeFetch.mock.calls[0][0]).toContain('/authors/A777');
  });

  test('returns null (no API call) for a non-author id', async () => {
    const out = await OpenAlexService.getAuthorById('I12345'); // institution id, not an author
    expect(out).toBeNull();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('returns null on 404', async () => {
    safeFetch.mockResolvedValue(jsonResponse({}, 404));
    const out = await OpenAlexService.getAuthorById('A999');
    expect(out).toBeNull();
  });
});

describe('OpenAlexService.getInstitution (Slice 1b verified-domain source)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resolves an OpenAlex institution id to its registrable homepage domain', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/I63966007',
      display_name: 'Massachusetts Institute of Technology',
      ror: 'https://ror.org/042nb2s44',
      homepage_url: 'https://web.mit.edu',
    }));
    const out = await OpenAlexService.getInstitution('https://openalex.org/I63966007');
    expect(out).toMatchObject({ displayName: 'Massachusetts Institute of Technology', domain: 'mit.edu' });
    expect(safeFetch.mock.calls[0][0]).toContain('/institutions/I63966007');
  });

  test('falls back to the ROR path form when given a ROR', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      id: 'https://openalex.org/I1', display_name: 'X', homepage_url: 'https://www.ox.ac.uk/',
    }));
    const out = await OpenAlexService.getInstitution('https://ror.org/052gg0110');
    expect(out.domain).toBe('ox.ac.uk'); // multi-label suffix handled (not ac.uk)
    expect(safeFetch.mock.calls[0][0]).toContain('/institutions/https://ror.org/052gg0110');
  });

  test('null homepage → null domain; 404 → null; empty input → null (no call)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ id: 'https://openalex.org/I2', display_name: 'Y' }));
    expect((await OpenAlexService.getInstitution('I2')).domain).toBeNull();

    safeFetch.mockResolvedValue(jsonResponse({}, 404));
    expect(await OpenAlexService.getInstitution('I3')).toBeNull();

    safeFetch.mockClear();
    expect(await OpenAlexService.getInstitution('')).toBeNull();
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

describe('OpenAlexService.searchWorks (Slice 2 — novelty literature)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('searches works, applies the recency filter, and maps abstract + cites', async () => {
    safeFetch.mockResolvedValue(jsonResponse({
      meta: { count: 1 },
      results: [{
        id: 'https://openalex.org/W1',
        display_name: 'A novel result',
        publication_year: 2024,
        cited_by_count: 17,
        abstract_inverted_index: { We: [0], show: [1], novelty: [2] },
        authorships: [{ author: { id: 'A1', display_name: 'Jane Roe' } }],
      }],
    }));

    const out = await OpenAlexService.searchWorks('novel topic', { yearFrom: 2021, limit: 5 });

    expect(out.totalCount).toBe(1);
    expect(out.records[0]).toMatchObject({
      title: 'A novel result',
      year: 2024,
      citedByCount: 17,
      abstract: 'We show novelty',
    });
    const url = safeFetch.mock.calls[0][0];
    expect(url).toMatch(/search=novel\+topic/);
    expect(url).toMatch(/filter=from_publication_date%3A2021-01-01/);
  });

  test('empty query → no API call', async () => {
    const out = await OpenAlexService.searchWorks('   ');
    expect(out).toEqual({ totalCount: 0, records: [] });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('omits the recency filter when yearFrom is not an integer', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 }, results: [] }));
    await OpenAlexService.searchWorks('q', {});
    expect(safeFetch.mock.calls[0][0]).not.toMatch(/from_publication_date/);
  });
});

describe('OpenAlexService.getWorksByAuthor — yearFrom recency filter (Slice 2)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ANDs from_publication_date into the author filter when yearFrom is given', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 }, results: [] }));
    await OpenAlexService.getWorksByAuthor('https://openalex.org/A1', { yearFrom: 2020, limit: 15 });
    const url = safeFetch.mock.calls[0][0];
    expect(url).toMatch(/filter=author\.id%3AA1%2Cfrom_publication_date%3A2020-01-01/);
  });

  test('omits the recency filter when yearFrom is absent (spine rescue path unchanged)', async () => {
    safeFetch.mockResolvedValue(jsonResponse({ meta: { count: 0 }, results: [] }));
    await OpenAlexService.getWorksByAuthor('A1');
    const url = safeFetch.mock.calls[0][0];
    expect(url).toMatch(/filter=author\.id%3AA1(&|$)/);
    expect(url).not.toMatch(/from_publication_date/);
  });
});

describe('reconstructAbstract — OpenAlex inverted-index → text', () => {
  test('places tokens at their positions and joins', () => {
    expect(reconstructAbstract({ The: [0], quick: [1], brown: [2], fox: [3] })).toBe('The quick brown fox');
    // repeated token at multiple positions
    expect(reconstructAbstract({ a: [0, 2], b: [1] })).toBe('a b a');
  });

  test('null / non-object / empty → null', () => {
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract([])).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });
});

describe('registrableDomainFromUrl — eTLD+1 extraction for the email-domain guard', () => {
  test('strips scheme/path and a www. subdomain to the registrable domain', () => {
    expect(registrableDomainFromUrl('https://web.mit.edu')).toBe('mit.edu');
    expect(registrableDomainFromUrl('https://www.stanford.edu/dept')).toBe('stanford.edu');
    expect(registrableDomainFromUrl('http://mbi-berlin.de')).toBe('mbi-berlin.de');
  });

  test('handles multi-label academic suffixes (last THREE labels)', () => {
    expect(registrableDomainFromUrl('https://www.ox.ac.uk/')).toBe('ox.ac.uk');
    expect(registrableDomainFromUrl('https://research.unimelb.edu.au')).toBe('unimelb.edu.au');
  });

  test('uses the full PSL — no over-broad eTLD for any educational suffix (Codex S251)', () => {
    // edu.ph (1st pass) and school.ge (3rd pass) were both missing from the old hand-rolled
    // set, wrongly returning the bare suffix and letting `anyone@x.<suffix>` match. psl.get
    // returns the true eTLD+1 for both.
    expect(registrableDomainFromUrl('https://www.university.edu.ph')).toBe('university.edu.ph');
    expect(registrableDomainFromUrl('https://www.alpha.school.ge')).toBe('alpha.school.ge');
  });

  test('fails CLOSED (null) on a bare public suffix (no registrable label) or IP literal', () => {
    expect(registrableDomainFromUrl('https://edu.ph')).toBeNull();
    expect(registrableDomainFromUrl('https://ac.uk')).toBeNull();
    expect(registrableDomainFromUrl('https://school.ge')).toBeNull();
    expect(registrableDomainFromUrl('https://127.0.0.1')).toBeNull(); // psl quirk guarded
  });

  test('keeps a normal two-label registrable under a 2-letter ccTLD', () => {
    expect(registrableDomainFromUrl('https://phys.ethz.ch')).toBe('ethz.ch');
    expect(registrableDomainFromUrl('https://uni-frankfurt.de')).toBe('uni-frankfurt.de');
  });

  test('null/empty/host-less input → null', () => {
    expect(registrableDomainFromUrl(null)).toBeNull();
    expect(registrableDomainFromUrl('')).toBeNull();
    expect(registrableDomainFromUrl('https://localhost')).toBeNull();
  });
});
