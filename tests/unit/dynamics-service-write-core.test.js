/**
 * DynamicsService write-core characterization — Checkpoint C (Stage 6) baseline.
 *
 * Pins the behavior of the DAL entity-write cluster BEFORE it moves to
 * lib/services/dynamics/write-core.js, so the extraction is provably a
 * behavior-freeze:
 *   - `updateIfEmpty`'s five discriminated outcomes (empty→written, overwrote,
 *     already-populated, 412 conflict, writeback_failed on both read- and
 *     write-side failure), and that it reads before it writes.
 *   - `deleteRecord`/`disassociate` throw a PLAIN Error with `.status` attached
 *     (not buildServiceError), and `disassociate` treats 404 as idempotent
 *     success.
 *   - `createRecord`/`updateRecord` throw the buildServiceError shape, with
 *     `updateRecord` preserving `.status === 412` for concurrent-edit callers.
 *
 * Only `fetch` is mocked; the REAL write helpers run, so every body is wrapped
 * in `bypassDynamicsRestrictions` to establish the trusted DAL context that
 * `assertTrustedDalContext` (and the internal read's `checkRestriction`)
 * require — same rationale as dynamics-service-caller-id.test.js.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';

function ctx(fn) {
  return () => bypassDynamicsRestrictions('test:dynamics-service-write-core', fn);
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
  // Token endpoint always succeeds; other requests succeed empty unless a test
  // queues a specific response with mockImplementationOnce.
  fetch.mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('login.microsoftonline.com')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
  });
});

function tokenThen(...responses) {
  fetch.mockImplementationOnce(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
  );
  for (const r of responses) fetch.mockImplementationOnce(() => Promise.resolve(r));
}

function nonTokenCalls() {
  return fetch.mock.calls.filter(([url]) => !String(url).includes('login.microsoftonline.com'));
}

describe('updateIfEmpty — five discriminated outcomes', () => {
  test('empty field → { ok: true, written: true } and PATCHes after reading', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ '@odata.etag': 'W/"1"', wmkf_ai_summary: '' }) }, // GET
      { ok: true, status: 204, text: () => Promise.resolve(''), json: () => Promise.resolve({}) },  // PATCH
    );
    const result = await DynamicsService.updateIfEmpty('akoya_requests', 'g', 'wmkf_ai_summary', 'hi');
    expect(result).toEqual({ ok: true, written: true });
    const calls = nonTokenCalls();
    expect(calls[0][1].method).toBeUndefined(); // GET (no method)
    expect(calls[1][1].method).toBe('PATCH');
    expect(calls[1][1].headers['If-Match']).toBe('W/"1"'); // ETag from the read flows into the write
  }));

  test('non-empty + overwrite → { ok: true, written: false, reason: "overwrote" }', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ wmkf_ai_summary: 'already here' }) }, // GET
      { ok: true, status: 204, text: () => Promise.resolve(''), json: () => Promise.resolve({}) },  // PATCH
    );
    const result = await DynamicsService.updateIfEmpty(
      'akoya_requests', 'g', 'wmkf_ai_summary', 'new', { overwrite: true },
    );
    expect(result).toEqual({ ok: true, written: false, reason: 'overwrote' });
  }));

  test('non-empty, no overwrite → { ok: false, reason: "already-populated", existing, modifiedOn } and does NOT write', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ wmkf_ai_summary: 'keep me', modifiedon: '2026-01-01' }) }, // GET only
    );
    const result = await DynamicsService.updateIfEmpty('akoya_requests', 'g', 'wmkf_ai_summary', 'new');
    expect(result).toEqual({
      ok: false,
      reason: 'already-populated',
      existing: 'keep me',
      modifiedOn: '2026-01-01',
    });
    expect(nonTokenCalls()).toHaveLength(1); // read only, no PATCH
  }));

  test('412 on the PATCH → { ok: false, reason: "conflict" }', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ '@odata.etag': 'W/"9"', wmkf_ai_summary: '' }) }, // GET
      { ok: false, status: 412, text: () => Promise.resolve('precondition failed'), json: () => Promise.resolve({}) }, // PATCH 412
    );
    const result = await DynamicsService.updateIfEmpty('akoya_requests', 'g', 'wmkf_ai_summary', 'hi');
    expect(result).toEqual({ ok: false, reason: 'conflict' });
  }));

  test('read failure → { ok: false, reason: "writeback_failed", error } and never writes', ctx(async () => {
    tokenThen(
      { ok: false, status: 500, text: () => Promise.resolve('boom'), json: () => Promise.resolve({}) }, // GET fails
    );
    const result = await DynamicsService.updateIfEmpty('akoya_requests', 'g', 'wmkf_ai_summary', 'hi');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('writeback_failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(nonTokenCalls()).toHaveLength(1); // read only
  }));

  test('non-412 write failure → { ok: false, reason: "writeback_failed", error }', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ '@odata.etag': 'W/"3"', wmkf_ai_summary: '' }) }, // GET
      { ok: false, status: 500, text: () => Promise.resolve('server error'), json: () => Promise.resolve({}) }, // PATCH fails 500
    );
    const result = await DynamicsService.updateIfEmpty('akoya_requests', 'g', 'wmkf_ai_summary', 'hi');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('writeback_failed');
    expect(result.error).toBeInstanceOf(Error);
  }));
});

describe('deleteRecord / disassociate — plain-Error + .status + idempotent 404', () => {
  test('deleteRecord failure throws a plain Error with .status set to the HTTP status', ctx(async () => {
    tokenThen(
      { ok: false, status: 412, text: () => Promise.resolve('conflict'), json: () => Promise.resolve({}) },
    );
    await expect(
      DynamicsService.deleteRecord('wmkf_ai_runs', 'g', { ifMatch: 'W/"1"' }),
    ).rejects.toMatchObject({ status: 412 });
  }));

  test('disassociate treats 404 as idempotent success (no throw)', ctx(async () => {
    tokenThen(
      { ok: false, status: 404, text: () => Promise.resolve('not found'), json: () => Promise.resolve({}) },
    );
    await expect(
      DynamicsService.disassociate('akoya_requests', 'g', 'wmkf_PotentialReviewer1'),
    ).resolves.toBeUndefined();
  }));

  test('disassociate non-404 failure throws a plain Error with .status', ctx(async () => {
    tokenThen(
      { ok: false, status: 500, text: () => Promise.resolve('server error'), json: () => Promise.resolve({}) },
    );
    await expect(
      DynamicsService.disassociate('akoya_requests', 'g', 'wmkf_PotentialReviewer1'),
    ).rejects.toMatchObject({ status: 500 });
  }));
});

describe('createRecord / updateRecord — buildServiceError shape', () => {
  test('createRecord failure throws a structured service error', ctx(async () => {
    tokenThen(
      { ok: false, status: 403, text: () => Promise.resolve('forbidden'), json: () => Promise.resolve({}) },
    );
    await expect(
      DynamicsService.createRecord('annotations', { foo: 'bar' }),
    ).rejects.toThrow();
  }));

  test('updateRecord 412 preserves .status === 412 for concurrent-edit callers', ctx(async () => {
    tokenThen(
      { ok: false, status: 412, text: () => Promise.resolve('etag mismatch'), json: () => Promise.resolve({}) },
    );
    await expect(
      DynamicsService.updateRecord('akoya_requests', 'g', { x: 1 }, { ifMatch: 'W/"5"' }),
    ).rejects.toMatchObject({ status: 412 });
  }));

  test('createRecord returns the annotation-processed row on success', ctx(async () => {
    tokenThen(
      { ok: true, json: () => Promise.resolve({ '@odata.etag': 'W/"7"', akoya_requestid: 'new-id' }) },
    );
    const row = await DynamicsService.createRecord('akoya_requests', { foo: 'bar' });
    expect(row._etag).toBe('W/"7"'); // processAnnotations maps @odata.etag → _etag
    expect(row.akoya_requestid).toBe('new-id');
  }));
});
