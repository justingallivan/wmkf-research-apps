/** @jest-environment node */
jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: jest.fn() }));

import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { getRecord, queryAllRecords } from '../../lib/services/dynamics/read-ops.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations.js';

const origin = 'https://orgd9e66399.crm.dynamics.com';
const entity = 'wmkf_expertiseprofiles';
const path = '/api/data/v9.2/' + entity;
const primaryKey = 'wmkf_expertiseprofileid';
const options = {
  select: primaryKey + ',wmkf_name',
  filter: primaryKey + ' ne null',
  orderby: primaryKey + ' asc',
  primaryKey,
  expectedOrigin: origin,
  strictPagination: true,
};
const readOptions = { select: 'systemuserid,isdisabled', strictRead: true, expectedOrigin: origin };
const originalOrigin = process.env.DYNAMICS_URL;
const svc = {
  resolveLogicalName: jest.fn(() => 'wmkf_expertiseprofile'),
  checkRestriction: jest.fn(),
  getAccessToken: jest.fn(),
  processAnnotations,
  buildHeaders: token => ({ Authorization: 'Bearer ' + token }),
};
const row = n => ({
  [primaryKey]: 'abcdefab-1111-4111-8111-' + String(n).padStart(12, '0'),
  '@odata.etag': 'W/"1"',
});
const next = (cursor = 'opaque + cursor') => {
  const url = new URL(origin + path);
  url.searchParams.set('$skiptoken', cursor);
  url.searchParams.set('$count', 'true');
  url.searchParams.set('$orderby', options.orderby);
  url.searchParams.set('$filter', options.filter);
  url.searchParams.set('$select', options.select);
  return url;
};
const respond = data => fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => data });
const query = opts => queryAllRecords(svc, entity, opts ?? options);
const user = opts => getRecord(svc, 'systemusers', row(1)[primaryKey], opts ?? readOptions);

beforeEach(() => {
  process.env.DYNAMICS_URL = origin;
  fetchWithTimeout.mockReset();
  svc.getAccessToken.mockReset().mockResolvedValue('test-token');
});

afterAll(() => {
  if (originalOrigin === undefined) delete process.env.DYNAMICS_URL;
  else process.env.DYNAMICS_URL = originalOrigin;
});

test('follows a safe continuation with reordered parameters and equivalent encoding', async () => {
  const continuation = next().href.replaceAll('+', '%20');
  respond({ value: [row(1)], '@odata.count': 2, '@odata.nextLink': continuation });
  respond({ value: [row(2)] });
  await expect(query()).resolves.toEqual({
    records: [1, 2].map(n => ({ [primaryKey]: row(n)[primaryKey], _etag: 'W/"1"' })),
    totalCount: 2,
    capped: false,
  });
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  expect(fetchWithTimeout.mock.calls[1][0]).toBe(continuation);
  for (const [url, settings] of fetchWithTimeout.mock.calls) {
    expect(new URL(url).origin).toBe(origin);
    expect(settings).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer test-token' } });
  }
});

test('accepts an explicit count of zero', async () => {
  respond({ value: [], '@odata.count': 0 });
  await expect(query()).resolves.toEqual({ records: [], totalCount: 0, capped: false });
});

test.each([
  ['foreign origin', () => next().href.replace(origin, 'https://elsewhere.example')],
  ['wrong entity', () => next().href.replace(entity, 'contacts')],
  ['relative URL', () => next().href.slice(origin.length)],
  ['userinfo', () => next().href.replace('https://', 'https://user@')],
  ['fragment', () => next().href + '#ignored'],
  ['extra expand', () => next().href + '&%24expand=owninguser'],
  ['duplicate select', () => next().href + '&%24select=' + options.select],
  ['changed filter', () => next().href.replace('+ne+null', '+eq+null')],
  ['missing count', () => { const url = next(); url.searchParams.delete('$count'); return url.href; }],
  ['missing cursor', () => { const url = next(); url.searchParams.delete('$skiptoken'); return url.href; }],
  ['duplicate cursor', () => next().href + '&%24skip=2'],
  ['null link', () => null],
])('refuses %s without forwarding the token', async (_label, continuation) => {
  respond({ value: [row(1)], '@odata.count': 2, '@odata.nextLink': continuation() });
  await expect(query()).rejects.toThrow('Strict Dataverse continuation');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});

test.each([
  ['missing records', { '@odata.count': 0 }],
  ['wrong records shape', { value: {}, '@odata.count': 0 }],
  ['missing count', { value: [] }],
  ['string count', { value: [], '@odata.count': '0' }],
  ['negative count', { value: [], '@odata.count': -1 }],
  ['count above result', { value: [row(1)], '@odata.count': 2 }],
  ['count below result', { value: [row(1)], '@odata.count': 0 }],
  ['count at cap', { value: [row(1)], '@odata.count': 5000 }],
  ['explicit cap', { value: [], '@odata.count': 0, '@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded': true }],
  ['bad primary key', { value: [{ [primaryKey]: 'invalid' }], '@odata.count': 1 }],
  ['no progress', { value: [], '@odata.count': 1, '@odata.nextLink': next().href }],
  ['exhausted count', { value: [row(1)], '@odata.count': 1, '@odata.nextLink': next().href }],
])('refuses %s', async (_label, response) => {
  respond(response);
  await expect(query()).rejects.toThrow('Strict Dataverse');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});

