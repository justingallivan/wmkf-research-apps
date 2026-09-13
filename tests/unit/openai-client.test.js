/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/safe-fetch.js', () => ({ safeFetch: jest.fn() }));

import { safeFetch } from '../../lib/utils/safe-fetch.js';
import { OpenAIClient, normalizeOpenAIResponse } from '../../lib/services/openai-client.js';
import { lookupModelCapabilities } from '../../lib/services/model-capabilities.js';

const capabilities = lookupModelCapabilities('gpt-5.6-sol');

function response(body, status = 200, headers = {}) {
  return {
    ok: status < 400,
    status,
    headers: { get: (key) => headers[key.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => safeFetch.mockReset());

describe('OpenAIClient request shaping', () => {
  it('flattens the system array into the reviewed instruction role and uses max_completion_tokens', async () => {
    safeFetch.mockResolvedValueOnce(response({
      model: 'gpt-5.6-sol',
      choices: [{ message: { content: '{"ok":true}', refusal: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }));
    const client = new OpenAIClient({
      apiKey: 'sk-test-value',
      model: 'gpt-5.6-sol',
      capabilities: { ...capabilities, supportsTemperature: true },
    });
    await client.complete({
      system: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
      messages: [{ role: 'user', content: 'body' }],
      maxTokens: 321,
      temperature: 0.2,
    });

    const body = JSON.parse(safeFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'developer', content: 'first\n\nsecond' },
        { role: 'user', content: 'body' },
      ],
      max_completion_tokens: 321,
      temperature: 0.2,
    });
  });

  it('omits temperature for the conservative GPT-5.6 Sol capability row', () => {
    const client = new OpenAIClient({
      apiKey: 'sk-test-value',
      model: 'gpt-5.6-sol',
      capabilities,
    });
    expect(client._buildBody({ messages: [], temperature: 0.3 })).not.toHaveProperty('temperature');
  });

  it('uses either reviewed instructionRole value without hard-coding a provider default', () => {
    const client = new OpenAIClient({
      apiKey: 'sk-test-value',
      model: 'gpt-5.6-sol',
      capabilities: { ...capabilities, instructionRole: 'system' },
    });
    expect(client._buildBody({ system: 'instruction', messages: [] }).messages[0])
      .toEqual({ role: 'system', content: 'instruction' });
  });

  it('retries 429/5xx and marks terminal response errors', async () => {
    safeFetch
      .mockResolvedValueOnce(response({ error: 'busy' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response({ error: 'down' }, 503, { 'retry-after': '0' }));
    const client = new OpenAIClient({
      apiKey: 'sk-test-value',
      model: 'gpt-5.6-sol',
      capabilities,
      maxRetries: 1,
      initialRetryDelayMs: 1,
    });
    await expect(client.complete({ messages: [] })).rejects.toMatchObject({
      status: 503,
      providerResponseReceived: true,
    });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it('propagates the caller abort reason during retry backoff', async () => {
    safeFetch.mockResolvedValueOnce(response({ error: 'busy' }, 529, { 'retry-after': '60' }));
    const controller = new AbortController();
    const reason = Object.assign(new Error('operator stop'), { code: 'operator_stop' });
    const client = new OpenAIClient({
      apiKey: 'sk-test-value',
      model: 'gpt-5.6-sol',
      capabilities,
    });
    const pending = client.complete({ messages: [], signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeOpenAIResponse', () => {
  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
    ['future_reason', 'future_reason'],
  ])('maps finish_reason %s to %s and preserves the raw value', (finishReason, expected) => {
    const result = normalizeOpenAIResponse({
      model: 'gpt-5.6-sol',
      choices: [{ message: { content: 'answer', refusal: null }, finish_reason: finishReason }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }, 'gpt-5.6-sol');
    expect(result.stopReason).toBe(expected);
    expect(result.providerFinishReason).toBe(finishReason);
    expect(result.refused).toBe(finishReason === 'content_filter');
  });

  it('treats a non-empty message.refusal as refused even when finish_reason is stop', () => {
    const result = normalizeOpenAIResponse({
      choices: [{ message: { content: '', refusal: 'Cannot comply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 0 },
    }, 'gpt-5.6-sol');
    expect(result).toMatchObject({ refused: true, stopReason: 'refusal' });
  });

  it.each([
    [undefined],
    [{ prompt_tokens: 1 }],
    [{ prompt_tokens: -1, completion_tokens: 2 }],
    [{ prompt_tokens: 1, completion_tokens: Number.NaN }],
  ])('marks missing or malformed raw usage incomplete (%p)', (usage) => {
    const result = normalizeOpenAIResponse({
      choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
      usage,
    }, 'gpt-5.6-sol');
    expect(result.usageComplete).toBe(false);
  });

  it('marks complete usage and keeps OpenAI cache counters zero', () => {
    const result = normalizeOpenAIResponse({
      choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }, 'gpt-5.6-sol');
    expect(result.usageComplete).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
