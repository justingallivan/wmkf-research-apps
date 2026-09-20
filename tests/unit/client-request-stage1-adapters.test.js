/**
 * T1 (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5, Stage 1 card),
 * extended for the Client Request Layer Stage 6 Part A fold
 * (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §2.6/§3, closeout
 * ratchet): characterization pins for the four Stage 1 adapters, now taking
 * `(url, options)` instead of a `Response`, so the raw `fetch(` call moves
 * INSIDE the adapter (over `requestEnvelope`) and out of every consumer file.
 *   - readResponse (shared/components/review-panel/review-panel-ui.js)
 *   - readResponse (pages/cycle-dossier.js, local copy)
 *   - readJson + sendJson (shared/components/meeting-tracker/SessionEditor.js)
 *
 * This file pins observable behavior (thrown message text, return value,
 * exact request bytes sent to `fetchImpl`), not implementation.
 *
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import { readResponse as sharedReadResponse } from '../../shared/components/review-panel/review-panel-ui';
import { readResponse as cycleDossierReadResponse } from '../../pages/cycle-dossier';
import { readJson, sendJson } from '../../shared/components/meeting-tracker/SessionEditor';

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

function fetchImplFor(response) {
  return jest.fn().mockResolvedValue(response);
}

const adapters = [
  { name: 'shared readResponse', fn: sharedReadResponse },
  { name: 'cycle-dossier readResponse', fn: cycleDossierReadResponse },
];

describe.each(adapters)('$name (T1 characterization, url-based signature)', ({ fn: readResponse }) => {
  test('2xx returns the parsed body as-is', async () => {
    const body = { ok: true, data: [1, 2, 3] };
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(jsonOk(body)) })).resolves.toEqual(body);
  });

  test('non-2xx {error} throws with the error string', async () => {
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(jsonFail({ error: 'X' }, 409)) })).rejects.toThrow('X');
  });

  test('non-2xx {message} only falls through to the fallback (NOT the message text)', async () => {
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(jsonFail({ message: 'x' }, 500)) })).rejects.toThrow('Request failed (500)');
  });

  test('non-2xx nested {error:{message}} stringifies the object (legacy behavior)', async () => {
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(jsonFail({ error: { message: 'm' } }, 400)) })).rejects.toThrow('[object Object]');
  });

  test('non-2xx {error: 5} stringifies the number', async () => {
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(jsonFail({ error: 5 }, 400)) })).rejects.toThrow('5');
  });

  test('non-2xx empty body (json rejects) falls through to the fallback', async () => {
    const err = new Error('Unexpected end of JSON input');
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(rejectingJson(false, 502, err)) })).rejects.toThrow('Request failed (502)');
  });

  test('non-2xx non-JSON body (json rejects with SyntaxError) falls through to the fallback', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    await expect(readResponse('/api/x', { fetchImpl: fetchImplFor(rejectingJson(false, 500, err)) })).rejects.toThrow('Request failed (500)');
  });

  test('thrown value is a plain Error, not ApiRequestError', async () => {
    try {
      await readResponse('/api/x', { fetchImpl: fetchImplFor(jsonFail({ error: 'X' }, 400)) });
      throw new Error('expected readResponse to throw');
    } catch (e) {
      expect(e.name).toBe('Error');
      expect(e.constructor.name).toBe('Error');
    }
  });

  test('issues the request through fetchImpl with the given URL, method, and JSON body', async () => {
    const fetchImpl = fetchImplFor(jsonOk({ ok: true }));
    const payload = { action: 'launch', foo: 'bar' };
    await readResponse('/api/cycle-dossier', { method: 'POST', body: payload, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/cycle-dossier');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(payload));
  });

  test('a plain GET call (no options) issues a GET with no body', async () => {
    const fetchImpl = fetchImplFor(jsonOk({ ok: true }));
    await readResponse('/api/review-panel', { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/review-panel');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  test('defaults fetchImpl to the global fetch when not supplied', async () => {
    const body = { ok: true };
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(jsonOk(body));
    try {
      await expect(readResponse('/api/x')).resolves.toEqual(body);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('readJson (SessionEditor.js) (T1 characterization, url-based signature)', () => {
  test('returns the requestEnvelope shape ({ ok, status, data, error })', async () => {
    const body = { sessions: [1, 2] };
    const fetchImpl = fetchImplFor(jsonOk(body, 200));
    const envelope = await readJson('/api/meeting-tracker/sessions', { fetchImpl });
    expect(envelope).toEqual({ ok: true, status: 200, data: body, error: null });
  });

  test('non-2xx never throws; data is the tolerant parsed body', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ error: 'nope' }, 404));
    const envelope = await readJson('/api/meeting-tracker/sessions/x', { fetchImpl });
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe(404);
    expect(envelope.data).toEqual({ error: 'nope' });
  });

  test('non-2xx unparseable body tolerates to {} (does not reject)', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    const fetchImpl = fetchImplFor(rejectingJson(false, 502, err));
    const envelope = await readJson('/api/meeting-tracker/sessions', { fetchImpl });
    expect(envelope.ok).toBe(false);
    expect(envelope.data).toEqual({});
  });

  test('issues a GET by default through fetchImpl', async () => {
    const fetchImpl = fetchImplFor(jsonOk({ ok: true }));
    await readJson('/api/meeting-tracker/recipients', { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/meeting-tracker/recipients');
    expect(init.method).toBe('GET');
  });
});

describe('sendJson (SessionEditor.js) (T1 characterization)', () => {
  test('2xx returns the parsed body as-is', async () => {
    const body = { session: { sessionId: 'abc' } };
    const fetchImpl = fetchImplFor(jsonOk(body));
    await expect(sendJson('/api/x', 'POST', { a: 1 }, fetchImpl)).resolves.toEqual(body);
  });

  test('non-2xx {error} throws with the error string', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ error: 'X' }, 409));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('X');
  });

  test('non-2xx {message} only falls through to the site fallback', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ message: 'x' }, 500));
    await expect(sendJson('/api/x', 'PATCH', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('non-2xx nested {error:{message}} stringifies the object (legacy behavior)', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ error: { message: 'm' } }, 400));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('[object Object]');
  });

  test('non-2xx {error: 5} stringifies the number', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ error: 5 }, 400));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl)).rejects.toThrow('5');
  });

  test('non-2xx empty body (json rejects) falls through to the site fallback', async () => {
    const err = new Error('Unexpected end of JSON input');
    const fetchImpl = fetchImplFor(rejectingJson(false, 502, err));
    await expect(sendJson('/api/x', 'POST', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('non-2xx non-JSON body (json rejects with SyntaxError) falls through to the site fallback', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    const fetchImpl = fetchImplFor(rejectingJson(false, 500, err));
    await expect(sendJson('/api/x', 'PATCH', {}, fetchImpl))
      .rejects.toThrow('The schedule change could not be saved.');
  });

  test('thrown value is a plain Error, not ApiRequestError', async () => {
    const fetchImpl = fetchImplFor(jsonFail({ error: 'X' }, 400));
    try {
      await sendJson('/api/x', 'POST', {}, fetchImpl);
      throw new Error('expected sendJson to throw');
    } catch (e) {
      expect(e.name).toBe('Error');
      expect(e.constructor.name).toBe('Error');
    }
  });

  test('issues the request through fetchImpl with JSON content-type and body, honoring the given method', async () => {
    const fetchImpl = fetchImplFor(jsonOk({ ok: true }));
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

describe('Stage 1 fold consumer files carry zero raw fetch( sites (T1 static assertion)', () => {
  // Part A of the Stage 6 closeout ratchet moved the fetch call INSIDE each
  // adapter, so none of these four files may retain a raw `fetch(` call —
  // that is exactly what the Stage 6 ESLint ratchet rule (no-restricted-syntax
  // on `fetch(`) would otherwise flag. A grep-based static assertion, matching
  // this file's existing convention below for the signal/AbortController pin.
  const consumerFiles = [
    'pages/review-panel.js',
    'shared/components/workbench/ReviewPanelTab.js',
    'pages/cycle-dossier.js',
    'shared/components/meeting-tracker/SessionEditor.js',
  ];

  test.each(consumerFiles)('%s has no raw fetch( call', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
    // Matches a call to the identifier `fetch`, not `fetchImpl(...)` or a
    // property access like `window.fetch(...)`.
    expect(source).not.toMatch(/(?<![\w.])fetch\(/);
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
