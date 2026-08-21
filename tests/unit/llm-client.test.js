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
jest.mock('../../lib/services/notification-service.js', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 1 })) },
}));

const { safeFetch } = require('../../lib/utils/safe-fetch.js');
const { logUsage } = require('../../lib/utils/usage-logger.js');
const NotificationService = require('../../lib/services/notification-service.js').default;
const {
  LLMClient,
  modelSupportsTemperature,
  normalizeUnaryResponse,
  parseClaudeStream,
} = require('../../lib/services/llm-client.js');
const {
  lookupModelCapabilities,
  requestCapabilitiesForModel,
} = require('../../lib/services/model-capabilities.js');
const { getModelForApp } = require('../../shared/config/baseConfig.js');
const { clearAvailableModelsCache } = require('../../lib/services/model-resolver.js');

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
  NotificationService.notify.mockClear().mockResolvedValue({ id: 1 });
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
    test('omits temperature for temperature-less reviewed models, keeps it for supported models', () => {
      const opus = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8' });
      const opusDated = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8-20260601' });
      const fable = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-fable-5' });
      const sonnet = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });
      const haiku = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' });
      const unknown = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-future-99' });
      const opts = { messages: [{ role: 'user', content: 'hi' }], temperature: 0.3 };

      expect('temperature' in opus._buildBody(opts, false)).toBe(false);
      expect('temperature' in opusDated._buildBody(opts, false)).toBe(false);
      expect('temperature' in fable._buildBody(opts, false)).toBe(false);
      expect(sonnet._buildBody(opts, false).temperature).toBe(0.3);
      expect(haiku._buildBody(opts, false).temperature).toBe(0.3);
      expect('temperature' in unknown._buildBody(opts, false)).toBe(false);
    });

    test('includes effort only for models reviewed as effort-capable', () => {
      const fable = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-fable-5' });
      const haiku = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' });
      const opts = { messages: [{ role: 'user', content: 'hi' }], effort: 'medium' };

      expect(fable._buildBody(opts, false).output_config).toEqual({ effort: 'medium' });
      expect(haiku._buildBody(opts, false)).not.toHaveProperty('effort');
      expect(haiku._buildBody(opts, false)).not.toHaveProperty('output_config');
    });

    test('preserves output_config while stripping unsupported effort', () => {
      const fable = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-fable-5' });
      const haiku = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-haiku-4-5' });
      const opts = {
        messages: [{ role: 'user', content: 'hi' }],
        outputConfig: { effort: 'medium', verbosity: 'concise' },
      };

      expect(fable._buildBody(opts, false).output_config).toEqual({
        effort: 'medium',
        verbosity: 'concise',
      });
      expect(haiku._buildBody(opts, false).output_config).toEqual({ verbosity: 'concise' });
    });
  });

  describe('model capabilities registry', () => {
    test('exact and dated-prefix lookups share reviewed capabilities', () => {
      expect(lookupModelCapabilities('claude-opus-4-8-20260601'))
        .toBe(lookupModelCapabilities('claude-opus-4-8'));
      expect(modelSupportsTemperature('claude-opus-4-8')).toBe(false);
      expect(modelSupportsTemperature('claude-sonnet-4-6')).toBe(true);
    });

    test('unknown runtime model ids fail closed for optional params', () => {
      const caps = requestCapabilitiesForModel('claude-future-99');
      expect(caps.unknown).toBe(true);
      expect(caps.supportsTemperature).toBe(false);
      expect(caps.requiresRefusalHandling).toBe(true);
    });

    test('tier aliases resolve before request shaping', () => {
      const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'sonnet' });
      const body = client._buildBody({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.2 }, false);

      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.temperature).toBe(0.2);
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

  test('strips model-bound thinking blocks only from a cross-model 529 fallback', async () => {
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
    const messages = [
      { role: 'user', content: 'Find the request' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig-primary' },
          { type: 'tool_use', id: 'tool-1', name: 'get_entity', input: { id: 'request-1' } },
          { type: 'redacted_thinking', data: 'encrypted-primary' },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '{"found":true}' }],
      },
    ];
    const originalMessages = JSON.parse(JSON.stringify(messages));

    await client.complete({ messages });

    const primaryBody = JSON.parse(safeFetch.mock.calls[0][1].body);
    const fallbackBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(primaryBody.messages).toEqual(originalMessages);
    expect(messages).toEqual(originalMessages);
    expect(fallbackBody.messages).toEqual([
      originalMessages[0],
      {
        role: 'assistant',
        content: [originalMessages[1].content[1]],
      },
      originalMessages[2],
    ]);
    expect(fallbackBody.messages[1].content[0]).toEqual(expect.objectContaining({
      type: 'tool_use',
      id: 'tool-1',
    }));
    expect(fallbackBody.messages[2].content[0]).toEqual(expect.objectContaining({
      type: 'tool_result',
      tool_use_id: 'tool-1',
    }));
  });

  test('preserves thinking blocks when primary and fallback aliases resolve to the same model', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'retry' }],
        model: 'claude-sonnet-4-6', usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test',
      model: 'sonnet',
      fallbackModel: 'sonnet',
      initialRetryDelayMs: 1,
      maxRetries: 1,
    });
    const messages = [{
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '', signature: 'same-model-signature' }],
    }];

    await client.complete({ messages });

    expect(JSON.parse(safeFetch.mock.calls[1][1].body).messages).toEqual(messages);
  });

  test('rebuilds Opus primary to Sonnet fallback body with temperature and existing fields on 529', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'fallback' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      fallbackModel: 'claude-sonnet-4-6',
      initialRetryDelayMs: 1,
    });
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'primary-signature' },
          { type: 'tool_use', id: 'fallback-tool-1', name: 'lookup', input: {} },
          { type: 'redacted_thinking', data: 'primary-redacted' },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'fallback-tool-1', content: 'result' }],
      },
    ];
    const fallbackMessages = [
      messages[0],
      { role: 'assistant', content: [messages[1].content[1]] },
      messages[2],
    ];
    const system = 'system prompt';
    const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: {} } }];

    await client.complete({ messages, system, tools, maxTokens: 1234, temperature: 0.42 });

    const firstBody = JSON.parse(safeFetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(firstBody.model).toBe('claude-opus-4-8');
    expect(firstBody).not.toHaveProperty('temperature');
    expect(retryBody).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      messages: fallbackMessages,
      system,
      tools,
      max_tokens: 1234,
      temperature: 0.42,
    }));
    expect(retryBody).not.toHaveProperty('stream');
  });

  test('rebuilds Sonnet primary to Opus fallback body without temperature on 529', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'fallback' }],
        model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      fallbackModel: 'claude-opus-4-8',
      initialRetryDelayMs: 1,
    });
    const messages = [{ role: 'user', content: 'hi' }];
    const system = 'system prompt';
    const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: {} } }];

    await client.complete({ messages, system, tools, maxTokens: 1234, temperature: 0.42 });

    const firstBody = JSON.parse(safeFetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(firstBody.temperature).toBe(0.42);
    expect(retryBody).toEqual(expect.objectContaining({
      model: 'claude-opus-4-8',
      messages,
      system,
      tools,
      max_tokens: 1234,
    }));
    expect(retryBody).not.toHaveProperty('temperature');
    expect(retryBody).not.toHaveProperty('stream');
  });

  test('non-retryable error throws with status', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, { status: 400 }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    await expect(client.complete({ messages: [] })).rejects.toThrow(/Claude API error 400/);
  });

  test('strips a deprecated temperature parameter once and retries', async () => {
    const messages = [{ role: 'user', content: 'hi' }];
    safeFetch
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: 'temperature is deprecated for this model' } },
        { status: 400 },
      ))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));

    const client = new LLMClient({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-6',
      initialRetryDelayMs: 1,
    });
    const result = await client.complete({
      messages,
      system: 'system prompt',
      tools: [{ name: 'lookup', input_schema: { type: 'object', properties: {} } }],
      maxTokens: 123,
      temperature: 0.7,
    });

    const firstBody = JSON.parse(safeFetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(result.text).toBe('ok');
    expect(firstBody.temperature).toBe(0.7);
    expect(retryBody).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      messages,
      system: 'system prompt',
      max_tokens: 123,
    }));
    expect(retryBody).not.toHaveProperty('temperature');
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'claude_deprecated_param_retry',
      severity: 'warning',
      source: 'llm-client',
      category: 'ops',
    }));
  });

  test('does not retry generic 400s even when they mention temperature', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse(
      { error: { message: 'temperature must be between 0 and 1' } },
      { status: 400 },
    ));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });

    await expect(client.complete({ messages: [], temperature: 2 })).rejects.toThrow(/Claude API error 400/);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(NotificationService.notify).not.toHaveBeenCalled();
  });

  test('does not loop if the deprecated-parameter retry still fails', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: 'temperature is deprecated for this model' } },
        { status: 400 },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: 'temperature is deprecated for this model' } },
        { status: 400 },
      ));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });

    await expect(client.complete({ messages: [], temperature: 0.4 })).rejects.toThrow(/Claude API error 400/);
    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(safeFetch.mock.calls[1][1].body)).not.toHaveProperty('temperature');
    expect(NotificationService.notify).toHaveBeenCalledTimes(1);
  });

  test('deprecated-parameter alert failure does not block the retry', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    NotificationService.notify.mockRejectedValueOnce(new Error('alert backend down'));
    safeFetch
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: 'temperature is deprecated for this model' } },
        { status: 400 },
      ))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });

    try {
      const result = await client.complete({ messages: [], temperature: 0.4 });
      expect(result.text).toBe('ok');
      expect(safeFetch).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        '[LLMClient] deprecated-param retry alert failed:',
        'alert backend down',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('normalizes successful classifier refusals as explicit refusal metadata', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: '' }],
      model: 'claude-fable-5',
      usage: { input_tokens: 10, output_tokens: 0 },
      stop_reason: 'refusal',
      stop_details: { classifier: 'safety' },
    }));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-fable-5' });
    const r = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.stopReason).toBe('refusal');
    expect(r.stopDetails).toEqual({ classifier: 'safety' });
    expect(r.refused).toBe(true);
  });

  test('logs usage on success when appName is set', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({
      content: [{ type: 'text', text: 'hi' }],
      model: 'm', usage: { input_tokens: 7, output_tokens: 3 }, stop_reason: 'end_turn',
    }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm', appName: 'unit-test', userProfileId: 42,
      requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26', requestRound: 2,
    });
    await client.complete({ messages: [] });
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      appName: 'unit-test',
      userProfileId: 42,
      inputTokens: 7,
      outputTokens: 3,
      stopReason: 'end_turn',
      requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
      requestRound: 2,
    }));
  });

  test('logs usage on failure with status:error', async () => {
    safeFetch.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, { status: 400 }));
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm', appName: 'unit-test',
      requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26', requestRound: 4,
    });
    await expect(client.complete({ messages: [] })).rejects.toThrow();
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      appName: 'unit-test',
      status: 'error',
      requestId: '2e0b0cbe-0dd6-4f1c-a19c-8a7c6e9fbb26',
      requestRound: 4,
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
    const client = new LLMClient({
      apiKey: 'sk-ant-test', model: 'm', appName: 'dynamics-explorer', userProfileId: 42,
    });
    const deltas = [];
    const r = await client.stream({ messages: [], onTextDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(['hel', 'lo']);
    expect(r.text).toBe('hello');
    expect(r.stopReason).toBe('end_turn');
    expect(r.textStreamed).toBe(true);
    expect(logUsage).toHaveBeenCalledWith(expect.objectContaining({
      appName: 'dynamics-explorer',
      userProfileId: 42,
      stopReason: 'end_turn',
    }));
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

  // Thinking blocks arrive empty from content_block_start and are filled by
  // thinking_delta / signature_delta. Dropping those deltas left the block
  // empty, and a caller that echoes the assistant turn back (the Dynamics
  // Explorer agent loop) got a 400 from the API — "each thinking block must
  // contain thinking" — which broke every multi-round query. Owner-reported
  // 2026-08-07; confirmed in production logs.
  test('accumulates thinking and signature deltas so the block can be echoed back', async () => {
    safeFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'check' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'q' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', usage: { output_tokens: 2 } },
    ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const r = await client.stream({ messages: [] });

    const thinking = r.content.find(b => b.type === 'thinking');
    // Both fields must survive so the block can be echoed back unmodified.
    expect(thinking.thinking).toBe('let me check');
    expect(thinking.signature).toBe('sig123');
    // Never the string "undefined" from appending to a missing field.
    expect(thinking.thinking).not.toMatch(/undefined/);
    // Thinking must not be mistaken for assistant text.
    expect(r.text).toBe('');
  });

  // The shape current models actually send: `display: "omitted"` is the default,
  // so the block carries NO thinking text and only a signature. Restoring the
  // text alone would not have fixed this case — the signature is the field that
  // makes the echoed block verifiable. (Gap identified in Codex review,
  // 2026-08-07: the original test only covered the summarized-display shape.)
  test('preserves the signature when display is omitted and no thinking_delta arrives', async () => {
    safeFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'EqQBCgIYAhoM' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'q' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', usage: { output_tokens: 2 } },
    ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const r = await client.stream({ messages: [] });

    const thinking = r.content.find(b => b.type === 'thinking');
    expect(thinking.signature).toBe('EqQBCgIYAhoM');
    // Empty thinking text is legitimate under omitted display — it must be
    // passed through as-is, not synthesized into something non-empty.
    expect(thinking.thinking).toBe('');
    // The tool call alongside it still reassembles normally.
    expect(r.content.find(b => b.type === 'tool_use').input).toEqual({});
  });

  test('accumulates thinking deltas when the start event omits the fields', async () => {
    safeFetch.mockResolvedValueOnce(streamResponse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 4 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'abc' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', usage: { output_tokens: 1 } },
    ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'm' });
    const r = await client.stream({ messages: [] });

    expect(r.content.find(b => b.type === 'thinking').thinking).toBe('abc');
  });

  test('rebuilds fallback body with stream flag and fallback temperature on 529', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(streamResponse([
        { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 4 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      ]));
    const client = new LLMClient({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      fallbackModel: 'claude-sonnet-4-6',
      initialRetryDelayMs: 1,
    });
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'stream-primary-signature' },
          { type: 'tool_use', id: 'stream-tool-1', name: 'lookup', input: {} },
          { type: 'redacted_thinking', data: 'stream-primary-redacted' },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'stream-tool-1', content: 'result' }],
      },
    ];
    const fallbackMessages = [
      messages[0],
      { role: 'assistant', content: [messages[1].content[1]] },
      messages[2],
    ];
    const system = 'system prompt';
    const tools = [{ name: 'lookup', input_schema: { type: 'object', properties: {} } }];

    const result = await client.stream({ messages, system, tools, maxTokens: 1234 });

    const retryBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(result.text).toBe('ok');
    expect(retryBody).toEqual(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      messages: fallbackMessages,
      system,
      tools,
      max_tokens: 1234,
      temperature: 0.3,
      stream: true,
    }));
  });

  test('deprecated temperature retry preserves the stream flag', async () => {
    safeFetch
      .mockResolvedValueOnce(jsonResponse(
        { error: { message: 'temperature is deprecated for this model' } },
        { status: 400 },
      ))
      .mockResolvedValueOnce(streamResponse([
        { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 4 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      ]));
    const client = new LLMClient({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });

    const result = await client.stream({ messages: [], temperature: 0.4 });

    const retryBody = JSON.parse(safeFetch.mock.calls[1][1].body);
    expect(result.text).toBe('ok');
    expect(retryBody.stream).toBe(true);
    expect(retryBody).not.toHaveProperty('temperature');
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

describe('reviewer-finder Opus 4.8 pinning', () => {
  const originalEnv = process.env.CLAUDE_MODEL_REVIEWER_FINDER;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_MODEL_REVIEWER_FINDER;
    } else {
      process.env.CLAUDE_MODEL_REVIEWER_FINDER = originalEnv;
    }
    clearAvailableModelsCache();
  });

  test('getModelForApp resolves reviewer-finder to Opus 4.8 without live model list', () => {
    delete process.env.CLAUDE_MODEL_REVIEWER_FINDER;
    clearAvailableModelsCache();

    expect(getModelForApp('reviewer-finder')).toBe('claude-opus-4-8');
    expect(modelSupportsTemperature(getModelForApp('reviewer-finder'))).toBe(false);
  });
});
