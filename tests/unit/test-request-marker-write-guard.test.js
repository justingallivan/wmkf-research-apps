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
    ['an annotated key', { 'wmkf_istestrequest@OData.Community.Display.V1.FormattedValue': 'Yes' }],
    ['a deep-insert request nested in another entity', { name: 'x', wmkf_Request: { akoya_title: 't', wmkf_istestrequest: true } }],
    ['a marker inside an array of related rows', { related: [{ ok: 1 }, { wmkf_testcreationrunid: 'x' }] }],
  ])('refuses %s', (_label, data) => {
    expect(() => assertTestRequestMarkerNotWritten(data))
      .toThrow(expect.objectContaining({ code: 'test_request_marker_immutable' }));
  });

  test.each([
    ['property-level PUT', `akoya_requests(${REQUEST_ID})/wmkf_istestrequest`],
    ['property-level DELETE with $value', `akoya_requests(${REQUEST_ID})/wmkf_testcreationrunid/$value`],
    ['absolute property URL', `https://example.crm.dynamics.com/api/data/v9.2/akoya_requests(${REQUEST_ID})/wmkf_istestrequest`],
    ['percent-encoded property URL (Codex 6c-i round 3)', `wmkf_potentialreviewerses(${REQUEST_ID})/%77mkf_issyntheticreviewer`],
    ['fully percent-encoded property URL', `akoya_requests(${REQUEST_ID})/%77%6D%6B%66_istestrequest`],
    ['malformed percent-encoding (fails closed)', `akoya_requests(${REQUEST_ID})/%ZZmkf_istestrequest`],
    ['backslash-separated property URL (Codex 6c-i round 4)', `akoya_requests(${REQUEST_ID})\\wmkf_istestrequest`],
    ['encoded-backslash property URL', `akoya_requests(${REQUEST_ID})%5Cwmkf_istestrequest`],
    ['encoded-slash property URL', `akoya_requests(${REQUEST_ID})%2Fwmkf_testcreationrunid`],
    ['fragment-suffixed property URL (Codex 6c-i round 7)', `akoya_requests(${REQUEST_ID})/wmkf_istestrequest#ignored`],
    ['absolute fragment-suffixed person marker URL', `https://example.crm.dynamics.com/api/data/v9.2/wmkf_potentialreviewerses(${REQUEST_ID})/wmkf_issyntheticreviewer#x`],
    ['fragment before an encoded separator', `akoya_requests(${REQUEST_ID})/wmkf_testcreationrunid#%2F`],
  ])('refuses a %s that names the field in the URL', (_label, url) => {
    expect(() => assertTestRequestMarkerNotWritten(undefined, url))
      .toThrow(expect.objectContaining({ code: 'test_request_marker_immutable' }));
  });

  test('fails closed on a body nested too deeply to check', () => {
    let body = { leaf: true };
    for (let i = 0; i < 40; i += 1) body = { child: body };
    expect(() => assertTestRequestMarkerNotWritten(body)).toThrow();
  });

  test.each([
    ['an ordinary request body', { akoya_title: 'New title' }],
    ['a missing body', undefined],
    ['a field that merely contains the name', { wmkf_istestrequest_note: 'x' }],
  ])('allows %s', (_label, data) => {
    expect(() => assertTestRequestMarkerNotWritten(data)).not.toThrow();
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

  test('deleteRecord refuses a marker property path before any Dataverse write', ctx(async () => {
    await expect(DynamicsService.deleteRecord('akoya_requests', `${REQUEST_ID})/wmkf_istestrequest(`))
      .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
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
    ['write through a navigation path of another entity', 'PATCH', `accounts(${RUN_ID})/akoya_requests(${REQUEST_ID})`],
  ])('a changeset %s that names the marker is refused before the batch is sent', (_label, method, url) => (
    bypassDynamicsRestrictions('test:test-request-marker-write-guard', async () => {
      await expect(DynamicsService.executeChangeset([
        { method, url, body: { wmkf_testcreationrunid: null } },
      ])).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(dataverseWrites()).toHaveLength(0);
    })
  ));

  test('a changeset DELETE of the marker property is refused before the batch is sent', ctx(async () => {
    await expect(DynamicsService.executeChangeset([
      { method: 'DELETE', url: `akoya_requests(${REQUEST_ID})/wmkf_istestrequest` },
    ])).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
    expect(dataverseWrites()).toHaveLength(0);
  }));
});

describe('raw Dataverse client (lib/dataverse/client.js)', () => {
  const { createClient, TEST_REQUEST_MARKER_FIELDS } = require('../../lib/dataverse/client.js');

  beforeEach(() => {
    delete process.env.DATAVERSE_TARGET_INTERLOCK;
  });

  test('keeps its marker field list identical to the service guard', () => {
    expect([...TEST_REQUEST_MARKER_FIELDS].sort()).toEqual([
      'wmkf_issyntheticreviewer', 'wmkf_istestrequest', 'wmkf_testcreationrunid',
    ]);
  });

  test.each([
    ['post', (c) => c.post('/akoya_requests', { wmkf_istestrequest: true })],
    ['patch', (c) => c.patch(`/akoya_requests(${REQUEST_ID})`, { wmkf_testcreationrunid: null })],
    ['raw PUT', (c) => c.raw('PUT', `/akoya_requests(${REQUEST_ID})/wmkf_istestrequest`, { value: true })],
    ['nested deep insert', (c) => c.post('/accounts', { name: 'x', akoya_request: { wmkf_istestrequest: true } })],
    ['property-level DELETE', (c) => c.delete_(`/akoya_requests(${REQUEST_ID})/wmkf_testcreationrunid`)],
    ['post (synthetic-reviewer person marker)', (c) => c.post('/wmkf_potentialreviewerses', { wmkf_issyntheticreviewer: true })],
    ['percent-encoded property PUT (Codex 6c-i round 3)', (c) => c.raw('PUT', `/wmkf_potentialreviewerses(${REQUEST_ID})/%77mkf_issyntheticreviewer`, { value: false })],
    ['malformed percent-encoded property PUT (fails closed)', (c) => c.raw('PUT', `/akoya_requests(${REQUEST_ID})/%ZZmkf_istestrequest`, { value: false })],
    ['backslash-separated property PUT (Codex 6c-i round 4)', (c) => c.raw('PUT', `/akoya_requests(${REQUEST_ID})\\wmkf_istestrequest`, { value: false })],
    ['encoded-backslash property PUT', (c) => c.raw('PUT', `/wmkf_potentialreviewerses(${REQUEST_ID})%5Cwmkf_issyntheticreviewer`, { value: false })],
    ['encoded-slash property DELETE', (c) => c.delete_(`/akoya_requests(${REQUEST_ID})%2Fwmkf_testcreationrunid`)],
    ['fragment-suffixed property PUT (Codex 6c-i round 7)', (c) => c.raw('PUT', `/akoya_requests(${REQUEST_ID})/wmkf_istestrequest#ignored`, { value: false })],
    ['absolute fragment-suffixed person marker PUT', (c) => c.raw('PUT', `https://example.crm.dynamics.com/api/data/v9.2/wmkf_potentialreviewerses(${REQUEST_ID})/wmkf_issyntheticreviewer#x`, { value: false })],
  ])('refuses a %s that names the marker before any fetch', async (_label, send) => {
    const client = createClient({ resourceUrl: 'https://example.crm.dynamics.com', token: 't' });
    await expect(send(client)).rejects.toMatchObject({ code: 'test_request_marker_immutable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('lets the factory CLI write the marker when it opts in', async () => {
    const client = createClient({ resourceUrl: 'https://example.crm.dynamics.com', token: 't', allowTestRequestMarkerWrites: true });
    await client.post('/akoya_requests', { wmkf_istestrequest: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('lets the factory CLI write the synthetic-reviewer person marker when it opts in (D-R1: the person create goes through this same raw client)', async () => {
    const client = createClient({ resourceUrl: 'https://example.crm.dynamics.com', token: 't', allowTestRequestMarkerWrites: true });
    await client.post('/wmkf_potentialreviewerses', { wmkf_issyntheticreviewer: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('Codex adversarial round 1: allowTestRequestMarkerWrites is scoped, not a blanket bypass', () => {
    function optedInClient() {
      return createClient({ resourceUrl: 'https://example.crm.dynamics.com', token: 't', allowTestRequestMarkerWrites: true });
    }

    test('a PATCH naming a marker is refused even with the flag set', async () => {
      const client = optedInClient();
      await expect(client.patch(`/akoya_requests(${REQUEST_ID})`, { wmkf_istestrequest: true }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('a PUT/DELETE naming a marker in the URL path is refused even with the flag set', async () => {
      const client = optedInClient();
      await expect(client.raw('PUT', `/akoya_requests(${REQUEST_ID})/wmkf_istestrequest`, { value: true }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      await expect(client.delete_(`/akoya_requests(${REQUEST_ID})/wmkf_testcreationrunid`))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('a POST to a different entity set is refused even with the flag set', async () => {
      const client = optedInClient();
      await expect(client.post('/accounts', { wmkf_istestrequest: true }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('a POST with the marker set to false is refused even with the flag set (only true is a create attestation)', async () => {
      const client = optedInClient();
      await expect(client.post('/akoya_requests', { wmkf_istestrequest: false }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('a POST with wmkf_testcreationrunid not GUID-shaped is refused even with the flag set', async () => {
      const client = optedInClient();
      await expect(client.post('/akoya_requests', { wmkf_istestrequest: true, wmkf_testcreationrunid: 'not-a-guid' }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('a nested/deep-insert marker is refused even with the flag set and an otherwise-sanctioned entity set', async () => {
      const client = optedInClient();
      await expect(client.post('/akoya_requests', { akoya_title: 'x', wmkf_Nested: { wmkf_istestrequest: true } }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('an array-nested (collection deep-insert) marker is refused even with the flag set (Codex 6c-i round 2)', async () => {
      const client = optedInClient();
      await expect(client.post('/akoya_requests', { akoya_title: 'x', wmkf_related: [{ wmkf_istestrequest: false }] }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      await expect(client.post('/akoya_requests', { akoya_title: 'x', wmkf_istestrequest: true, wmkf_related: [{ ok: 1 }, { wmkf_testcreationrunid: RUN_ID }] }))
        .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
      expect(fetch).not.toHaveBeenCalled();
    });

    test('the REAL create_request body (compileTestRequestDraft output) is allowed through the flag', async () => {
      // Mirrors basic-clone-steps.js compileBody -> policy.js compileTestRequestDraft's
      // createBody exactly: a flat POST body to /akoya_requests carrying both
      // markers at the top level, marker true, runId GUID-shaped.
      const createBody = {
        akoya_requestid: REQUEST_ID,
        'akoya_ApplicantId@odata.bind': `/accounts(${RUN_ID})`,
        akoya_title: 'TEST: example',
        akoya_fiscalyear: 'December 2026',
        wmkf_meetingdate: '2026-12-01',
        wmkf_meetingdate2: 100000000,
        wmkf_istestrequest: true,
        wmkf_testcreationrunid: RUN_ID,
        wmkf_respondreminderenabled: false,
        wmkf_reviewduereminderenabled: false,
      };
      const client = optedInClient();
      await client.postWithOptions('/akoya_requests', createBody, { Prefer: 'return=representation' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('the synthetic-person POST shape (D-R1) is allowed through the flag', async () => {
      const client = optedInClient();
      await client.post('/wmkf_potentialreviewerses', {
        wmkf_potentialreviewerid: REQUEST_ID,
        wmkf_name: 'TEST · Example Reviewer',
        wmkf_emailaddress: 'reviewer.one@example.test',
        wmkf_issyntheticreviewer: true,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  test('leaves ordinary writes and reads unchanged', async () => {
    const client = createClient({ resourceUrl: 'https://example.crm.dynamics.com', token: 't' });
    await client.patch(`/akoya_requests(${REQUEST_ID})`, { akoya_title: 'x' });
    await client.get('/akoya_requests?$select=wmkf_istestrequest');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
