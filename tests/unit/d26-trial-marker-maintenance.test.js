import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('../../lib/dataverse/client.js');
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ETAG = 'W/"12345"';
const envKeys = ['NODE_ENV', 'VERCEL_ENV', 'DATAVERSE_TARGET_INTERLOCK', 'DATAVERSE_ALLOW_PROD_READS', 'DATAVERSE_PROD_WRITE_ACK'];
let savedEnv;

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, text: async () => body == null ? '' : JSON.stringify(body) };
}

function requestRow(marker = false) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1003220',
    '@odata.etag': ETAG,
    wmkf_istestrequest: marker,
    wmkf_testcreationrunid: RUN_ID,
  };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  process.env.DATAVERSE_ALLOW_PROD_READS = 'yes';
  process.env.DATAVERSE_PROD_WRITE_ACK = `D26 marker maintenance ${new Date().toISOString().slice(0, 10)}`;
  fetch.mockReset();
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('generic PATCH remains refused with the ordinary factory create option enabled', async () => {
  const client = createClient({ resourceUrl: 'https://wmkf.crm.dynamics.com', token: 'test', allowTestRequestMarkerWrites: true });
  await expect(client.patch(`/akoya_requests(${REQUEST_ID})`, { wmkf_istestrequest: true }))
    .rejects.toMatchObject({ code: 'test_request_marker_immutable' });
  expect(fetch).not.toHaveBeenCalled();
});

test('specific maintenance method resolves by allowlisted number and ETag-patches only the marker', async () => {
  fetch.mockImplementation(async (url, options) => {
    if (options.method === 'PATCH') return response(204);
    if (String(url).includes('?$select=akoya_requestnum')) {
      return response(200, { ...requestRow(true) });
    }
    return response(200, { value: [requestRow(false)] });
  });
  const client = createClient({ resourceUrl: 'https://wmkf.crm.dynamics.com', token: 'test' });

  await expect(client.maintainD26TrialTestMarker('1003220', { apply: true })).resolves.toMatchObject({
    requestNumber: '1003220', state: 'verified-marked', runIdPresent: true, applied: true, patchResponseOk: true,
  });

  const patchCall = fetch.mock.calls.find(([, options]) => options.method === 'PATCH');
  expect(patchCall).toBeDefined();
  expect(patchCall[1].headers['If-Match']).toBe(ETAG);
  expect(patchCall[1].headers).not.toHaveProperty('MSCRMCallerID');
  expect(JSON.parse(patchCall[1].body)).toEqual({ wmkf_istestrequest: true });
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(2);
});

test('dry run reads the exact row but does not PATCH; unlisted numbers fail before reads', async () => {
  fetch.mockResolvedValue(response(200, { value: [requestRow(false)] }));
  const client = createClient({ resourceUrl: 'https://wmkf.crm.dynamics.com', token: 'test' });

  await expect(client.maintainD26TrialTestMarker('1003220')).resolves.toMatchObject({ state: 'would-mark', applied: false });
  await expect(client.maintainD26TrialTestMarker('1003223', { apply: true })).rejects.toThrow('fixed D26 marker-maintenance allowlist');
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(0);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(1);
});

test('PATCH transport error is resolved by readback and is never retried', async () => {
  fetch.mockImplementation(async (url, options) => {
    if (options.method === 'PATCH') throw new Error('connection interrupted');
    if (String(url).includes('?$select=akoya_requestnum')) return response(200, { ...requestRow(true) });
    return response(200, { value: [requestRow(false)] });
  });
  const client = createClient({ resourceUrl: 'https://wmkf.crm.dynamics.com', token: 'test' });

  await expect(client.maintainD26TrialTestMarker('1003220', { apply: true })).resolves.toMatchObject({
    state: 'verified-marked', applied: false, patchResponseOk: false, patchError: true,
  });
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(2);
});

test('missing ETag and non-local execution both stop before a PATCH', async () => {
  fetch.mockResolvedValue(response(200, { value: [{ ...requestRow(false), '@odata.etag': undefined }] }));
  const client = createClient({ resourceUrl: 'https://wmkf.crm.dynamics.com', token: 'test' });
  await expect(client.maintainD26TrialTestMarker('1003220', { apply: true })).rejects.toThrow('missing ETag');

  process.env.VERCEL_ENV = 'production';
  await expect(client.maintainD26TrialTestMarker('1003220')).rejects.toThrow('only from a local process');
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(0);
});
