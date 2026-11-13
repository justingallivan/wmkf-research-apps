/** @jest-environment node */
const mockSql = jest.fn();
const mockComplete = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (...args) => mockSql(...args) }));
jest.mock('../../lib/services/llm-client.js', () => ({ LLMClient: jest.fn().mockImplementation(() => ({ complete: mockComplete })) }));
const { IntegrityService } = require('../../lib/services/integrity-service');
const { saveJ27IntegrityRun } = require('../../lib/services/workbench/j27-integrity-jobs');
const { integrityIncomplete } = require('../../shared/utils/integrity-evidence');
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
    return Promise.resolve({ rows: query.includes('SELECT EXISTS') ? [{ available: true }] : query.includes('to_regclass') ? [{ relation: null }] : [] });
  });
  mockComplete.mockReset().mockResolvedValue({ text: '{"outcome":"clear","findings":[]}' });
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
  expect(result.sourceCoverageVersion).toBe(3);
  expect(Object.keys(result.sources)).toHaveLength(3);
  for (const source of [result.sources.retraction_watch, result.sources.news]) expect(source).toMatchObject({ searched: true, error: null });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(mockSql.mock.calls.filter(([parts]) => parts.join('?').includes('SELECT EXISTS'))).toHaveLength(1);
  expect(mockComplete).not.toHaveBeenCalled();
  expect((await screen({})).sourceCoverageVersion).toBe(3);
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
  expect(result.sources.pubpeer).toMatchObject({ mode: 'manual', searched: false, error: null });
  expect(result.sources.news.error).toBeTruthy();
  expect(result.sources.retraction_watch.error).toBeNull();
});

test('a failed narrow search is not masked by a successful broad search', async () => {
  global.fetch.mockImplementation(emptyResponse).mockImplementationOnce(emptyResponse)
    .mockImplementationOnce(() => ({ ok: false, status: 500 }));
  expect((await screen()).sources.news.error).toBeTruthy();
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
  let corpusQueries = 0;
  mockSql.mockImplementation((parts) => {
    const text = parts.join('?');
    if (text.includes('SELECT EXISTS')) return Promise.resolve({ rows: [{ available: true }] });
    if (text.includes('to_regclass')) return Promise.resolve({ rows: [{ relation: null }] });
    if (++corpusQueries === query) return Promise.reject(new Error('database unavailable'));
    return Promise.resolve({ rows: [] });
  });
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
  expect(result.sources.pubpeer).toMatchObject({ mode: 'manual', searched: false, error: null });
  expect(result.sources.news.error).toBe('Search result analysis failed');
});

const allegation = {
  title: 'Example University opens an inquiry into grant spending',
  link: 'https://example.org/inquiry',
  snippet: 'Ada Example, a materials scientist at Example University, was accused of diverting grant funds. A separate earlier audit said no concerns found.',
};
const citedAllegation = {
  sourceIndex: 1,
  kind: 'allegation',
  identityEvidence: 'a materials scientist at Example University',
  conductEvidence: 'was accused of diverting grant funds',
};
const mockNews = items => global.fetch.mockResolvedValue({ ok: true, json: async () => ({
  search_metadata: { status: 'Success' }, news_results: items,
}) });
const modelNews = (outcome, findings = []) => mockComplete.mockResolvedValue({
  text: JSON.stringify({ outcome, findings }),
});
async function expectAlertFlag(result, expected) {
  await saveJ27IntegrityRun({
    target_host: 'sandbox.example', request_id: '11111111-1111-4111-8111-111111111111',
    lease_token: '22222222-2222-4222-8222-222222222222',
  }, { screenedPeople: [], results: [result], matchCount: result.matchCount });
  const [parts, ...values] = mockSql.mock.calls.at(-1);
  expect(parts.findIndex(part => part.includes('flagged = '))).toBeGreaterThanOrEqual(0);
  expect(values[parts.findIndex(part => part.includes('flagged = '))]).toBe(expected);
}

test('a grounded allegation survives old clear wording and carries its original citation into an alert', async () => {
  const unrelated = Array.from({ length: 5 }, (_, i) => ({
    title: 'Routine academic news', link: `https://example.org/routine-${i}`,
  }));
  mockNews([...unrelated, allegation]);
  modelNews('flag_for_review', [{ ...citedAllegation, sourceIndex: 6 }]);
  const result = await screen();
  expect(result.sources.news).toMatchObject({ analysisOutcome: 'flag_for_review', hasConcerns: true,
    rawResults: [{ link: allegation.link }], error: null });
  expect(result.sources.news.summary).toContain('Reported allegation: “was accused of diverting grant funds”');
  expect(result.sources.news.summary).toContain('Identity evidence: “a materials scientist at Example University”');
  expect(mockComplete.mock.calls[0][0].system).toContain('A shared name is insufficient.');
  expect(mockComplete.mock.calls[0][0].outputConfig.format).toMatchObject({
    type: 'json_schema',
    schema: { properties: { outcome: { enum: ['flag_for_review', 'clear', 'inconclusive'] } } },
  });
  expect(mockComplete.mock.calls[0][0].messages[0].content).toContain('[6] Example University opens an inquiry');
  expect(result.matchCount).toBe(1);
  await expectAlertFlag(result, true);
});

