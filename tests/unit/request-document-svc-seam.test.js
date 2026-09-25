/**
 * Test Request Factory slice 6b, Stage B, item A — the optional `options.svc`
 * seam on lib/dataverse/adapters/request-document.js `create`/`update`.
 *
 * Default-preserving pin: with no `svc`, both functions still go through the
 * module-singleton `DynamicsService` (production behavior, unchanged). With
 * an explicit sandbox-shaped `svc` (its own `baseUrl`), both functions route
 * through write-core.js directly and land on THAT host, never
 * `process.env.DYNAMICS_URL` (a real production host from the registry).
 *
 * @jest-environment node
 */

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { _withCallerId, _writeFetch } from '../../lib/services/dynamics/write-core.js';
import { buildHeaders } from '../../lib/services/dynamics/http.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry.js';

const PROD_HOST = PRODUCTION_HOSTS[0];
const SANDBOX_HOST = SANDBOX_HOSTS[0];

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:request-document-svc-seam', fn);
}

function okResponse(body = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

beforeAll(() => {
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  fetch.mockReset();
  DynamicsService.clearCaches();
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
});

function sandboxSvc() {
  return Object.freeze({
    baseUrl: `https://${SANDBOX_HOST}/api/data/v9.2`,
    getAccessToken: () => Promise.resolve('sandbox-tok'),
    buildHeaders,
    processAnnotations,
    _withCallerId,
    _writeFetch,
  });
}

describe('request-document.create — svc seam', () => {
  test('with no svc, still targets the production DYNAMICS_URL via DynamicsService', ctx(async () => {
    fetch.mockImplementation((url) => {
      if (new URL(String(url)).hostname === 'login.microsoftonline.com') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve(okResponse({ wmkf_requestdocumentid: 'x' }));
    });
    await requestDocumentAdapter.create({ wmkf_name: 'x' }, {});
    const nonAuth = fetch.mock.calls.filter(([u]) => new URL(String(u)).hostname !== 'login.microsoftonline.com');
    expect(nonAuth[0][0]).toContain(PROD_HOST);
  }));

  test('with an explicit svc, targets the sandbox host, never DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve(okResponse({ wmkf_requestdocumentid: 'x' })));
    await requestDocumentAdapter.create({ wmkf_name: 'x' }, { svc: sandboxSvc() });
    const [url] = fetch.mock.calls[0];
    expect(url).toContain(SANDBOX_HOST);
    expect(url).not.toContain(PROD_HOST);
  }));
});

describe('request-document.update — svc seam', () => {
  test('with no svc, still targets the production DYNAMICS_URL via DynamicsService', ctx(async () => {
    fetch.mockImplementation((url) => {
      if (new URL(String(url)).hostname === 'login.microsoftonline.com') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) });
      }
      return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    });
    await requestDocumentAdapter.update('abc-123', { wmkf_name: 'x' }, {});
    const nonAuth = fetch.mock.calls.filter(([u]) => new URL(String(u)).hostname !== 'login.microsoftonline.com');
    expect(nonAuth[0][0]).toContain(PROD_HOST);
  }));

  test('with an explicit svc, targets the sandbox host, never DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }));
    await requestDocumentAdapter.update('abc-123', { wmkf_name: 'x' }, { svc: sandboxSvc() });
    const [url] = fetch.mock.calls[0];
    expect(url).toContain(SANDBOX_HOST);
    expect(url).not.toContain(PROD_HOST);
  }));
});
