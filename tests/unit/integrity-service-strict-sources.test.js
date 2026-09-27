/** @jest-environment node */
const mockSql = jest.fn();
const mockComplete = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
jest.mock('../../lib/services/llm-client.js', () => ({ LLMClient: jest.fn().mockImplementation(() => ({ complete: mockComplete })) }));
const { IntegrityService } = require('../../lib/services/integrity-service');
const { IntegrityMatchingService } = require('../../lib/services/integrity-matching-service');
const strict = { strictSourceErrors: true };
const emptyResponse = (url) => ({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, [new URL(url).searchParams.get('engine') === 'google_news' ? 'news_results' : 'organic_results']: [] }) });
const originalFetch = global.fetch;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(IntegrityMatchingService, 'buildDatabaseSearchTerms').mockReturnValue(['example']);
  jest.spyOn(IntegrityMatchingService, 'buildTextSearchPatterns').mockReturnValue(['%example%']);
  mockSql.mockReset().mockImplementation((parts) => {
    const query = Array.isArray(parts) ? parts.join('?') : String(parts);
    return Promise.resolve({ rows: query.includes('SELECT EXISTS') ? [{ available: true }] : [] });
  });
  mockComplete.mockReset().mockResolvedValue({ text: 'No concerns found.' });
  global.fetch = jest.fn().mockImplementation(emptyResponse);
});
afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

async function screen(options = strict) {
  let complete;
  for await (const event of IntegrityService.screenApplicants([{ name: 'Ada Example', institution: 'Example University' }], 'fixture-claude', 'fixture-serp', null, options)) {
    if (event.type === 'complete') complete = event;
  }
  return complete.results[0];
}

test('strict source coverage is explicit and successful empty searches are complete', async () => {
  const result = await screen();
  expect(result.sourceCoverageVersion).toBe(1);
  expect(Object.keys(result.sources)).toHaveLength(3);
  for (const source of Object.values(result.sources)) expect(source).toMatchObject({ searched: true, error: null });
  expect(global.fetch).toHaveBeenCalledTimes(4);
  expect(mockSql.mock.calls.filter(([parts]) => parts.join('?').includes('SELECT EXISTS'))).toHaveLength(1);
  expect(mockComplete).not.toHaveBeenCalled();
  expect((await screen({})).sourceCoverageVersion).toBeUndefined();
  expect(mockSql.mock.calls.filter(([parts]) => parts.join('?').includes('SELECT EXISTS'))).toHaveLength(1);
});

test.each([
  ['HTTP 429', () => ({ ok: false, status: 429, statusText: 'quota' })],
  ['network rejection', () => Promise.reject(new Error('network failure'))],
  ['invalid JSON', () => ({ ok: true, json: async () => { throw new Error('parse'); } })],
  ['API error over HTTP 200', () => ({ ok: true, json: async () => ({ error: 'quota exhausted' }) })],
  ['unknown response', () => ({ ok: true, json: async () => ({}) })],
  ['malformed results', () => ({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, organic_results: {} }) })],
])('%s remains an exposed source failure in strict screening', async (_label, response) => {
  global.fetch.mockImplementation(response);
  const result = await screen();
  expect(result.sources.pubpeer.error).toBeTruthy();
  expect(result.sources.news.error).toBeTruthy();
  expect(result.sources.retraction_watch.error).toBeNull();
});

test('a failed narrow search is not masked by a successful broad search', async () => {
  global.fetch.mockImplementation(emptyResponse).mockImplementationOnce(emptyResponse)
    .mockImplementationOnce(() => ({ ok: false, status: 500 }));
  expect((await screen()).sources.pubpeer.error).toBeTruthy();
});

test.each(['organic_results_state', 'news_results_state'])('documented successful empty %s is not an outage', async (field) => {
  const news = field === 'news_results_state';
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({
    search_metadata: { status: 'Success' }, search_information: { [field]: 'Fully empty' },
    error: `${news ? 'Google News' : 'Google'} hasn't returned any results for this query.`,
  }) });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, news ? 'google_news' : 'google', strict)).resolves.toEqual([]);
});

