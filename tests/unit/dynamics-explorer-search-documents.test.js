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
    expect(GraphService.searchFiles).toHaveBeenCalledTimes(4);
    expect(result.searchCount).toBe(0);
    expect(result.incomplete).toBe(true);
    expect(result.message).toBeUndefined();
    expect(result.error).toMatch(/throttled or timed out for 4 of 4 search scope/);
    expect(result.error).toMatch(/NOT evidence that no matching documents exist/);
    expect(result.error).toMatch(/do not retry the search within this response/);
  });

  test('partial throttle → hits from the healthy scope plus an incomplete warning', async () => {
    GraphService.searchFiles.mockImplementation(async (_query, { libraryName }) => {
      if (libraryName === 'akoya_request') return [file('Budget.pdf')];
      throw throttledError();
    });
    const result = await searchDocuments({ query: 'budget', request_number: REQUEST_ID });
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
