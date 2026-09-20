/**
 * T1 (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5, Stage 1 card):
 * characterization pins for the four Stage 1 adapters BEFORE and AFTER they
 * are reimplemented over `readJsonBody(response, { tolerantBody: true })`
 * (plan §3 "Stage 1 adapters keep their legacy expressions verbatim"):
 *   - readResponse (shared/components/review-panel/review-panel-ui.js:64-68; was :62-66 before the import)
 *   - readResponse (pages/cycle-dossier.js:73-77, local copy; was :72-75)
 *   - readJson + sendJson (shared/components/meeting-tracker/SessionEditor.js:23-25, :27-36; were :22-24, :26-35)
 *
 * This file must pass unchanged against BOTH the unmigrated (legacy
 * `response.json().catch(() => ({}))`) and migrated adapters — it pins
 * observable behavior, not implementation.
 *
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { readResponse as sharedReadResponse } from '../../shared/components/review-panel/review-panel-ui';
import { readResponse as cycleDossierReadResponse } from '../../pages/cycle-dossier';
import { sendJson } from '../../shared/components/meeting-tracker/SessionEditor';

function fakeResponse({ ok, status, json }) {
  return { ok, status, json };
}

function jsonOk(body, status = 200) {
  return fakeResponse({ ok: true, status, json: () => Promise.resolve(body) });
}

function jsonFail(body, status = 400) {
  return fakeResponse({ ok: false, status, json: () => Promise.resolve(body) });
}

function rejectingJson(ok, status, err) {
  return fakeResponse({ ok, status, json: () => Promise.reject(err) });
}

const adapters = [
  { name: 'shared readResponse', fn: sharedReadResponse },
  { name: 'cycle-dossier readResponse', fn: cycleDossierReadResponse },
];

describe.each(adapters)('$name (T1 characterization)', ({ fn: readResponse }) => {
  test('2xx returns the parsed body as-is', async () => {
    const body = { ok: true, data: [1, 2, 3] };
    await expect(readResponse(jsonOk(body))).resolves.toEqual(body);
  });

  test('non-2xx {error} throws with the error string', async () => {
    await expect(readResponse(jsonFail({ error: 'X' }, 409))).rejects.toThrow('X');
  });

  test('non-2xx {message} only falls through to the fallback (NOT the message text)', async () => {
    await expect(readResponse(jsonFail({ message: 'x' }, 500))).rejects.toThrow('Request failed (500)');
  });

  test('non-2xx nested {error:{message}} stringifies the object (legacy behavior)', async () => {
    await expect(readResponse(jsonFail({ error: { message: 'm' } }, 400))).rejects.toThrow('[object Object]');
  });

  test('non-2xx {error: 5} stringifies the number', async () => {
    await expect(readResponse(jsonFail({ error: 5 }, 400))).rejects.toThrow('5');
  });

  test('non-2xx empty body (json rejects) falls through to the fallback', async () => {
    const err = new Error('Unexpected end of JSON input');
    await expect(readResponse(rejectingJson(false, 502, err))).rejects.toThrow('Request failed (502)');
  });

  test('non-2xx non-JSON body (json rejects with SyntaxError) falls through to the fallback', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    await expect(readResponse(rejectingJson(false, 500, err))).rejects.toThrow('Request failed (500)');
  });

  test('thrown value is a plain Error, not ApiRequestError', async () => {
    try {
      await readResponse(jsonFail({ error: 'X' }, 400));
      throw new Error('expected readResponse to throw');
    } catch (e) {
      expect(e.name).toBe('Error');
      expect(e.constructor.name).toBe('Error');
    }
  });
});

describe('sendJson (SessionEditor.js) (T1 characterization)', () => {
  function makeFetchImpl(response) {
    return jest.fn().mockResolvedValue(response);
  }

  test('2xx returns the parsed body as-is', async () => {
    const body = { session: { sessionId: 'abc' } };
    const fetchImpl = makeFetchImpl(jsonOk(body));
    await expect(sendJson('/api/x', 'POST', { a: 1 }, fetchImpl)).resolves.toEqual(body);
  });

  test('non-2xx {error} throws with the error string', async () => {
    const fetchImpl = makeFetchImpl(jsonFail({ error: 'X' }, 409));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('X');
  });

  test('non-2xx {message} only falls through to the site fallback', async () => {
    const fetchImpl = makeFetchImpl(jsonFail({ message: 'x' }, 500));
    await expect(sendJson('/api/x', 'PATCH', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('non-2xx nested {error:{message}} stringifies the object (legacy behavior)', async () => {
    const fetchImpl = makeFetchImpl(jsonFail({ error: { message: 'm' } }, 400));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('[object Object]');
  });

  test('non-2xx {error: 5} stringifies the number', async () => {
    const fetchImpl = makeFetchImpl(jsonFail({ error: 5 }, 400));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('5');
  });

  test('non-2xx empty body (json rejects) falls through to the site fallback', async () => {
    const err = new Error('Unexpected end of JSON input');
    const fetchImpl = makeFetchImpl(rejectingJson(false, 502, err));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('non-2xx non-JSON body (json rejects with SyntaxError) falls through to the site fallback', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    const fetchImpl = makeFetchImpl(rejectingJson(false, 500, err));
    await expect(sendJson('/api/x', 'PATCH', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('thrown value is a plain Error, not ApiRequestError', async () => {
    const fetchImpl = makeFetchImpl(jsonFail({ error: 'X' }, 400));
    try {
      await sendJson('/api/x', 'POST', {}, fetchImpl);
      throw new Error('expected sendJson to throw');
    } catch (e) {
      expect(e.name).toBe('Error');
      expect(e.constructor.name).toBe('Error');
    }
  });

  test('issues the request through fetchImpl with JSON content-type and body, honoring the given method', async () => {
    const fetchImpl = makeFetchImpl(jsonOk({ ok: true }));
    const payload = { etag: 'W/"1"', foo: 'bar' };
    await sendJson('/api/meeting-tracker/sessions/abc', 'PATCH', payload, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/meeting-tracker/sessions/abc');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(payload));
  });

  test('defaults fetchImpl to the global fetch when not supplied', async () => {
    const body = { ok: true };
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(jsonOk(body));
    try {
      await expect(sendJson('/api/x', 'POST', {})).resolves.toEqual(body);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('Stage 1 abort rethrow is unobservable (T1 static assertion)', () => {
  // Plan §3 invariant 4 rethrows a rejection when `signal?.aborted` or the
  // rejection's `name` is 'AbortError'. None of the four Stage 1 consumer
  // files passes a `signal` or creates an `AbortController`
  // [VERIFIED via grep, 0 hits each — plan §3], so that rethrow branch can
  // never fire from these call sites in Stage 1. If a later change adds a
  // signal/AbortController here, this test fails and the site must be
  // re-characterized (T2+) before the abort path becomes observable.
  const consumerFiles = [
    'pages/review-panel.js',
    'shared/components/workbench/ReviewPanelTab.js',
    'pages/cycle-dossier.js',
    'shared/components/meeting-tracker/SessionEditor.js',
  ];

  test.each(consumerFiles)('%s has no signal / AbortController usage', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
    expect(source).not.toMatch(/\bsignal\b/);
    expect(source).not.toMatch(/AbortController/);
  });
});
