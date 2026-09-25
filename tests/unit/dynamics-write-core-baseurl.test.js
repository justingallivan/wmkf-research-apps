/**
 * Test Request Factory slice 6b, Stage B, item A —
 * lib/services/dynamics/write-core.js baseUrl preference.
 *
 * Pins the same `svc.baseUrl` preference `executeChangeset`
 * (lib/services/dynamics/changeset.js) already has, now applied identically
 * to the four write-core mutators (`createRecord`, `updateRecord`,
 * `deleteRecord`, `disassociate`): a service that supplies its own
 * `svc.baseUrl` (the Test Request Factory sandbox deps shape) is bound to
 * that host and never falls back to `process.env.DYNAMICS_URL`, even when
 * DYNAMICS_URL points at a real production host from the same registry.
 * A service with no `baseUrl` property (the module singleton) keeps
 * reading DYNAMICS_URL exactly as before.
 *
 * @jest-environment node
 */

import {
  createRecord,
  updateRecord,
  deleteRecord,
  disassociate,
  _withCallerId,
  _writeFetch,
} from '../../lib/services/dynamics/write-core.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry.js';

const PROD_HOST = PRODUCTION_HOSTS[0];
const SANDBOX_HOST = SANDBOX_HOSTS[0];

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:dynamics-write-core-baseurl', fn);
}

function okResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

beforeAll(() => {
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  fetch.mockReset();
  // DYNAMICS_URL deliberately points at a PRODUCTION host from the tracked
  // registry — proves a `svc.baseUrl`-bearing service never falls back to it.
  process.env.DYNAMICS_URL = `https://${PROD_HOST}`;
});

function sandboxSvc(extraHeaders) {
  return Object.freeze({
    baseUrl: `https://${SANDBOX_HOST}/api/data/v9.2`,
    getAccessToken: () => Promise.resolve('sandbox-tok'),
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}`, ...extraHeaders }),
    _withCallerId,
    _writeFetch,
    processAnnotations: (x) => x,
  });
}

function singletonLikeSvc() {
  // No `baseUrl` property at all — matches the DynamicsService singleton shape.
  return Object.freeze({
    getAccessToken: () => Promise.resolve('singleton-tok'),
    buildHeaders: (token) => ({ Authorization: `Bearer ${token}` }),
    _withCallerId,
    _writeFetch,
    processAnnotations: (x) => x,
  });
}

describe('write-core baseUrl preference — sandbox svc never falls back to DYNAMICS_URL', () => {
  test('createRecord targets svc.baseUrl, not the production DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve(okResponse({ id: 1 })));
    await createRecord(sandboxSvc(), 'wmkf_requestdocuments', { foo: 'bar' });
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${SANDBOX_HOST}/api/data/v9.2/wmkf_requestdocuments`);
    expect(url).not.toContain(PROD_HOST);
  }));

  test('updateRecord targets svc.baseUrl, not the production DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }));
    await updateRecord(sandboxSvc(), 'wmkf_requestdocuments', 'abc-123', { foo: 'bar' });
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${SANDBOX_HOST}/api/data/v9.2/wmkf_requestdocuments(abc-123)`);
    expect(url).not.toContain(PROD_HOST);
  }));

  test('deleteRecord targets svc.baseUrl, not the production DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }));
    await deleteRecord(sandboxSvc(), 'wmkf_requestdocuments', 'abc-123');
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${SANDBOX_HOST}/api/data/v9.2/wmkf_requestdocuments(abc-123)`);
    expect(url).not.toContain(PROD_HOST);
  }));

  test('disassociate targets svc.baseUrl, not the production DYNAMICS_URL', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }));
    await disassociate(sandboxSvc(), 'wmkf_requestdocuments', 'abc-123', 'wmkf_Request');
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${SANDBOX_HOST}/api/data/v9.2/wmkf_requestdocuments(abc-123)/wmkf_Request/$ref`);
    expect(url).not.toContain(PROD_HOST);
  }));
});

describe('write-core baseUrl preference — default-preserving for the no-baseUrl (singleton) shape', () => {
  test('createRecord falls back to DYNAMICS_URL when svc has no baseUrl', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve(okResponse({ id: 1 })));
    await createRecord(singletonLikeSvc(), 'wmkf_requestdocuments', { foo: 'bar' });
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${PROD_HOST}/api/data/v9.2/wmkf_requestdocuments`);
  }));

  test('updateRecord falls back to DYNAMICS_URL when svc has no baseUrl', ctx(async () => {
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') }));
    await updateRecord(singletonLikeSvc(), 'wmkf_requestdocuments', 'abc-123', { foo: 'bar' });
    const [url] = fetch.mock.calls[0];
    expect(url).toBe(`https://${PROD_HOST}/api/data/v9.2/wmkf_requestdocuments(abc-123)`);
  }));
});