test.each([
  ['a namesake', 'Ada Example, a different person at Other College, faces a disciplinary inquiry.'],
  ['routine academic news', 'Example University awarded a teaching prize to Ada Example.'],
])('%s with a clear analysis has no findings alert', async (_label, snippet) => {
  mockNews([{ ...allegation, snippet }]);
  modelNews('clear');
  const result = await screen();
  expect(result.sources.news).toMatchObject({ analysisOutcome: 'clear', hasConcerns: false, error: null });
  expect(integrityIncomplete(result)).toBe(false);
  await expectAlertFlag(result, false);
});

test.each([
  ['inconclusive identity', () => modelNews('inconclusive')],
  ['contradictory clear output with findings', () => modelNews('clear', [citedAllegation])],
  ['a name alone', () => modelNews('flag_for_review', [{ ...citedAllegation, identityEvidence: 'Ada Example' }])],
  ['invented identity evidence', () => modelNews('flag_for_review', [{ ...citedAllegation, identityEvidence: 'a professor at Unrelated Institute' }])],
  ['invented conduct evidence', () => modelNews('flag_for_review', [{ ...citedAllegation, conductEvidence: 'was convicted of fraud' }])],
  ['a nonexistent citation', () => modelNews('flag_for_review', [{ ...citedAllegation, sourceIndex: 2 }])],
  ['unexpected prose', () => mockComplete.mockResolvedValue({ text: 'Nothing of concern was identified.' })],
  ['fenced JSON followed by extra prose', () => mockComplete.mockResolvedValue({
    text: '```json\n{"outcome":"clear","findings":[]}\n```\nAn extra explanation.',
  })],
])('%s is incomplete and produces no news finding', async (_label, response) => {
  mockNews([allegation]);
  response();
  const result = await screen();
  expect(result.sources.news).toMatchObject({ analysisOutcome: 'inconclusive', hasConcerns: false, error: expect.any(String) });
  expect(integrityIncomplete(result)).toBe(true);
  await expectAlertFlag(result, false);
});

test('a single fenced JSON value still passes evidence checks for legacy model overrides', async () => {
  mockNews([allegation]);
  mockComplete.mockResolvedValue({ text: '```json\n{"outcome":"inconclusive","findings":[]}\n```' });
  const result = await screen();
  expect(result.sources.news).toMatchObject({
    analysisOutcome: 'inconclusive', error: 'The available news evidence was inconclusive.',
  });
});

