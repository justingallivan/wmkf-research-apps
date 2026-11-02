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
  expect(result.sourceCoverageVersion).toBe(2);
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

const recordedEmpty = require('../fixtures/serpapi/zero-result-2026-10-01.json');
const serve = (body) => global.fetch.mockResolvedValue({ ok: true, json: async () => body });

describe.each(['google', 'google_news'])('recorded live %s zero-result response', (engine) => {
  const recorded = () => JSON.parse(JSON.stringify(recordedEmpty[engine]));
  const stateField = engine === 'google_news' ? 'news_results_state' : 'organic_results_state';
  const search = () => IntegrityService.serpSearch('fixture', 'fixture', 10, engine, strict);

  test('is a complete empty search', async () => {
    serve(recorded());
    await expect(search()).resolves.toEqual([]);
  });

  test('stays empty when the vendor rewords the message', async () => {
    serve({ ...recorded(), error: 'No results were found for this query.' });
    await expect(search()).resolves.toEqual([]);
  });

  test('stays empty when the vendor drops the structured state but keeps the message', async () => {
    const body = recorded();
    delete body.search_information[stateField];
    serve(body);
    await expect(search()).resolves.toEqual([]);
  });

  test('fails closed when both empty signals are gone', async () => {
    const body = recorded();
    delete body.search_information[stateField];
    serve({ ...body, error: 'No results were found for this query.' });
    await expect(search()).rejects.toThrow();
  });

  test('fails closed on an error that comes with results', async () => {
    const field = engine === 'google_news' ? 'news_results' : 'organic_results';
    serve({ ...recorded(), [field]: [{ title: 'Hit', link: 'https://example.org/hit' }] });
    await expect(search()).rejects.toThrow();
  });

  test('fails closed when the search itself did not succeed', async () => {
    serve({ ...recorded(), search_metadata: { status: 'Error' }, error: 'Your account has run out of searches.' });
    await expect(search()).rejects.toThrow();
  });
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
])('strict screening stops before any paid call when Retraction Watch corpus is unavailable: %s', async (_label, outcome) => {
  mockSql.mockReset();
  if (outcome instanceof Error) mockSql.mockRejectedValue(outcome);
  else mockSql.mockResolvedValue(outcome);
  await expect(screen()).rejects.toMatchObject({ code: 'retraction_corpus_unavailable' });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockComplete).not.toHaveBeenCalled();
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
    search_metadata: { status: 'Success' }, [new URL(url).searchParams.get('engine') === 'google_news' ? 'news_results' : 'organic_results']: [{ title: 'Fixture', link: new URL(url).searchParams.get('engine') === 'google_news' ? 'https://example.org' : 'https://pubpeer.com/publications/fixture' }],
  }) }));
  mockComplete.mockRejectedValue(new Error('provider unavailable'));
  const result = await screen();
  expect(result.sources.pubpeer.error).toBe('Search result analysis failed');
  expect(result.sources.news.error).toBe('Search result analysis failed');
});

test('strict search requests carry a timeout; standalone requests are unchanged', async () => {
  await IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict);
  expect(global.fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  global.fetch.mockClear();
  await IntegrityService.serpSearch('fixture', 'fixture');
  expect(global.fetch.mock.calls[0]).toHaveLength(1);
});

test('strict run cancellation reaches both SERP fetch and Haiku completion', async () => {
  const searchController = new AbortController();
  await IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', {
    ...strict,
    signal: searchController.signal,
    deadlineAt: Date.now() + 60_000,
  });
  const fetchSignal = global.fetch.mock.calls[0][1]?.signal;
  expect(fetchSignal).toBeInstanceOf(AbortSignal);
  searchController.abort(new Error('run deadline'));
  expect(fetchSignal.aborted).toBe(true);
  expect(fetchSignal.reason).toBe(searchController.signal.reason);

  const llmController = new AbortController();
  await IntegrityService.analyzeWithHaiku(
    [{ title: 'Fixture', link: 'https://example.org', snippet: '' }],
    'Fixture',
    'fixture',
    { ...strict, signal: llmController.signal, deadlineAt: Date.now() + 60_000 },
  );
  expect(mockComplete.mock.calls[0][0].signal).toBe(llmController.signal);
});

test('strict mode keeps specific source-failure messages and names a timeout', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 429, statusText: 'quota' });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict)).rejects.toThrow('Search provider request failed');
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, organic_results: [{ title: 'Missing link' }] }) });
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict)).rejects.toThrow('Search provider returned unusable results');
  global.fetch.mockRejectedValue(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict)).rejects.toThrow('Search provider timed out');
  global.fetch.mockRejectedValue(new Error('socket hang up at 10.0.0.1'));
  await expect(IntegrityService.serpSearch('fixture', 'fixture', 10, 'google', strict)).rejects.toThrow(/^Search provider search failed$/);
  mockComplete.mockResolvedValue({ text: '   ' });
  await expect(IntegrityService.analyzeWithHaiku([{ title: 'Fixture', link: 'https://example.org', snippet: '' }], 'Fixture', 'fixture', strict))
    .rejects.toThrow('Invalid response from Claude API');
});

