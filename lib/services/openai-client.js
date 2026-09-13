/**
 * OpenAI Chat Completions transport for the shared Executor provider seam.
 *
 * This client deliberately mirrors the normalized LLMClient response contract
 * without writing api_usage_log. The Executor owns its wmkf_ai_run audit row.
 */

import { safeFetch } from '../utils/safe-fetch.js';
import { DEFAULT_TIMEOUT_MS } from './llm-client.js';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 2_000;

export class OpenAIClient {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model,
    capabilities,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    initialRetryDelayMs = DEFAULT_INITIAL_RETRY_DELAY_MS,
  } = {}) {
    if (!apiKey) throw new Error('OpenAIClient: apiKey or OPENAI_API_KEY required');
    if (!model) throw new Error('OpenAIClient: model required');
    if (!capabilities || capabilities.provider !== 'openai') {
      throw new Error(`OpenAIClient: reviewed OpenAI capabilities required for "${model}"`);
    }
    this.apiKey = apiKey;
    this.model = model;
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.initialRetryDelayMs = initialRetryDelayMs;
  }

  async complete(opts = {}) {
    const body = this._buildBody(opts);
    let attempt = 0;

    while (true) {
      const { response, clear, detach } = await this._fetchOnce(body, opts.signal);
      try {
        if (response.ok) {
          let data;
          try {
            data = await response.json();
          } catch (error) {
            if (opts.signal?.aborted) throw abortReason(opts.signal);
            const parseError = new Error(`OpenAI API: failed to parse response JSON: ${error.message}`);
            parseError.providerResponseReceived = true;
            throw redactError(parseError);
          }
          return { ...normalizeOpenAIResponse(data, this.model), textStreamed: false };
        }

        const errorText = await safeReadText(response);
        if (!isRetryableStatus(response.status) || attempt >= this.maxRetries) {
          const error = new Error(
            `OpenAI API error ${response.status}${attempt > 0 ? ` after ${attempt + 1} attempts` : ''}: ${errorText.slice(0, 500)}`,
          );
          error.status = response.status;
          error.providerResponseReceived = true;
          throw redactError(error);
        }

        const delay = retryDelay(response, attempt, this.initialRetryDelayMs);
        attempt += 1;
        await sleep(delay, opts.signal);
      } finally {
        clear();
        detach();
      }
    }
  }

  _buildBody({ system, messages = [], maxTokens, temperature } = {}) {
    const instruction = flattenSystem(system);
    const body = {
      model: this.model,
      messages: [
        ...(instruction ? [{ role: this.capabilities.instructionRole, content: instruction }] : []),
        ...messages,
      ],
    };
    if (maxTokens != null) body.max_completion_tokens = maxTokens;
    if (this.capabilities.supportsTemperature === true && temperature != null) {
      body.temperature = temperature;
    }
    return body;
  }

  async _fetchOnce(body, externalSignal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`OpenAI API timeout after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    );
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const clear = () => clearTimeout(timeoutId);
    const detach = () => externalSignal?.removeEventListener('abort', onExternalAbort);

    try {
      const response = await safeFetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return { response, clear, detach };
    } catch (error) {
      clear();
      detach();
      if (externalSignal?.aborted) throw abortReason(externalSignal);
      throw redactError(error);
    }
  }
}

export function normalizeOpenAIResponse(data, usedModel) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const message = choice?.message || {};
  const text = normalizeMessageContent(message.content);
  const refusal = typeof message.refusal === 'string' ? message.refusal.trim() : '';
  const providerFinishReason = choice?.finish_reason ?? null;
  const stopReason = refusal
    ? 'refusal'
    : mapFinishReason(providerFinishReason);
  const usageComplete = hasCompleteRawUsage(
    data?.usage?.prompt_tokens,
    data?.usage?.completion_tokens,
  );

  return {
    text,
    content: text ? [{ type: 'text', text }] : [],
    model: data?.model || usedModel,
    usage: {
      inputTokens: validToken(data?.usage?.prompt_tokens),
      outputTokens: validToken(data?.usage?.completion_tokens),
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
    stopReason,
    stopDetails: null,
    refused: Boolean(refusal) || providerFinishReason === 'content_filter',
    usageComplete,
    provider: 'openai',
    providerFinishReason,
  };
}

function flattenSystem(system) {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .map((block) => (typeof block === 'string' ? block : block?.text))
    .filter((text) => typeof text === 'string' && text.length > 0)
    .join('\n\n');
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' || part?.type === 'output_text')
    .map((part) => part.text || '')
    .join('');
}

function mapFinishReason(reason) {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return reason;
}

function hasCompleteRawUsage(inputTokens, outputTokens) {
  return Number.isFinite(inputTokens)
    && inputTokens >= 0
    && Number.isFinite(outputTokens)
    && outputTokens >= 0;
}

function validToken(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function retryDelay(response, attempt, initial) {
  const retryAfter = parseInt(response.headers?.get?.('retry-after') ?? '', 10);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1_000, 60_000);
  return initial * (2 ** attempt);
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function safeReadText(response) {
  try { return await response.text(); } catch { return ''; }
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let onAbort;
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('OpenAI request aborted');
}

function redactError(error) {
  const err = error instanceof Error ? error : new Error(String(error));
  err.message = String(err.message)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
  return err;
}
