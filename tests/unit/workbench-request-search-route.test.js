/**
 * @jest-environment node
 */

const requireAppAccess = jest.fn();
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: (...args) => requireAppAccess(...args),
}));

const withDalContext = jest.fn((_label, fn) => fn());
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (...args) => withDalContext(...args),
}));

const loadRequestSearchOptions = jest.fn();
const searchWorkbenchRequests = jest.fn();
jest.mock('../../lib/services/workbench/request-search-service', () => ({
  loadRequestSearchOptions: (...args) => loadRequestSearchOptions(...args),
  searchWorkbenchRequests: (...args) => searchWorkbenchRequests(...args),
  REQUEST_SEARCH_MAX_RESULTS: 100,
  REQUEST_SEARCH_PAGE_SIZE: 25,
}));

import handler from '../../pages/api/workbench/search-requests';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  return res;
}

function req(query = {}, method = 'GET') {
  return { method, query };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 1, session: { user: {} } });
  loadRequestSearchOptions.mockResolvedValue({ success: true, cycles: [], statuses: [] });
  searchWorkbenchRequests.mockResolvedValue({ success: true, results: [] });
});

test('requires GET and the reviewers app grant', async () => {
  const wrongMethod = mockRes();
  await handler(req({}, 'POST'), wrongMethod);
  expect(wrongMethod.statusCode).toBe(405);
  expect(wrongMethod.headers.Allow).toBe('GET');

  requireAppAccess.mockResolvedValueOnce(null);
  const denied = mockRes();
  await handler(req({ q: 'term' }), denied);
  expect(searchWorkbenchRequests).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});

test('options mode returns live filters inside the trusted DAL context', async () => {
  const res = mockRes();
  await handler(req({ mode: 'options' }), res);
  expect(res.statusCode).toBe(200);
  expect(loadRequestSearchOptions).toHaveBeenCalledTimes(1);
  expect(withDalContext).toHaveBeenCalledWith('workbench-search-requests', expect.any(Function));
});

test('validated search parameters reach the service as plain values', async () => {
  const res = mockRes();
  await handler(req({
    q: '  liver regeneration  ',
    cycle: 'December 2026',
    status: 'Active',
    offset: '25',
  }), res);
  expect(res.statusCode).toBe(200);
  expect(searchWorkbenchRequests).toHaveBeenCalledWith({
    query: 'liver regeneration',
    cycle: 'December 2026',
    status: 'Active',
    offset: 25,
  });
});

test.each([
  [{ mode: 'bogus' }, 'Invalid mode'],
  [{ mode: 'options', q: 'ignored' }, 'Invalid request search parameters'],
  [{ q: 'valid', surprise: 'value' }, 'Invalid request search parameters'],
  [{ q: ['one', 'two'] }, 'Invalid request search parameters'],
  [{ q: 'x' }, 'Search terms must contain at least 2 characters'],
  [{ q: 'valid', offset: '1' }, 'Invalid request search parameters'],
  [{ q: 'valid', offset: '100' }, 'Invalid request search parameters'],
  [{ q: 'x'.repeat(101) }, 'Request search parameters are too long'],
])('rejects invalid input %# before entering the DAL context', async (query, message) => {
  const res = mockRes();
  await handler(req(query), res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toBe(message);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(searchWorkbenchRequests).not.toHaveBeenCalled();
});

test('unexpected failures use a sanitized production envelope', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  searchWorkbenchRequests.mockRejectedValueOnce(new Error('secret downstream detail'));
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = mockRes();
  await handler(req({ q: 'valid' }), res);
  process.env.NODE_ENV = prior;
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ error: 'Failed to search requests' });
  expect(errorSpy).toHaveBeenCalled();
});
