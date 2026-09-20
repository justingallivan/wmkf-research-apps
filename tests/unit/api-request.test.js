/**
 * T0 (docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5): every §3
 * invariant for shared/utils/api-request.js. Zero production callers exist
 * yet (Stage 0); this is characterization/contract coverage for the helper
 * itself.
 *
 * @jest-environment node
 */

import {
  ApiRequestError,
  deriveErrorMessage,
  readJsonBody,
  requestJson,
  requestEnvelope,
} from '../../shared/utils/api-request';

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

describe('deriveErrorMessage', () => {
  test('string payload.error wins', () => {
    expect(deriveErrorMessage({ error: 'nope' }, null, 'fallback', 400)).toBe('nope');
  });

  test('object payload.error.message used when error is not a string', () => {
    expect(deriveErrorMessage({ error: { code: 'X', message: 'nested' } }, null, 'fallback', 400)).toBe('nested');
  });

  test('payload.message used when no usable payload.error', () => {
    expect(deriveErrorMessage({ message: 'msg-only' }, null, 'fallback', 400)).toBe('msg-only');
  });

  test('payload.error as a non-string, non-message-bearing value falls through to payload.message', () => {
    expect(deriveErrorMessage({ error: 5, message: 'msg-only' }, null, 'fallback', 400)).toBe('msg-only');
  });

  test('fallbackMessage used when payload has nothing usable', () => {
    expect(deriveErrorMessage({}, null, 'fallback', 400)).toBe('fallback');
  });

  test('generic "Request failed (status)" when nothing else is available', () => {
    expect(deriveErrorMessage({}, null, undefined, 503)).toBe('Request failed (503)');
  });

  test('typeof payload guard: non-object payload never throws, falls through to fallback', () => {
    expect(deriveErrorMessage('a string body', null, 'fallback', 400)).toBe('fallback');
    expect(deriveErrorMessage(null, null, 'fallback', 400)).toBe('fallback');
    expect(deriveErrorMessage(42, null, undefined, 400)).toBe('Request failed (400)');
  });

  test('public default preferParseError: false — body message rule wins over parseError', () => {
    const parseError = new SyntaxError('Unexpected end of JSON input');
    expect(deriveErrorMessage({ error: 'body message' }, parseError, 'fallback', 400)).toBe('body message');
    // default omitted entirely — asserts the module's actual default, not a test default
    expect(deriveErrorMessage({}, parseError, 'fallback', 400, undefined)).toBe('fallback');
  });

  test('preferParseError: true — parseError.message wins when a parseError was recorded', () => {
    const parseError = new SyntaxError('Unexpected end of JSON input');
    expect(
      deriveErrorMessage({ error: 'body message' }, parseError, 'fallback', 400, { preferParseError: true })
    ).toBe('Unexpected end of JSON input');
  });

  test('preferParseError: true has no effect when parseError is null', () => {
    expect(
      deriveErrorMessage({ error: 'body message' }, null, 'fallback', 400, { preferParseError: true })
    ).toBe('body message');
  });

  test('empty string payload.error is treated as absent, falls through to fallback', () => {
    expect(deriveErrorMessage({ error: '' }, null, 'fallback', 400)).toBe('fallback');
  });

  test('empty string payload.message is treated as absent, falls through to fallback', () => {
    expect(deriveErrorMessage({ message: '' }, null, 'fallback', 400)).toBe('fallback');
  });

  test('non-string error.message (e.g. a number) is ignored, falls through to fallback', () => {
    expect(deriveErrorMessage({ error: { message: 5 } }, null, 'fallback', 400)).toBe('fallback');
  });
});

