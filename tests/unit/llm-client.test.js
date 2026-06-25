/**
 * LLMClient — covers the contract that callers depend on.
 *
 * Exercised:
 *   - normalized response shape (text, content, usage, stopReason)
 *   - retry on 429 + 529 (with retry-after honoured) and bail after maxRetries
 *   - single fallback-model swap on 529 when configured
 *   - real abort on timeout (the underlying fetch sees signal.aborted)
 *   - usage logged on success and failure
 *   - error message redacts the API key
 *   - streaming reassembles text + tool_use blocks from SSE
 */

import { jest } from '@jest/globals';

// jsdom doesn't ship the global Web text encoders that node has natively.
// The wrapper relies on TextDecoder for SSE parsing; install both at the
// top of this suite so the streaming tests work under the jsdom env.
const util = require('util');
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = util.TextDecoder;
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = util.TextEncoder;

jest.mock('../../lib/utils/safe-fetch.js', () => ({
  safeFetch: jest.fn(),
  isAllowedUrl: jest.fn(() => true),
}));
jest.mock('../../lib/utils/usage-logger.js', () => ({
  logUsage: jest.fn(),
}));

const { safeFetch } = require('../../lib/utils/safe-fetch.js');
const { logUsage } = require('../../lib/utils/usage-logger.js');
const { LLMClient, normalizeUnaryResponse, parseClaudeStream } = require('../../lib/services/llm-client.js');

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const h = new Map(Object.entries(headers));
  return {
    ok: status < 400,
    status,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? h.get(k) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function streamResponse(events, { status = 200 } = {}) {
  // jsdom doesn't ship TextEncoder; pull it from node util.
  const { TextEncoder } = require('util');
  const encoder = new TextEncoder();
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  let read = false;
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: encoder.encode(lines) };
        },
        releaseLock() {},
      }),
    },
  };
}

beforeEach(() => {
  safeFetch.mockReset();
  logUsage.mockClear();
});

describe('LLMClient.complete', () => {
  test('returns a normalized response', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: 'hello' }],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: 'end_turn',
    }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.text).toBe('hello');
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.stopReason).toBe('end_turn');
    expect(result.textStreamed).toBe(false);
  });

  describe('_buildBody temperature handling (S286)', () => {
    test('omits temperature for Opus 4.8 (alias and dated id), keeps it for others', () => {
      const opus = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8' });
      const opusDated = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8-20260601' });
      const sonnet = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });
      const haiku = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' });
      const opts = { messages: [{ role: 'user', content: 'hi' }], temperature: 0.3 };

      expect('temperature' in opus._buildBody(opts, false)).toBe(false);
      expect('temperature' in opusDated._buildBody(opts, false)).toBe(false);
      expect(sonnet._buildBody(opts, false).temperature).toBe(0.3);
      expect(haiku._buildBody(opts, false).temperature).toBe(0.3);
    });
  });

  test('retries on 429 then succeeds', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        model: 'm', usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm',
      initialRetryDelayMs: 1, maxRetries: 1,
    });
    const r = await client.complete({ messages: [] });
    expect(r.text).toBe('ok');
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  test('swaps to fallback model on 529 once', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'fallback' }],
        model: 'fallback', usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'primary', fallbackModel: 'fallback',
      initialRetryDelayMs: 1,
    });
    const r = await client.complete({ messages: [] });
    expect(r.text).toBe('fallback');
    const secondBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(secondBody.model).toBe('fallback');
  });

  test('non-retryable error throws with status', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, { status: 400 }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    await expect(client.complete({ messages: [] })).rejects.toThrow(/Claude API error 400/);
  });

  test('logs usage on success when appName is set', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: 'hi' }],
      model: 'm', usage: { input_tokens: 7, output_tokens: 3 },
    }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm', appName: 'unit-test', userProfileId: 42,
    });
    await client.complete({ messages: [] });
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      appName: 'unit-test',
      userProfileId: 42,
      inputTokens: 7,
      outputTokens: 3,
    }));
  });

  test('logs usage on failure with status:error', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, { status: 400 }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm', appName: 'unit-test' });
    await expect(client.complete({ messages: [] })).rejects.toThrow();
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      appName: 'unit-test',
      status: 'error',
    }));
  });

  test('redacts the API key from thrown error messages', async () => {
    // Simulate the underlying fetch throwing with the key embedded — the wrapper
    // shouldn't propagate the key in the user-visible error.
    safeFetch.mockRejectedValueOnce(new Error('fetch failed for key sk-ant-secret123abcdefghijklmnop'));
    const client = new LLMClient({ apiKey: 'sk-ant-secret123abcdefghijklmnop', model: 'm' });
    await expect(client.complete({ messages: [] })).rejects.toThrow(/sk-ant-\[redacted\]/);
  });

  test('aborts the underlying fetch when the timeout fires', async () => {
    let capturedSignal;
    safeFetch.mockImplementationOnce((url, opts) => {
      capturedSignal = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm', timeoutMs: 10 });
    await expect(client.complete({ messages: [] })).rejects.toThrow();
    expect(capturedSignal.aborted).toBe(true);
  });
});

