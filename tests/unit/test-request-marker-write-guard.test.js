/**
 * No deployed app path may write the Test Request marker or run ID. Every
 * write path (createRecord, updateRecord, and POST/PATCH operations inside a
 * changeset, in any URL form) must refuse a body that names either field,
 * before any network write. Only `fetch` is mocked; the real write helpers run inside a trusted
 * DAL context, as in dynamics-service-write-core.test.js.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { assertTestRequestMarkerNotWritten } from '../../lib/services/test-requests/isolation.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:test-request-marker-write-guard', fn);
}

function dataverseWrites() {
  return fetch.mock.calls.filter(([url]) => typeof url === 'string' && !url.includes('login.microsoftonline.com'));
}

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  fetch.mockReset();
  DynamicsService.clearCaches();
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('login.microsoftonline.com')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
    }
    return Promise.resolve({
      ok: true,
      status: 204,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
  });
});

describe('assertTestRequestMarkerNotWritten', () => {
  test.each([
    ['clearing the marker', { wmkf_istestrequest: null }],
    ['setting the marker false', { wmkf_istestrequest: false }],
    ['setting the marker true', { wmkf_istestrequest: true }],
    ['clearing the run ID', { wmkf_testcreationrunid: null }],
    ['a differently cased key', { WMKF_IsTestRequest: null }],
  ])('refuses %s on akoya_requests', (_label, data) => {
    expect(() => assertTestRequestMarkerNotWritten('akoya_requests', data))
      .toThrow(expect.objectContaining({ code: 'test_request_marker_immutable' }));
  });

  test('matches the entity set with a leading slash or different case', () => {
    expect(() => assertTestRequestMarkerNotWritten('/Akoya_Requests', { wmkf_istestrequest: null })).toThrow();
  });

  test.each([
    ['an ordinary request update', 'akoya_requests', { akoya_title: 'New title' }],
    ['another entity that happens to use the name', 'contacts', { wmkf_istestrequest: true }],
    ['a missing body', 'akoya_requests', undefined],
  ])('allows %s', (_label, entitySet, data) => {
    expect(() => assertTestRequestMarkerNotWritten(entitySet, data)).not.toThrow();
  });
});

describe('DynamicsService write paths', () => {
  test('updateRecord refuses a marker change before any Dataverse write', ctx(async () => {
    await expect(DynamicsService.updateRecord('akoya_requests', REQUEST_ID, {
      akoya_title: 'x',
      wmkf_istestrequest: null,
      wmkf_testcreationrunid: null,
    })).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
    expect(dataverseWrites()).toHaveLength(0);
  }));

  test('updateRecord still sends an ordinary request update', ctx(async () => {
    await DynamicsService.updateRecord('akoya_requests', REQUEST_ID, { akoya_title: 'x' });
    const writes = dataverseWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0][1].method).toBe('PATCH');
  }));

  test('createRecord refuses a request create that sets the marker (no forged test requests)', ctx(async () => {
    await expect(DynamicsService.createRecord('akoya_requests', {
      akoya_requestid: REQUEST_ID,
      wmkf_istestrequest: true,
      wmkf_testcreationrunid: RUN_ID,
    })).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
    expect(dataverseWrites()).toHaveLength(0);
  }));

  test('createRecord still sends an ordinary request create', ctx(async () => {
    fetch.mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('login.microsoftonline.com')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }) });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        headers: { get: () => null },
        json: () => Promise.resolve({ akoya_requestid: REQUEST_ID }),
        text: () => Promise.resolve(JSON.stringify({ akoya_requestid: REQUEST_ID })),
      });
    });
    await DynamicsService.createRecord('akoya_requests', { akoya_requestid: REQUEST_ID });
    expect(dataverseWrites()[0][1].method).toBe('POST');
  }));

  test.each([
    ['relative PATCH', 'PATCH', `akoya_requests(${REQUEST_ID})`],
    ['absolute PATCH', 'PATCH', `https://example.crm.dynamics.com/api/data/v9.2/akoya_requests(${REQUEST_ID})`],
    ['alternate-key upsert with a slash in the key', 'PATCH', "akoya_requests(akoya_requestnum='10/03')"],
    ['relative POST create', 'POST', 'akoya_requests'],
    ['absolute POST create', 'POST', 'https://example.crm.dynamics.com/api/data/v9.2/akoya_requests'],
  ])('a changeset %s that names the marker is refused before the batch is sent', (_label, method, url) => (
    bypassDynamicsRestrictions('test:test-request-marker-write-guard', async () => {
      await expect(DynamicsService.executeChangeset([
        { method, url, body: { wmkf_testcreationrunid: null } },
      ])).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(dataverseWrites()).toHaveLength(0);
    })
  ));
});
