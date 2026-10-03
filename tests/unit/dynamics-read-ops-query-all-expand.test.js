/**
 * queryAllRecords forwards $expand (S503 regression): the Meeting Tracker slot
 * adapter reads each slot's session through a single-valued navigation expand,
 * and the paging read silently dropped it, so every placed proposal read as
 * "no session" in production.
 *
 * @jest-environment node
 */
jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: jest.fn() }));

import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';
import { queryAllRecords } from '../../lib/services/dynamics/read-ops.js';

const ORIGINAL_URL = process.env.DYNAMICS_URL;

function svcStub() {
  return {
    resolveLogicalName: jest.fn(() => 'wmkf_deliberationslot'),
    checkRestriction: jest.fn(),
    getAccessToken: jest.fn(async () => 'token'),
    processAnnotations: jest.fn((row) => row),
  };
}

beforeEach(() => {
  process.env.DYNAMICS_URL = 'https://org.crm.test';
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockResolvedValue({
    ok: true,
    json: async () => ({ value: [{ wmkf_deliberationslotid: 's1', wmkf_Session: { wmkf_deliberationsessionid: 'x' } }], '@odata.count': 1 }),
  });
});

afterAll(() => {
  if (ORIGINAL_URL === undefined) delete process.env.DYNAMICS_URL; else process.env.DYNAMICS_URL = ORIGINAL_URL;
});

test('queryAllRecords sends $expand and passes it to the restriction check', async () => {
  const svc = svcStub();
  const result = await queryAllRecords(svc, 'wmkf_deliberationslots', {
    select: 'wmkf_deliberationslotid,_wmkf_request_value',
    filter: "_wmkf_request_value eq 11111111-1111-4111-8111-111111111111",
    expand: 'wmkf_Session($select=wmkf_deliberationsessionid,wmkf_status)',
  });
  const url = new URL(fetchWithTimeout.mock.calls[0][0]);
  expect(url.searchParams.get('$expand')).toBe('wmkf_Session($select=wmkf_deliberationsessionid,wmkf_status)');
  expect(url.searchParams.get('$filter')).toContain('_wmkf_request_value eq');
  expect(svc.checkRestriction).toHaveBeenCalledWith(
    'wmkf_deliberationslot',
    'wmkf_deliberationslotid,_wmkf_request_value',
    'wmkf_Session($select=wmkf_deliberationsessionid,wmkf_status)',
  );
  expect(result.records[0].wmkf_Session.wmkf_deliberationsessionid).toBe('x');
});

test('without expand the query carries no $expand and the restriction check sees undefined', async () => {
  const svc = svcStub();
  await queryAllRecords(svc, 'wmkf_deliberationslots', { filter: 'statecode eq 0' });
  const url = new URL(fetchWithTimeout.mock.calls[0][0]);
  expect(url.searchParams.has('$expand')).toBe(false);
  expect(svc.checkRestriction).toHaveBeenCalledWith('wmkf_deliberationslot', undefined, undefined);
});

test('queryAllRecords follows every page and marks the exact 5,000-row boundary capped', async () => {
  const svc = svcStub();
  let page = 0;
  fetchWithTimeout.mockImplementation(async () => {
    page += 1;
    return {
      ok: true,
      json: async () => ({
        value: Array.from({ length: 500 }, (_, index) => ({ id: `${page}-${index}` })),
        '@odata.count': 5000,
        ...(page < 10 ? { '@odata.nextLink': `https://org.crm.test/next/${page + 1}` } : {}),
      }),
    };
  });
  const result = await queryAllRecords(svc, 'wmkf_sitevisits', {
    select: 'activityid,_regardingobjectid_value,scheduledstart,scheduledend',
    filter: 'statecode eq 0',
  });
  expect(page).toBe(10);
  expect(result).toMatchObject({ totalCount: 5000, capped: true });
  expect(result.records).toHaveLength(5000);
});
