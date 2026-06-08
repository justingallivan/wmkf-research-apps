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

  test('throws on source outage after retry so adapter can abstain', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503));

    await expect(OpenAlexService.searchAuthors('Robert Sang')).rejects.toThrow(/OpenAlex request failed/);
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });
});