test.each([strict, {}])('a search outage stays incomplete in either caller (%j)', async options => {
  global.fetch.mockResolvedValue({ ok: false, status: 503 });
  const result = await screen(options);
  expect(result.sources.news).toMatchObject({ analysisOutcome: 'inconclusive', hasConcerns: false, error: expect.any(String) });
  expect(mockComplete).not.toHaveBeenCalled();
  await expectAlertFlag(result, false);
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

test.each([strict, {}])('PubPeer never triggers search or analysis in either caller (%j)', async (options) => {
  const r = await screen(options);
  expect(r.sources.pubpeer).toMatchObject({ mode: 'manual', searched: false, error: null,
    searchUrl: 'https://pubpeer.com/search?q=Ada%20Example' });
  expect(r.sources.pubpeer.summary).toContain('No manual check is recorded');
  expect(r.sources.pubpeer).not.toHaveProperty('hasConcerns');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  for (const [url] of global.fetch.mock.calls) {
    const params = new URL(url).searchParams;
    expect(params.get('engine')).toBe('google_news');
    expect(params.get('q')).not.toContain('site:pubpeer.com');
  }
  expect(mockComplete).not.toHaveBeenCalled();
  expect(IntegrityService.searchPubPeer).toBeUndefined();
});

test('engine excludes the reported conflicting authors and keeps namesakes unverified', async () => {
  const rows = [{ record_id: 'fixture-1', authors: 'Robert A Leung', title: 'Unrelated paper' },
    { record_id: 'fixture-2', authors: 'Aileen M Bailey', title: 'Another unrelated paper' },
    { record_id: 'fixture-3', authors: 'He, Yuan', title: 'Possible namesake paper' }];
  mockSql.mockImplementation((parts) => Promise.resolve({ rows: parts.join('?').includes('SELECT EXISTS') ? [{ available: true }] : parts.join('?').includes('to_regclass') ? [{ relation: null }] : rows }));
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

describe('whole-run corpus generation fence',()=>{
  const meta=(generation)=>({generation:String(generation),source_url:'https://gitlab.com/crossref/retraction-watch-data',source_checksum:'a'.repeat(64),published_at:'2026-11-01T00:00:00Z',last_checked_at:'2026-11-01T00:00:00Z',row_count:10,source_row_count:10,retained_records:[],format_version:1});
  function managed(before,after){let reads=0;mockSql.mockImplementation(parts=>{const q=parts.join('?');if(q.includes('SELECT EXISTS'))return Promise.resolve({rows:[{available:true}]});if(q.includes('to_regclass'))return Promise.resolve({rows:[{relation:'retraction_dataset'}]});if(q.includes('FROM retraction_dataset'))return Promise.resolve({rows:[meta(reads++===0?before:after)]});return Promise.resolve({rows:[{record_id:'fixture',authors:'Ada Example',title:'A candidate'}]});});}
  test('unchanged generation records provenance',async()=>{managed(1,1);const r=await screen();expect(r.sources.retraction_watch.dataset).toMatchObject({status:'recorded',generation:'1'});expect(r.sources.retraction_watch.error).toBeNull();});
  test('A→B→A still invalidates provisional matches because generation changed',async()=>{managed(1,3);const r=await screen();expect(r.sources.retraction_watch.error).toContain('dataset changed');expect(r.sources.retraction_watch.matches).toEqual([]);expect(r.sources.retraction_watch.dataset.status).toBe('unverified');expect(r.matchCount).toBe(0);expect(r.hasConcerns).toBe(false);});
  test('metadata failure is incomplete, never a clean corpus',async()=>{managed(1,1);const impl=mockSql.getMockImplementation();mockSql.mockImplementation(parts=>parts.join('?').includes('to_regclass')?Promise.reject(new Error('offline')):impl(parts));const r=await screen();expect(r.sources.retraction_watch.error).toBeTruthy();});
});

// Production keeps main's news analysis until the structured rule is fixed
// (integrity-service.js structuredNewsAdmitted). Each test below fails if the
// structured path runs in Production.
describe('Production news analysis is main\'s', () => {
  const savedEnv = process.env.VERCEL_ENV;
  beforeEach(() => { process.env.VERCEL_ENV = 'production'; });
  afterEach(() => { if (savedEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = savedEnv; });

  const six = Array.from({ length: 6 }, (_, i) => ({ title: `Story ${i + 1}`, link: `https://example.org/story-${i}` }));

  test('a free-text concern flags with the old prompt, no schema and the first five results', async () => {
    mockNews(six);
    mockComplete.mockResolvedValue({ text: 'Story 3 reports a misconduct inquiry at Example University.' });
    const news = (await screen()).sources.news;
    expect(news).toEqual({
      searched: true, hasConcerns: true, summary: 'Story 3 reports a misconduct inquiry at Example University.',
      rawResults: six.slice(0, 5).map(item => expect.objectContaining(item)), resultCount: 6,
      searchStrategy: 'two_phase', resultBreakdown: { nameOnly: 0, withInstitution: 6 }, error: null,
    });
    expect(mockComplete.mock.calls[0][0].system).toContain('You are a due diligence specialist');
    expect(mockComplete.mock.calls[0][0]).not.toHaveProperty('outputConfig');
  });

  test('"No concerns found" clears', async () => {
    mockNews(six);
    mockComplete.mockResolvedValue({ text: 'No concerns found. The search returned 6 results but none indicate professional integrity issues.' });
    expect((await screen()).sources.news).toMatchObject({ hasConcerns: false, error: null });
  });

  test('a standalone search failure stays fail-soft and empty results carry no outcome', async () => {
    global.fetch.mockImplementation(async (url) => (new URL(url).searchParams.get('engine') === 'google_news'
      ? Promise.reject(new Error('offline')) : emptyResponse(url)));
    expect((await screen({})).sources.news).toEqual({
      searched: true, hasConcerns: false, summary: 'No relevant news found.', resultCount: 0,
      searchStrategy: 'two_phase', error: null,
    });
  });

  test('a failed analysis and a missing search key carry no outcome', async () => {
    mockNews(six);
    mockComplete.mockRejectedValue(new Error('offline'));
    expect((await screen()).sources.news).toEqual({ searched: true, summary: null, hasConcerns: false, error: 'Search result analysis failed' });
    let complete;
    for await (const event of IntegrityService.screenApplicants([{ name: 'Ada Example' }], 'fixture-claude', null, null, strict)) {
      if (event.type === 'complete') complete = event;
    }
    expect(complete.results[0].sources.news).toEqual({ searched: false, summary: null, error: 'SERP API key not configured' });
  });
});