test.each([
  ['changed count', { value: [row(2)], '@odata.count': 2 }],
  ['duplicate key', { value: [{ [primaryKey]: row(1)[primaryKey].toUpperCase() }] }],
  ['repeated cursor', { value: [row(2)], '@odata.nextLink': next().href.replaceAll('+', '%20') }],
])('refuses %s on a later page', async (_label, response) => {
  respond({ value: [row(1)], '@odata.count': 3, '@odata.nextLink': next().href });
  respond(response);
  await expect(query()).rejects.toThrow('Strict Dataverse');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
});

test.each([
  [query, { ...options, primaryKey: 'unselected' }],
  [query, { ...options, expectedOrigin: undefined }],
  [user, { ...readOptions, expectedOrigin: origin + '/' }],
  [user, { ...readOptions, expectedOrigin: 'https://other.example' }],
])('refuses invalid strict configuration before authentication', async (read, opts) => {
  await expect(read(opts)).rejects.toThrow('Strict Dataverse');
  expect(svc.getAccessToken).not.toHaveBeenCalled();
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

test.each([query, user])('refuses an environment target change while authenticating', async read => {
  svc.getAccessToken.mockImplementation(async () => {
    process.env.DYNAMICS_URL = 'https://other.example';
    return 'test-token';
  });
  await expect(read()).rejects.toThrow('Strict Dataverse read target');
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

test('refuses a target change after reading a page body', async () => {
  fetchWithTimeout.mockResolvedValueOnce({
    ok: true,
    json: async () => {
      process.env.DYNAMICS_URL = 'https://other.example';
      return { value: [row(1)], '@odata.count': 2, '@odata.nextLink': next().href };
    },
  });
  await expect(query()).rejects.toThrow('Strict Dataverse read target');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});

test('strict User GET disables redirects and legacy User GET keeps its fetch options', async () => {
  const result = { systemuserid: row(1)[primaryKey], isdisabled: true };
  respond(result);
  respond(result);
  await expect(user()).resolves.toEqual(result);
  await expect(user({ select: 'systemuserid,isdisabled' })).resolves.toEqual(result);
  expect(fetchWithTimeout.mock.calls[0][1]).toEqual({ redirect: 'error', headers: { Authorization: 'Bearer test-token' } });
  expect(fetchWithTimeout.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer test-token' } });
});

test.each([1, 2])('stops pagination at an HTTP error on page %i', async failedPage => {
  if (failedPage === 2) {
    respond({ value: [row(1)], '@odata.count': 3, '@odata.nextLink': next().href });
  }
  fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });
  respond({ value: [row(2)], '@odata.count': 1 });
  await expect(query()).rejects.toThrow('Strict Dataverse pagination failed (503)');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(failedPage);
});

test('strict User GET rejects an HTTP error', async () => {
  fetchWithTimeout.mockResolvedValueOnce({
    ok: false, status: 404, statusText: 'Not Found', text: async () => '',
  });
  await expect(user()).rejects.toThrow();
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});

test('strict User GET rejects a malformed GUID before authentication', async () => {
  await expect(getRecord(svc, 'systemusers', 'bad-guid', readOptions))
    .rejects.toThrow('Strict Dataverse read identity');
  expect(svc.getAccessToken).not.toHaveBeenCalled();
  expect(fetchWithTimeout).not.toHaveBeenCalled();
});

test('strict User GET rejects a target change while reading the body', async () => {
  fetchWithTimeout.mockResolvedValueOnce({
    ok: true,
    json: async () => {
      process.env.DYNAMICS_URL = 'https://other.example';
      return { systemuserid: row(1)[primaryKey], isdisabled: false };
    },
  });
  await expect(user()).rejects.toThrow('Strict Dataverse read target');
  expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
});

test.each(['1', '0'])('validates the numeric continuation $skip=%s', async offset => {
  const continuation = next();
  continuation.searchParams.delete('$skiptoken');
  continuation.searchParams.set('$skip', offset);
  respond({ value: [row(1)], '@odata.count': 2, '@odata.nextLink': continuation.href });
  respond({ value: [row(2)] });

  if (offset === '0') {
    await expect(query()).rejects.toThrow('Strict Dataverse continuation cursor');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  } else {
    await expect(query()).resolves.toMatchObject({ totalCount: 2, capped: false });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
  }
});

test.each([
  [query, options, 'strictPagination'],
  [user, readOptions, 'strictRead'],
])('strict flags accept false and reject non-booleans before authentication', async (read, opts, flag) => {
  for (const value of ['true', 1, null]) {
    await expect(read({ ...opts, [flag]: value })).rejects.toThrow('must be a boolean');
  }
  expect(svc.getAccessToken).not.toHaveBeenCalled();
  expect(fetchWithTimeout).not.toHaveBeenCalled();

  respond({ value: [], '@odata.count': 0 });
  await expect(read({ ...opts, [flag]: false })).resolves.toBeDefined();
  expect(fetchWithTimeout.mock.calls[0][1]).not.toHaveProperty('redirect');
});