test.each(['google', 'google_news'])('wrong-engine results cannot confirm %s source coverage', async (engine) => {
  const wrongField = engine === 'google' ? 'news_results' : 'organic_results';
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, [wrongField]: [] }) });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, engine, strict)).rejects.toThrow();
});

test.each([{}, { title: 'Missing link' }, { title: 'Bad link', link: 'javascript:alert(1)' }])('unusable individual results cannot confirm coverage: %j', async (item) => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, organic_results: [item] }) });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict)).rejects.toThrow();
});

test('strict news search retains grouped highlight and story articles', async () => {
  const article = { title: 'First article', link: 'https://example.org/first' };
  const story = { title: 'Second article', link: 'https://example.org/second' };
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, news_results: [{ highlight: article, stories: [story] }] }) });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google_news', strict)).resolves.toMatchObject([article, story]);
});

test('strict mode checks corpus availability once for a multi-person screen', async () => {
  const applicants = [
    { name: 'Ada Example', institution: 'Example University' },
    { name: 'Bea Example', institution: 'Another University' },
  ];
  for await (const _event of IntegrityService.screenApplicants(applicants, 'fixture-claude', 'fixture-serp', null, strict)) { /* consume */ }
  expect(mockSql.mock.calls.filter(([parts]) => parts.join('?').includes('SELECT EXISTS'))).toHaveLength(1);
});

test.each([
  ['empty corpus', { rows: [{ available: false }] }],
  ['missing health result', { rows: [] }],
  ['health query failure', new Error('database unavailable')],
])('strict screening fails closed when Retraction Watch corpus is unavailable: %s', async (_label, outcome) => {
  mockSql.mockReset();
  if (outcome instanceof Error) mockSql.mockRejectedValue(outcome);
  else mockSql.mockResolvedValue(outcome);
  const result = await screen();
  expect(result.sources.retraction_watch).toMatchObject({
    searched: true, matches: [], error: 'Retraction Watch corpus unavailable',
  });
  expect(mockSql).toHaveBeenCalledTimes(1);
  expect(mockSql.mock.calls[0][0].join('?')).toContain('SELECT EXISTS');
});

test.each([1, 2])('Retraction Watch query failure at query %i cannot become clean empty results', async (query) => {
  mockSql.mockResolvedValueOnce({ rows: [{ available: true }] });
  if (query === 2) mockSql.mockResolvedValueOnce({ rows: [] });
  mockSql.mockRejectedValueOnce(new Error('database unavailable'));
  const result = await screen();
  expect(result.sources.retraction_watch.error).toBe('Retraction Watch query failed');
});

test('legacy defaults retain fail-soft search and analysis behavior', async () => {
  global.fetch.mockRejectedValue(new Error('offline'));
  await expect(IntegrityService.serpSearch('fixture', 'fixture')).resolves.toEqual([]);
  mockSql.mockRejectedValue(new Error('offline'));
  await expect(IntegrityService.searchRetractionWatch('Ada Example', '')).resolves.toEqual([]);
  mockComplete.mockRejectedValue(new Error('offline'));
  await expect(IntegrityService.analyzeWithHaiku([{ title: 'Fixture', link: 'https://example.org' }], 'Fixture', 'fixture'))
    .resolves.toMatch(/^Unable to analyze search results:/);
});

test('strict summary failure is exposed by the generator and cannot be approved as complete', async () => {
  global.fetch.mockImplementation((url) => ({ ok: true, json: async () => ({
    search_metadata: { status: 'Success' }, [new URL(url).searchParams.get('engine') === 'google_news' ? 'news_results' : 'organic_results']: [{ title: 'Fixture', link: 'https://example.org' }],
  }) }));
  mockComplete.mockRejectedValue(new Error('provider unavailable'));
  const result = await screen();
  expect(result.sources.pubpeer.error).toBe('Search result analysis failed');
  expect(result.sources.news.error).toBe('Search result analysis failed');
});