describe('readJsonBody', () => {
  test('2xx JSON body returned as-is', async () => {
    const res = jsonOk({ hello: 'world' });
    await expect(readJsonBody(res)).resolves.toEqual({ hello: 'world' });
  });

  test('2xx empty/unparseable body: strict by default rejects with the native parse error', async () => {
    const err = new SyntaxError('Unexpected end of JSON input');
    const res = rejectingJson(true, 200, err);
    await expect(readJsonBody(res)).rejects.toBe(err);
  });

  test('2xx empty/unparseable body: tolerantBody true returns {}', async () => {
    const err = new SyntaxError('Unexpected end of JSON input');
    const res = rejectingJson(true, 200, err);
    await expect(readJsonBody(res, { tolerantBody: true })).resolves.toEqual({});
  });

  test('2xx empty/unparseable body: function-form tolerantBody returns the function value', async () => {
    const err = new SyntaxError('Unexpected end of JSON input');
    const res = rejectingJson(true, 200, err);
    const fallback = { ok: false, reason: 'server_error' };
    await expect(readJsonBody(res, { tolerantBody: () => fallback })).resolves.toBe(fallback);
  });

  test('malformed 2xx body: strict rejects with native parse error, name preserved', async () => {
    const err = new SyntaxError('Unexpected token < in JSON');
    const res = rejectingJson(true, 200, err);
    await expect(readJsonBody(res)).rejects.toMatchObject({ name: 'SyntaxError' });
  });

  test('malformed 2xx body: tolerant returns {}', async () => {
    const err = new SyntaxError('Unexpected token <');
    const res = rejectingJson(true, 200, err);
    await expect(readJsonBody(res, { tolerantBody: true })).resolves.toEqual({});
  });

  test('non-2xx unparseable body: always tolerant, returns {} regardless of tolerantBody', async () => {
    const err = new SyntaxError('Unexpected end of JSON input');
    const res = rejectingJson(false, 500, err);
    await expect(readJsonBody(res)).resolves.toEqual({});
    await expect(readJsonBody(res, { tolerantBody: false })).resolves.toEqual({});
  });

  test('AbortError raised during the body read is rethrown, strict mode', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const res = rejectingJson(true, 200, abortErr);
    await expect(readJsonBody(res)).rejects.toBe(abortErr);
  });

  test('AbortError raised during the body read is rethrown, tolerant mode', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const res = rejectingJson(true, 200, abortErr);
    await expect(readJsonBody(res, { tolerantBody: true })).rejects.toBe(abortErr);
  });

  test('AbortError during a non-2xx body read is also rethrown, not swallowed to {}', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const res = rejectingJson(false, 500, abortErr);
    await expect(readJsonBody(res)).rejects.toBe(abortErr);
  });

  test('signal.aborted true after a body-read failure rethrows even without AbortError name', async () => {
    const genericErr = new TypeError('network read failed');
    const res = rejectingJson(true, 200, genericErr);
    const signal = { aborted: true };
    await expect(readJsonBody(res, { signal, tolerantBody: true })).rejects.toBe(genericErr);
  });

  test('signal not aborted: a generic rejection on a tolerant 2xx body still resolves to {}', async () => {
    const genericErr = new TypeError('bad json');
    const res = rejectingJson(true, 200, genericErr);
    const signal = { aborted: false };
    await expect(readJsonBody(res, { signal, tolerantBody: true })).resolves.toEqual({});
  });

  test('mechanics: only response.json()/ok/status are touched, not headers/text/body', async () => {
    let jsonCalled = false;
    const res = {
      ok: true,
      status: 200,
      json: () => {
        jsonCalled = true;
        return Promise.resolve({ a: 1 });
      },
      get headers() {
        throw new Error('headers should not be read');
      },
      text: () => {
        throw new Error('text() should not be called');
      },
    };
    await expect(readJsonBody(res)).resolves.toEqual({ a: 1 });
    expect(jsonCalled).toBe(true);
  });
});