describe('LLMClient external-abort (deadline) handling', () => {
  test('external abort cancels body consumption, not just the fetch', async () => {
    // The mock binds .json() to opts.signal (== the internal ac.signal), exactly
    // as a real fetch body is. If the external→ac bridge is torn down before
    // body read (the pre-fix bug), aborting the external signal would never reach
    // json() and this would hang. With the fix, it rejects.
    safeFetch.mockImplementationOnce((url, opts) => {
      const acSignal = opts.signal;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => new Promise((_resolve, reject) => {
          if (acSignal.aborted) return reject(new Error('body aborted'));
          acSignal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
        }),
      });
    });
    const controller = new AbortController();
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm', timeoutMs: 100000 });
    const p = client.complete({ messages: [], signal: controller.signal });
    await new Promise(r => setTimeout(r, 5)); // let execution reach json()
    controller.abort(new Error('reviewer_time_budget_exceeded'));
    await expect(p).rejects.toThrow(/aborted/);
  });

  test('aborts during retry backoff instead of waiting the full delay', async () => {
    // 429 with no retry-after → 30s computed backoff. An external abort during
    // the sleep must reject ~immediately, not after 30s.
    safeFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429 }));
    const controller = new AbortController();
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm', initialRetryDelayMs: 30000, maxRetries: 3,
    });
    const start = Date.now();
    const p = client.complete({ messages: [], signal: controller.signal });
    await new Promise(r => setTimeout(r, 5)); // let execution reach sleep()
    controller.abort(new Error('reviewer_time_budget_exceeded'));
    await expect(p).rejects.toThrow(/reviewer_time_budget_exceeded/);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  test('parseClaudeStream throws a clean error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('reviewer_time_budget_exceeded'));
    const resp = streamResponse([{ type: 'message_start', message: { model: 'm', usage: {} } }]);
    await expect(parseClaudeStream(resp, null, null, controller.signal))
      .rejects.toThrow(/reviewer_time_budget_exceeded/);
  });

  test('no-signal path is unchanged (regression guard)', async () => {
    // Mirrors the basic complete() happy path but explicitly asserts that
    // omitting a signal still works end-to-end (cleanup is a no-op).
    safeFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: 'ok' }],
      model: 'm', usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const r = await client.complete({ messages: [] });
    expect(r.text).toBe('ok');
  });
});

describe('LLMClient.stream', () => {
  test('reassembles text deltas and forwards them via onTextDelta', async () => {
    safeFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const deltas = [];
    const r = await client.stream({ messages: [], onTextDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(['hel', 'lo']);
    expect(r.text).toBe('hello');
    expect(r.stopReason).toBe('end_turn');
    expect(r.textStreamed).toBe(true);
  });

  test('reassembles tool_use blocks with parsed JSON inputs and does NOT forward text deltas', async () => {
    safeFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 4 } } },
      // tool_use appears first, so text deltas after it should still get accumulated but never streamed
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'q' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '1}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'should not stream' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', usage: { output_tokens: 2 } },
    ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const deltas = [];
    const r = await client.stream({ messages: [], onTextDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual([]); // tool_use suppressed text streaming
    expect(r.textStreamed).toBe(false);
    expect(r.content).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'q', input: { a: 1 } },
      { type: 'text', text: 'should not stream' },
    ]);
  });
});

describe('normalizeUnaryResponse', () => {
  test('handles missing fields gracefully', () => {
    const r = normalizeUnaryResponse({}, 'requested-model');
    expect(r.text).toBe('');
    expect(r.content).toEqual([]);
    expect(r.model).toBe('requested-model');
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
  });
});
