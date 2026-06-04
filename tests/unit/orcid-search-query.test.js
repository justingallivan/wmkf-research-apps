/**
 * @jest-environment node
 *
 * ORCID expanded-search SOLR-query sanitization (S215 residual). Operator
 * characters in a reviewer name (a hyphen in "Li-Huei", parentheses, quotes,
 * colons) used to be interpolated raw into the Lucene query and 500 ORCID's
 * parser. Locks: every interpolated value is escaped, the wildcards we append
 * survive, and an empty name abstains without an API round trip.
 *
 * Note: jest.setup.js installs a shared `global.fetch = jest.fn()` cleared in a
 * global beforeEach — we CONFIGURE it (never replace/delete it, which would
 * break the harness's mockClear on the next test).
 */
const { ORCIDService } = require('../../lib/services/orcid-service.js');

afterEach(() => {
  jest.restoreAllMocks();
  // restoreAllMocks() clears spies but NOT the shared global.fetch jest.fn's
  // resolved-value impl (jest.setup.js only mockClear()s it per test) — reset it
  // so a configured response can't leak into a later test in this file (Codex
  // S217 #6). Keep global.fetch itself as the shared mock.
  if (global.fetch?.mockReset) global.fetch.mockReset();
});

function mockSearch(resultRows = []) {
  jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ 'expanded-result': resultRows }),
  });
  return global.fetch;
}

const qOf = (fetchMock) =>
  decodeURIComponent(new URL(fetchMock.mock.calls[0][0]).searchParams.get('q'));

describe('ORCIDService.escapeSolrValue', () => {
  test('escapes Lucene operator characters', () => {
    expect(ORCIDService.escapeSolrValue('Li-Huei')).toBe('Li\\-Huei');
    expect(ORCIDService.escapeSolrValue('O(Brien)')).toBe('O\\(Brien\\)');
    expect(ORCIDService.escapeSolrValue('A:B')).toBe('A\\:B');
    expect(ORCIDService.escapeSolrValue('a"b')).toBe('a\\"b');
    expect(ORCIDService.escapeSolrValue('x&y|z')).toBe('x\\&y\\|z');
    expect(ORCIDService.escapeSolrValue('a*b?')).toBe('a\\*b\\?');
    expect(ORCIDService.escapeSolrValue('Jane <x@y>')).toBe('Jane \\<x@y\\>');
  });

  test('leaves ordinary + unicode names untouched, handles null/blank', () => {
    expect(ORCIDService.escapeSolrValue('Smith')).toBe('Smith');
    expect(ORCIDService.escapeSolrValue('José')).toBe('José');
    expect(ORCIDService.escapeSolrValue(null)).toBe('');
    expect(ORCIDService.escapeSolrValue(undefined)).toBe('');
    expect(ORCIDService.escapeSolrValue('  Wu  ')).toBe('Wu');
  });
});

describe('ORCIDService.searchByName — query sanitization', () => {
  test('hyphenated first name is escaped (the 500 repro)', async () => {
    const fetchMock = mockSearch();
    await ORCIDService.searchByName({ name: 'Li-Huei Tsai', clientId: 'x', clientSecret: 'y' });
    expect(qOf(fetchMock)).toBe('given-names:Li\\-Huei* AND family-name:Tsai*');
  });

  test('parenthesized single name + affiliation special chars are escaped', async () => {
    const fetchMock = mockSearch();
    await ORCIDService.searchByName({ name: 'O(Brien)', affiliation: 'Texas A&M University', clientId: 'x', clientSecret: 'y' });
    const q = qOf(fetchMock);
    expect(q).toContain('given-names:O\\(Brien\\)*');
    expect(q).toContain('family-name:O\\(Brien\\)*');
    expect(q).toContain('affiliation-org-name:*Texas A\\&M University*');
  });

  test('appended wildcards survive escaping (still a prefix search)', async () => {
    const fetchMock = mockSearch();
    await ORCIDService.searchByName({ name: 'Jane Smith', clientId: 'x', clientSecret: 'y' });
    expect(qOf(fetchMock)).toBe('given-names:Jane* AND family-name:Smith*');
  });

  test('email-shaped junk token is escaped, not interpolated raw', async () => {
    const fetchMock = mockSearch();
    await ORCIDService.searchByName({ name: 'Jane <jane@x.edu>', clientId: 'x', clientSecret: 'y' });
    const q = qOf(fetchMock);
    expect(q).toBe('given-names:Jane* AND family-name:\\<jane@x.edu\\>*');
    expect(q).not.toMatch(/family-name:<jane/);  // raw angle bracket never reaches SOLR
  });

  test('empty / whitespace name abstains — no token fetch, no API call', async () => {
    const tokenSpy = jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
    const out = await ORCIDService.searchByName({ name: '   ', clientId: 'x', clientSecret: 'y' });
    expect(out).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(tokenSpy).not.toHaveBeenCalled();
  });

  test('punctuation-only name abstains (no searchable token)', async () => {
    const tokenSpy = jest.spyOn(ORCIDService, 'getAccessToken').mockResolvedValue('tok');
    const out = await ORCIDService.searchByName({ name: '()  -', clientId: 'x', clientSecret: 'y' });
    expect(out).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(tokenSpy).not.toHaveBeenCalled();
  });
});