describe('requestJson', () => {
  test('resolves to the parsed body on 2xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({ id: 1 }));
    await expect(requestJson('/api/thing', { fetchImpl })).resolves.toEqual({ id: 1 });
  });

  test('throws ApiRequestError on non-2xx with a string payload.error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonFail({ error: 'bad request' }, 400));
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 400,
      message: 'bad request',
      payload: { error: 'bad request' },
      parseError: null,
    });
  });

  test('throws ApiRequestError on non-2xx with payload.message only', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonFail({ message: 'msg form' }, 404));
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toMatchObject({
      message: 'msg form',
      status: 404,
    });
  });

  test('throws ApiRequestError on non-2xx with nested error.message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonFail({ error: { code: 'X', message: 'nested msg' } }, 409));
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toMatchObject({
      message: 'nested msg',
      status: 409,
    });
  });

  test('non-2xx non-JSON body: parseError recorded, message falls back to fallbackMessage (D3 accepted default)', async () => {
    const parseErr = new SyntaxError('Unexpected end of JSON input');
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(false, 500, parseErr));
    await expect(
      requestJson('/api/thing', { fetchImpl, fallbackMessage: 'Something went wrong' })
    ).rejects.toMatchObject({
      message: 'Something went wrong',
      status: 500,
      payload: {},
      parseError: parseErr,
    });
  });

  test('non-2xx non-JSON body with no fallbackMessage: generic "Request failed (status)"', async () => {
    const parseErr = new SyntaxError('Unexpected end of JSON input');
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(false, 503, parseErr));
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toMatchObject({
      message: 'Request failed (503)',
    });
  });

  test('parseError is null on a normal 2xx or a parseable non-2xx body', async () => {
    const fetchImplOk = jest.fn().mockResolvedValue(jsonOk({ a: 1 }));
    await requestJson('/api/thing', { fetchImpl: fetchImplOk });

    const fetchImplFail = jest.fn().mockResolvedValue(jsonFail({ error: 'x' }, 400));
    try {
      await requestJson('/api/thing', { fetchImpl: fetchImplFail });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err.parseError).toBeNull();
    }
  });

  test('network rejection propagates unchanged (not wrapped)', async () => {
    const networkErr = new TypeError('Failed to fetch');
    const fetchImpl = jest.fn().mockRejectedValue(networkErr);
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toBe(networkErr);
  });

  test('AbortError from fetch itself propagates unchanged', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = jest.fn().mockRejectedValue(abortErr);
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toBe(abortErr);
  });

  test('malformed 2xx body strict by default: rejects with native parse error, not wrapped', async () => {
    const parseErr = new SyntaxError('bad json');
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(true, 200, parseErr));
    await expect(requestJson('/api/thing', { fetchImpl })).rejects.toBe(parseErr);
  });

  test('malformed 2xx body with tolerantBody: true resolves to {}', async () => {
    const parseErr = new SyntaxError('bad json');
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(true, 200, parseErr));
    await expect(requestJson('/api/thing', { fetchImpl, tolerantBody: true })).resolves.toEqual({});
  });

  test('a plain-object body is JSON.stringify-d and gets a default Content-Type', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    await requestJson('/api/thing', { method: 'POST', body: { a: 1 }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('/api/thing', {
      method: 'POST',
      signal: undefined,
      body: JSON.stringify({ a: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  test('FormData body passes through untouched, no content-type added', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    const fd = new FormData();
    fd.append('file', 'x');
    await requestJson('/api/upload', { method: 'POST', body: fd, fetchImpl });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.body).toBe(fd);
    expect(callArgs.headers).toBeUndefined();
  });

  test('Blob body passes through untouched, no content-type added', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    const blob = new Blob(['x'], { type: 'text/plain' });
    await requestJson('/api/upload', { method: 'POST', body: blob, fetchImpl });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.body).toBe(blob);
    expect(callArgs.headers).toBeUndefined();
  });

  test('string body passes through untouched, no content-type added', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    await requestJson('/api/thing', { method: 'POST', body: 'raw text', fetchImpl });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.body).toBe('raw text');
    expect(callArgs.headers).toBeUndefined();
  });

  test('URLSearchParams body passes through untouched, no content-type added', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    const params = new URLSearchParams({ a: '1' });
    await requestJson('/api/thing', { method: 'POST', body: params, fetchImpl });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.body).toBe(params);
    expect(callArgs.headers).toBeUndefined();
  });

  test('signal is forwarded to fetch', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    const controller = { signal: {} };
    await requestJson('/api/thing', { fetchImpl, signal: controller.signal });
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });

  test('2xx body null returned as-is', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk(null));
    await expect(requestJson('/api/thing', { fetchImpl })).resolves.toBeNull();
  });

  test('2xx body array returned as-is', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk([1, 2]));
    await expect(requestJson('/api/thing', { fetchImpl })).resolves.toEqual([1, 2]);
  });

  test('2xx body primitive number returned as-is', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk(7));
    await expect(requestJson('/api/thing', { fetchImpl })).resolves.toBe(7);
  });

  test('If-Match header survives (caller headers merged over defaults)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    await requestJson('/api/thing', {
      method: 'PATCH',
      body: { a: 1 },
      headers: { 'If-Match': 'etag-123' },
      fetchImpl,
    });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.headers).toEqual({ 'If-Match': 'etag-123', 'Content-Type': 'application/json' });
  });

  test('caller-supplied content-type header is not overwritten by the JSON default', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({}));
    await requestJson('/api/thing', {
      method: 'POST',
      body: { a: 1 },
      headers: { 'content-type': 'application/merge-patch+json' },
      fetchImpl,
    });
    const callArgs = fetchImpl.mock.calls[0][1];
    expect(callArgs.headers).toEqual({ 'content-type': 'application/merge-patch+json' });
  });

  test('fetchImpl injection is used instead of globalThis.fetch when provided', async () => {
    const globalFetch = jest.fn();
    globalThis.fetch = globalFetch;
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({ x: 1 }));
    await requestJson('/api/thing', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
  });

  test('globalThis.fetch is resolved at call time (late binding), not captured at import', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonOk({ first: true }));
    await expect(requestJson('/api/thing')).resolves.toEqual({ first: true });

    // Reassign AFTER the module has already been imported and used once.
    globalThis.fetch = jest.fn().mockResolvedValue(jsonOk({ second: true }));
    await expect(requestJson('/api/thing')).resolves.toEqual({ second: true });
  });
});

