/**
 * search_documents must not report a THROTTLED scope as "no documents found".
 *
 * On 2026-08-27 the Explorer swallowed per-scope Graph 429s, told the model
 * "No documents found", and the model re-ran the search — 86 throttled calls
 * from three chat requests landed on the Operational Events card. These cases
 * pin the honest shapes: an all-scopes failure is an error, a partial failure
 * carries the hits plus an `incomplete` warning, and a clean zero stays a zero.
 */

// chat.js pulls in the whole Dataverse/Graph/Excel/auth chain at import time
// (the auth path reaches ESM-only `jose`, which Jest cannot parse). Stub the
// heavy edges so this stays a unit test of the search_documents contract.
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => jest.fn() }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn() }));
jest.mock('../../lib/services/llm-client', () => ({ LLMClient: jest.fn() }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn() },
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { searchFiles: jest.fn() },
}));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({ getRequestSharePointBuckets: jest.fn() }));
jest.mock('../../lib/services/dynamics-explorer-taxonomy', () => ({
  buildResolvedTaxonomyPromptBlock: jest.fn(),
}));
jest.mock('exceljs', () => ({}));

const { DynamicsService } = require('../../lib/services/dynamics-service');
const { GraphService } = require('../../lib/services/graph-service');
const { getRequestSharePointBuckets } = require('../../lib/utils/sharepoint-buckets');

const REQUEST_ID = '11111111-2222-3333-4444-555555555555';
const FOLDER = `1001_${REQUEST_ID.replace(/-/g, '').toUpperCase()}`;

function throttledError() {
  const err = new Error('SharePoint search failed (429): {"error":{"code":"429"}}');
  err.status = 429;
  err.isTransient = true;
  return err;
}

function file(name, library = 'akoya_request') {
  return {
    name,
    size: 1024,
    lastModified: '2026-01-01T00:00:00Z',
    webUrl: `https://example.sharepoint.com/sites/akoyaGO/${library}/${FOLDER}/${name}`,
    summary: '',
    library,
    folder: FOLDER,
  };
}

let searchDocuments;

beforeAll(async () => {
  ({ searchDocuments } = await import('../../pages/api/dynamics-explorer/chat'));
});

beforeEach(() => {
  jest.clearAllMocks();
  DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1001' });
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: FOLDER, source: 'dynamics' },
    { library: 'RequestArchive1', folder: FOLDER, source: 'archive' },
    { library: 'RequestArchive2', folder: FOLDER, source: 'archive' },
    { library: 'RequestArchive3', folder: FOLDER, source: 'archive' },
  ]);
});

describe('searchDocuments scope failures', () => {
  test('every scope throttled → an error, never "No documents found"', async () => {
    GraphService.searchFiles.mockRejectedValue(throttledError());
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    // Wave 1 (tracked folder) throttled → the three archive probes are never sent.
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(1);
    expect(result.searchCount).toBe(0);
    expect(result.incomplete).toBe(true);
    expect(result.message).toBeUndefined();
    expect(result.error).toMatch(/throttled or timed out for 4 of 4 search scope/);
    expect(result.error).toMatch(/skipped after a transient search failure/);
    expect(result.error).toMatch(/not a confirmed "no documents"/);
    expect(result.error).toMatch(/paused for the rest of this request/);
  });

  test('a transient failure trips the per-request breaker: the next search never reaches Graph', async () => {
    GraphService.searchFiles.mockRejectedValue(throttledError());
    const toolContext = { searchThrottle: null };
    await searchDocuments({ query: 'budget', request_number: REQUEST_ID }, toolContext);
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(1);
    expect(toolContext.searchThrottle).toMatchObject({ reason: expect.stringContaining('429') });

    GraphService.searchFiles.mockResolvedValue([file('Budget.pdf')]); // Graph would now succeed…
    const second = await searchDocuments({ query: 'narrative', library: 'akoya_request' }, toolContext);
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(1); // …but it is never asked
    expect(second).toMatchObject({ searchCount: 0, incomplete: true });
    expect(second.error).toMatch(/paused for the rest of this request/);
    expect(second.error).toMatch(/No search was run/);
  });

  test('a permanent (400) failure does NOT trip the breaker', async () => {
    const bad = new Error('SharePoint search failed (400): bad KQL');
    bad.status = 400;
    bad.isTransient = false;
    GraphService.searchFiles.mockRejectedValue(bad);
    const toolContext = { searchThrottle: null };
    await searchDocuments({ query: 'budget', library: 'akoya_request' }, toolContext);
    expect(toolContext.searchThrottle).toBeNull();
  });

  test('breaker state is per request: a fresh context searches normally', async () => {
    GraphService.searchFiles.mockResolvedValue([file('Budget.pdf')]);
    const result = await searchDocuments({ query: 'budget', library: 'akoya_request' }, { searchThrottle: null });
    expect(result.searchCount).toBe(1);
  });

  test('partial throttle → hits from the healthy scope plus an incomplete warning', async () => {
    GraphService.searchFiles.mockImplementation(async (_query, { libraryName }) => {
      if (libraryName === 'akoya_request') return [file('Budget.pdf')];
      throw throttledError();
    });
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    // Tracked folder + first archive probe; the probe throttled, so the other two are skipped.
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(2);
    expect(result.searchCount).toBe(1);
    expect(result.documents).toContain('Budget.pdf');
    expect(result.incomplete).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toMatch(/for 3 of 4 search scope/);
    expect(result.warning).toMatch(/RequestArchive1\/1001_/);
  });

  test('a non-transient scope failure is named as a service error, not a throttle', async () => {
    const bad = new Error('SharePoint search failed (400): bad KQL');
    bad.status = 400;
    bad.isTransient = false;
    GraphService.searchFiles.mockRejectedValue(bad);
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    expect(result.error).toMatch(/^The SharePoint search service returned an error/);
    expect(result.error).toMatch(/This is not a throttle/);
    expect(result.error).not.toMatch(/try again in a minute/);
    expect(result.incomplete).toBe(true);
  });

  test('a clean zero-hit search is still reported as a zero, with no warning', async () => {
    GraphService.searchFiles.mockResolvedValue([]);
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    expect(result).toEqual({
      searchCount: 0,
      query: 'budget',
      scope: 'request 1001 (4 folders)',
      message: 'No documents found matching the search query.',
    });
  });

  test('a successful search carries no incomplete flag', async () => {
    GraphService.searchFiles.mockResolvedValue([file('Budget.pdf')]);
    const result = await searchDocuments({ query: 'budget', library: 'akoya_request' });
    expect(result.searchCount).toBe(1);
    expect(result.incomplete).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });
});