describe('PubPeer source identity validation (both callers)', () => {
  const pubpeer = (link) => ({ title: 'Discussion', link, snippet: 'Image concern on a publication' });
  const response = (items) => ({ ok: true, json: async () => ({ search_metadata: { status: 'Success' }, organic_results: items }) });
  test.each([
    'https://example.org/person', 'https://pubpeer.com.evil.org/publications/a',
    'https://pubpeer.com@evil.org/a', 'https://user@pubpeer.com/publications/a',
    'http://pubpeer.com/publications/a', 'https://pubpeer.com:8443/publications/a',
  ])('rejects off-domain or unsafe URL before analysis: %s', async (link) => {
    global.fetch.mockResolvedValue(response([pubpeer(link)]));
    await expect(IntegrityService.searchPubPeer('Ada Example', '', 'fixture', 'fixture'))
      .rejects.toMatchObject({ excludedResultCount: 1 });
    expect(mockComplete).not.toHaveBeenCalled();
  });
  test('mixed results and an invalid narrow response cannot pass validation', async () => {
    global.fetch.mockResolvedValueOnce(response([pubpeer('https://pubpeer.com/publications/a')]))
      .mockResolvedValueOnce(response([pubpeer('https://example.org/a'), pubpeer('https://pubpeer.com/publications/a')]));
    await expect(IntegrityService.searchPubPeer('Ada Example', 'Example University', 'fixture', 'fixture')).rejects.toThrow('unrelated sources');
    expect(mockComplete).not.toHaveBeenCalled();
  });
  test('valid URLs are analyzed, deduplicated and versioned', async () => {
    global.fetch.mockResolvedValue(response([pubpeer('https://pubpeer.com/publications/a')]));
    const result = await IntegrityService.searchPubPeer('Ada Example', 'Example University', 'fixture', 'fixture');
    expect(result).toMatchObject({ sourceValidationVersion: 2, resultCount: 1, hasConcerns: false });
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
  test('standalone HTTP failure cannot become a successful empty search', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(IntegrityService.searchPubPeer('Ada Example', '', 'fixture', 'fixture')).rejects.toThrow('Search provider request failed');
  });
  test('accepted empty responses use indexed-search wording', async () => {
    const result = await IntegrityService.searchPubPeer('Ada Example', '', 'fixture', 'fixture');
    expect(result).toMatchObject({ sourceValidationVersion: 2, resultCount: 0 });
    expect(result.summary).toContain('not a direct search');
  });
});

test('engine excludes the reported conflicting authors and keeps namesakes unverified', async () => {
  const rows = [{ record_id: 'fixture-1', authors: 'Robert A Leung', title: 'Unrelated paper' },
    { record_id: 'fixture-2', authors: 'Aileen M Bailey', title: 'Another unrelated paper' },
    { record_id: 'fixture-3', authors: 'He, Yuan', title: 'Possible namesake paper' }];
  mockSql.mockImplementation((parts) => Promise.resolve({ rows: parts.join('?').includes('SELECT EXISTS') ? [{ available: true }] : rows }));
  let complete;
  for await (const e of IntegrityService.screenApplicants([{ name: 'Anthony Leung' }, { name: 'Scott Bailey' }, { name: 'Yuan He' }], 'fixture', 'fixture', null, strict)) {
    if (e.type === 'complete') complete = e;
  }
  expect(complete.results.map((r) => r.matchCount)).toEqual([0, 0, 1]);
  expect(complete.results[2].sources.retraction_watch.matches[0]).not.toHaveProperty('confidenceLevel');
  expect(complete.results[2].sources.retraction_watch.matches[0]).toMatchObject({ matchedAuthor: 'He, Yuan', identityStatus: 'unverified', matchingVersion: 2 });
});

test('actual retrieval terms fetch the raw all-caps surname before matching', async () => {
  // Unlike earlier engine fixtures, use the actual builders: a matcher-only
  // test cannot catch a candidate that the indexed lookup never retrieved.
  IntegrityMatchingService.buildDatabaseSearchTerms.mockRestore();
  IntegrityMatchingService.buildTextSearchPatterns.mockRestore();
  mockSql.mockImplementation((parts, term) => Promise.resolve({ rows:
    parts.join('?').includes('authors_normalized') && term === 'li wei'
      ? [{ record_id: 'raw-surname', authors: 'Li Wei', title: 'Retrieved by raw name term' }] : [],
  }));
  const matches = await IntegrityService.searchRetractionWatch('LI Wei', '', strict);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ matchedAuthor: 'Li Wei', identityStatus: 'unverified' });
});