describe('requestEnvelope', () => {
  test('never throws on HTTP status; returns ok/status/data/error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonFail({ error: 'nope' }, 409));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.data).toEqual({ error: 'nope' });
    expect(result.error).toBeInstanceOf(ApiRequestError);
    expect(result.error.message).toBe('nope');
  });

  test('data is always the parsed body, never null, on a tolerant non-2xx', async () => {
    const parseErr = new SyntaxError('bad');
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(false, 500, parseErr));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.data).toEqual({});
    expect(result.error.parseError).toBe(parseErr);
  });

  test('success keys on HTTP status only: body-level {ok:false}/{success:false} is never interpreted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({ ok: false, success: false }, 200));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ ok: false, success: false });
  });

  test('2xx success returns error: null and the parsed data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk({ id: 7 }));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result).toEqual({ ok: true, status: 200, data: { id: 7 }, error: null });
  });

  test('2xx body null returned as-is as data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk(null));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.data).toBeNull();
  });

  test('2xx body array returned as-is as data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk([1, 2]));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.data).toEqual([1, 2]);
  });

  test('2xx body primitive number returned as-is as data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonOk(7));
    const result = await requestEnvelope('/api/thing', { fetchImpl });
    expect(result.data).toBe(7);
  });

  test('network rejection propagates unchanged (requestEnvelope does not catch it)', async () => {
    const networkErr = new TypeError('Failed to fetch');
    const fetchImpl = jest.fn().mockRejectedValue(networkErr);
    await expect(requestEnvelope('/api/thing', { fetchImpl })).rejects.toBe(networkErr);
  });

  test('abort signal is forwarded into the body read and rethrows', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchImpl = jest.fn().mockResolvedValue(rejectingJson(true, 200, abortErr));
    const controller = { signal: { aborted: true } };
    await expect(
      requestEnvelope('/api/thing', { fetchImpl, signal: controller.signal, tolerantBody: true })
    ).rejects.toBe(abortErr);
  });
});

describe('ApiRequestError', () => {
  test('carries name/status/payload/parseError', () => {
    const err = new ApiRequestError('boom', { status: 400, payload: { a: 1 }, parseError: null });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiRequestError');
    expect(err.status).toBe(400);
    expect(err.payload).toEqual({ a: 1 });
    expect(err.parseError).toBeNull();
    expect(err.message).toBe('boom');
  });
});

describe('module import side effects (invariant 8)', () => {
  test('importing the module performs no fetch call', () => {
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the module source defines no React dependency', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../shared/utils/api-request.js'),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"]react['"]/);
  });
});