describe('searchDocuments scope ordering', () => {
  test('tracked folder first, then archive probes one at a time — never a 4-wide burst', async () => {
    const order = [];
    let inFlight = 0;
    let maxInFlight = 0;
    GraphService.searchFiles.mockImplementation(async (_query, { libraryName }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(libraryName);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return [];
    });
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    expect(order).toEqual(['akoya_request', 'RequestArchive1', 'RequestArchive2', 'RequestArchive3']);
    expect(maxInFlight).toBe(1);
    expect(result.message).toBe('No documents found matching the search query.');
  });

  test('recall is unchanged: a hit that only exists in an archive library is still found', async () => {
    GraphService.searchFiles.mockImplementation(async (_query, { libraryName }) =>
      (libraryName === 'RequestArchive3' ? [file('OldBudget.pdf', 'RequestArchive3')] : []));
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(4);
    expect(result.searchCount).toBe(1);
    expect(result.documents).toContain('OldBudget.pdf');
    expect(result.incomplete).toBeUndefined();
  });
});

describe('same-round concurrency and Retry-After propagation', () => {
  test('two concurrent search_documents calls in one request are serialized: the second never reaches Graph after the first throttles', async () => {
    const err = throttledError();
    err.retryAfterMs = 45_000;
    GraphService.searchFiles.mockRejectedValue(err);
    const toolContext = { searchThrottle: null };
    const [first, second] = await Promise.all([
      searchDocuments({ query: 'budget', library: 'akoya_request' }, toolContext),
      searchDocuments({ query: 'narrative', library: 'akoya_request' }, toolContext),
    ]);
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(1);
    expect(first.error).toMatch(/throttled or timed out/);
    expect(second.error).toMatch(/paused for the rest of this request/);
    expect(second.error).toMatch(/No search was run/);
  });

  test('retry guidance is derived from the longest Retry-After the tenant sent, not a fixed minute', async () => {
    const err = throttledError();
    err.retryAfterMs = 150_000;
    GraphService.searchFiles.mockRejectedValue(err);
    const toolContext = { searchThrottle: null };
    const result = await searchDocuments({ query: 'budget', library: 'akoya_request' }, toolContext);
    expect(result.retryAfterMs).toBe(150_000);
    expect(result.error).toMatch(/ask again in about 3 minutes/);
    expect(toolContext.searchThrottle.retryAfterMs).toBe(150_000);
    const paused = await searchDocuments({ query: 'x', library: 'akoya_request' }, toolContext);
    expect(paused.error).toMatch(/about 3 minutes/);
  });

  test('without a Retry-After the guidance floors at about a minute', async () => {
    GraphService.searchFiles.mockRejectedValue(throttledError());
    const result = await searchDocuments({ query: 'budget', library: 'akoya_request' }, { searchThrottle: null });
    expect(result.retryAfterMs).toBeNull();
    expect(result.error).toMatch(/about a minute/);
  });
});
