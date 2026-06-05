/**
 * LLMClient — canonical Anthropic API wrapper for app-side Claude calls.
 *
 * Replaces:
 *   - shared/api/handlers/claudeClient.js (raw fetch, no abort, no SSRF guard)
 *   - the ~14 ad-hoc `fetch(BASE_CONFIG.CLAUDE.API_URL, ...)` sites scattered
 *     across pages/api and lib/services
 *   - the multi-llm-service Claude path (left in place but should converge)
 *
 * What this gives you over a hand-rolled fetch:
 *   - safeFetch SSRF allowlist (api.anthropic.com only)
 *   - real AbortController-bound timeout — cancels the underlying socket,
 *     not just the Promise (multi-llm-service's Promise.race left fetches
 *     running)
 *   - retry on 429 (with retry-after) + 529, with exponential backoff and
 *     a single fallback-model swap on 529 if configured
 *   - structured `logUsage` on success and failure (cache tokens included)
 *   - error redaction — the API key never appears in thrown error messages
 *   - normalized response shape across unary and streaming, including
 *     reassembled tool_use blocks with parsed JSON inputs
 *
 * Two methods:
 *   complete({ system, messages, tools, ... }) → LLMResponse
 *   stream({ system, messages, tools, onTextDelta, ... }) → LLMResponse
 *
 * Streaming preserves the dynamics-explorer/chat semantic: text deltas are
 * forwarded to onTextDelta only when no tool_use block is detected in the
 * stream (so callers can avoid double-rendering when the model is calling
 * tools mid-response).
 */

import { safeFetch } from '../utils/safe-fetch.js';
import { logUsage } from '../utils/usage-logger.js';
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
// Look up at call-time so partial test mocks of BASE_CONFIG don't crash module load.
function anthropicVersion() {
  return BASE_CONFIG?.CLAUDE?.ANTHROPIC_VERSION || '2023-06-01';
}
const RETRYABLE_STATUSES = new Set([429, 529]);
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 2_000;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_TEMPERATURE = 0.3;

/**
 * @typedef {Object} LLMUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheCreationTokens
 * @property {number} cacheReadTokens
 *
 * @typedef {Object} LLMResponse
 * @property {string} text  - Joined text from all text content blocks
 * @property {Array<Object>} content - Raw normalized content blocks (text + tool_use w/ parsed inputs)
 * @property {string} model - Actual model the API used (may differ from request on fallback)
 * @property {LLMUsage} usage
 * @property {string|null} stopReason
 * @property {boolean} textStreamed - true iff onTextDelta was invoked at least once
 */

export class LLMClient {
  constructor({
    apiKey = process.env.CLAUDE_API_KEY,
    model,
    fallbackModel = null,
    appName = null,
    userProfileId = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    initialRetryDelayMs = DEFAULT_INITIAL_RETRY_DELAY_MS,
  } = {}) {
    if (!apiKey) {
      throw new Error('LLMClient: apiKey or CLAUDE_API_KEY required');
    }
    if (!model) {
      throw new Error('LLMClient: model required');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.fallbackModel = fallbackModel;
    this.appName = appName;
    this.userProfileId = userProfileId;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.initialRetryDelayMs = initialRetryDelayMs;
  }

  /**
   * Unary completion. Awaits the full JSON response.
   * @param {Object} opts
   * @param {string|Array} [opts.system]
   * @param {Array} opts.messages
   * @param {number} [opts.maxTokens]
   * @param {number} [opts.temperature]
   * @param {Array} [opts.tools]
   * @param {AbortSignal} [opts.signal] - external cancellation
   * @returns {Promise<LLMResponse>}
   */
  async complete(opts = {}) {
    const startTime = Date.now();
    const body = this._buildBody(opts, /* stream */ false);
    let usedModel = body.model;
    // `clearTimer` stops the per-attempt timeout; `detach` removes the
    // external-abort→fetch bridge. BOTH stay live through `response.json()`:
    // the per-attempt timeout bounds a unary body that stalls after headers
    // (hung-socket guard — unary bodies are small, so they should read fast),
    // and the external bridge lets a deadline cancel the body read. Torn down
    // in `finally`.
    let clearTimer = () => {};
    let detach = () => {};
    try {
      const result = await this._fetchWithRetries(body, opts.signal);
      usedModel = result.usedModel;
      clearTimer = result.clearTimer;
      detach = result.detach;
      let data;
      try {
        data = await result.response.json();
      } catch (err) {
        throw redactError(new Error(`Claude API: failed to parse response JSON: ${err.message}`));
      }
      clearTimer(); // body read complete — stop the per-attempt timer
      const normalized = normalizeUnaryResponse(data, usedModel);
      this._logSuccess({ normalized, startTime });
      return { ...normalized, textStreamed: false };
    } catch (err) {
      this._logFailure({ usedModel, startTime, error: err });
      throw err;
    } finally {
      clearTimer();
      detach();
    }
  }

  /**
   * Streaming completion. Reassembles the SSE stream into a normalized
   * response. `onTextDelta(text)` is invoked for each text delta when no
   * tool_use block has been detected; once a tool_use begins, deltas are
   * still accumulated into the response but no longer forwarded.
   *
   * @param {Object} opts
   * @param {string|Array} [opts.system]
   * @param {Array} opts.messages
   * @param {number} [opts.maxTokens]
   * @param {number} [opts.temperature]
   * @param {Array} [opts.tools]
   * @param {Function} [opts.onTextDelta]
   * @param {Function} [opts.onEvent] - raw SSE event hook for advanced cases (web_search citations, etc.)
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<LLMResponse>}
   */
  async stream(opts = {}) {
    const startTime = Date.now();
    const body = this._buildBody(opts, /* stream */ true);
    let usedModel = body.model;
    // Unlike `complete()`, a streaming body read = generation time, which can
    // legitimately exceed the per-attempt cap — so clear the per-attempt timer
    // BEFORE the read loop (it must not kill a long-but-healthy stream). The
    // external-abort bridge stays attached so a deadline still cancels the loop.
    let clearTimer = () => {};
    let detach = () => {};
    try {
      const result = await this._fetchWithRetries(body, opts.signal);
      usedModel = result.usedModel;
      clearTimer = result.clearTimer;
      detach = result.detach;
      clearTimer();
      const parsed = await parseClaudeStream(result.response, opts.onTextDelta, opts.onEvent, opts.signal);
      const normalized = normalizeStreamResponse(parsed, usedModel);
      this._logSuccess({ normalized, startTime });
      return normalized;
    } catch (err) {
      this._logFailure({ usedModel, startTime, error: err });
      throw redactError(err);
    } finally {
      clearTimer();
      detach();
    }
  }

  // ─────────────────────────── internals ───────────────────────────

  _buildBody(opts, stream) {
    const body = {
      model: this.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      messages: opts.messages,
    };
    if (opts.system != null) body.system = opts.system;
    if (opts.tools) body.tools = opts.tools;
    if (stream) body.stream = true;
    return body;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey.trim(),
      'anthropic-version': anthropicVersion(),
    };
  }

  /**
   * POST with retry on 429/529 and a single fallback-model swap on 529.
   * Returns { response, usedModel, clearTimer, detach } — `response` is unread
   * (caller consumes either as JSON or as a stream). The caller MUST call both
   * `clearTimer` (stop the per-attempt timeout) and `detach` (remove the
   * external-abort bridge) once the body is fully consumed. complete() keeps
   * the timer live through json() (bounds a hung unary body); stream() clears
   * it before the read loop (a long generation must not be killed). The
   * external bridge always stays live through body consumption so a deadline
   * can cancel it. Intermediate (drained) responses are cleaned up here.
   */
  async _fetchWithRetries(body, externalSignal) {
    let attempt = 0;
    let usedFallback = false;
    let usedModel = body.model;

    while (true) {
      const { response, clearTimer, detach } = await this._fetchOnce(body, externalSignal);

      if (response.ok) {
        return { response, usedModel, clearTimer, detach };
      }

      // From here the response body is drained in this loop, never handed to
      // the caller — stop this attempt's timer and detach its bridge as soon as
      // we're done reading it.
      clearTimer();

      // Non-retryable: bail.
      if (!RETRYABLE_STATUSES.has(response.status)) {
        const errText = await safeReadText(response);
        detach();
        const err = new Error(`Claude API error ${response.status}: ${errText.slice(0, 500)}`);
        err.status = response.status;
        throw redactError(err);
      }

      // 529 + fallback configured + we haven't used it yet → swap once and
      // retry immediately, no backoff (different model, may be hot).
      if (response.status === 529 && this.fallbackModel && !usedFallback && this.fallbackModel !== body.model) {
        await safeReadText(response);
        detach();
        body.model = this.fallbackModel;
        usedModel = this.fallbackModel;
        usedFallback = true;
        continue;
      }

      if (attempt >= this.maxRetries) {
        const errText = await safeReadText(response);
        detach();
        const err = new Error(`Claude API error ${response.status} after ${attempt + 1} attempts: ${errText.slice(0, 500)}`);
        err.status = response.status;
        throw redactError(err);
      }

      const delay = computeRetryDelay({
        attempt,
        initial: this.initialRetryDelayMs,
        retryAfter: response.headers.get('retry-after'),
      });
      await safeReadText(response);
      detach();
      // Abort-aware: a fired external signal (e.g. deadline) rejects here
      // immediately instead of burning the full backoff delay first.
      await sleep(delay, externalSignal);
      attempt++;
    }
  }

  /**
   * Single POST attempt. Returns { response, clearTimer, detach } WITHOUT
   * tearing down on the success path — the caller decides when to stop the
   * per-attempt timeout (`this.timeoutMs`) and detach the external-abort bridge
   * relative to body consumption (see `complete`/`stream`). On a thrown fetch,
   * both are torn down here.
   */
  async _fetchOnce(body, externalSignal) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(new Error(`Claude API timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
    const onExternalAbort = () => ac.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) ac.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const clearTimer = () => clearTimeout(timeoutId);
    const detach = () => {
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    };

    let response;
    try {
      response = await safeFetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimer();
      detach();
      throw redactError(err);
    }

    // Headers in hand. Do NOT tear down here — `ac` (per-attempt timeout) and
    // the external bridge stay live; the caller stops them relative to body
    // consumption via the returned controls.
    return { response, clearTimer, detach };
  }

  _logSuccess({ normalized, startTime }) {
    if (!this.appName) return;
    logUsage({
      userProfileId: this.userProfileId,
      appName: this.appName,
      model: normalized.model || this.model,
      inputTokens: normalized.usage.inputTokens,
      outputTokens: normalized.usage.outputTokens,
      cacheCreationTokens: normalized.usage.cacheCreationTokens,
      cacheReadTokens: normalized.usage.cacheReadTokens,
      latencyMs: Date.now() - startTime,
    });
  }

  _logFailure({ usedModel, startTime, error }) {
    if (!this.appName) return;
    logUsage({
      userProfileId: this.userProfileId,
      appName: this.appName,
      model: usedModel || this.model,
      latencyMs: Date.now() - startTime,
      status: 'error',
      errorMessage: redactString(error?.message || String(error)).slice(0, 500),
    });
  }
}

export function createLLMClient(opts) {
  return new LLMClient(opts);
}

// ─────────────────────────── helpers ───────────────────────────

/**
 * Normalize a non-streaming Anthropic /v1/messages response.
 */
export function normalizeUnaryResponse(data, usedModel) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
  return {
    text,
    content,
    model: data?.model || usedModel,
    usage: {
      inputTokens: data?.usage?.input_tokens || 0,
      outputTokens: data?.usage?.output_tokens || 0,
      cacheCreationTokens: data?.usage?.cache_creation_input_tokens || 0,
      cacheReadTokens: data?.usage?.cache_read_input_tokens || 0,
    },
    stopReason: data?.stop_reason ?? null,
  };
}

/**
 * Convert SSE-parser output into the same normalized shape as unary.
 */
function normalizeStreamResponse({ contentBlocks, model, usage, stopReason, textStreamed }, usedModel) {
  const text = contentBlocks.filter(b => b.type === 'text').map(b => b.text).join('');
  return {
    text,
    content: contentBlocks,
    model: model || usedModel,
    usage: {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
    },
    stopReason,
    textStreamed,
  };
}

/**
 * Parse Anthropic SSE stream into content blocks. Forwards text deltas via
 * onTextDelta only when no tool_use block has appeared (matches the existing
 * dynamics-explorer/chat semantic). All raw events are also forwarded to
 * onEvent if provided, for callers that need to extract things like
 * web_search citations or server_tool_use start signals.
 */
export async function parseClaudeStream(response, onTextDelta, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const contentBlocks = [];
  let hasToolUse = false;
  let model = '';
  let usage = {};
  let stopReason = null;
  let textStreamed = false;

  try {
    while (true) {
      // Surface a clean error if an external abort (e.g. deadline) fired between
      // reads. An abort mid-`read()` also rejects below; this catches the gap.
      if (signal?.aborted) {
        throw abortReason(signal);
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        let event;
        try { event = JSON.parse(data); } catch { continue; }
        if (onEvent) {
          try { onEvent(event); } catch (err) {
            console.warn('[LLMClient] onEvent threw:', err.message);
          }
        }

        switch (event.type) {
          case 'message_start':
            model = event.message?.model || model;
            if (event.message?.usage) {
              usage.input_tokens = event.message.usage.input_tokens;
              usage.cache_creation_input_tokens = event.message.usage.cache_creation_input_tokens;
              usage.cache_read_input_tokens = event.message.usage.cache_read_input_tokens;
            }
            break;

          case 'content_block_start':
            if (event.content_block?.type === 'text') {
              contentBlocks[event.index] = { type: 'text', text: '' };
            } else if (event.content_block?.type === 'tool_use') {
              hasToolUse = true;
              contentBlocks[event.index] = {
                type: 'tool_use',
                id: event.content_block.id,
                name: event.content_block.name,
                input: '',
              };
            } else if (event.content_block) {
              // Pass-through unknown block types (server_tool_use, web_search_tool_result, …)
              contentBlocks[event.index] = { ...event.content_block };
            }
            break;

          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && contentBlocks[event.index]) {
              const t = event.delta.text || '';
              contentBlocks[event.index].text += t;
              if (!hasToolUse && t && onTextDelta) {
                try {
                  onTextDelta(t);
                  textStreamed = true;
                } catch (err) {
                  console.warn('[LLMClient] onTextDelta threw:', err.message);
                }
              }
            } else if (event.delta?.type === 'input_json_delta' && contentBlocks[event.index]?.type === 'tool_use') {
              contentBlocks[event.index].input += event.delta.partial_json || '';
            }
            break;

          case 'content_block_stop':
            if (contentBlocks[event.index]?.type === 'tool_use') {
              try {
                contentBlocks[event.index].input = JSON.parse(contentBlocks[event.index].input || '{}');
              } catch {
                contentBlocks[event.index].input = {};
              }
            }
            break;

          case 'message_delta':
            if (event.usage?.output_tokens != null) {
              usage.output_tokens = event.usage.output_tokens;
            }
            if (event.delta?.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            break;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  return { contentBlocks: contentBlocks.filter(Boolean), model, usage, stopReason, textStreamed };
}

function computeRetryDelay({ attempt, initial, retryAfter }) {
  const ra = parseInt(retryAfter ?? '', 10);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  return initial * Math.pow(2, attempt);
}

/**
 * Abort-aware delay. Resolves after `ms`, or rejects immediately if `signal`
 * is (or becomes) aborted — so a cancelled call doesn't sit out the full retry
 * backoff before noticing. With no signal it behaves like a plain setTimeout.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let onAbort;
    const t = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(t);
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Normalize an AbortSignal's reason into an Error for rejection/throwing. */
function abortReason(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  return new Error(typeof r === 'string' && r ? r : 'aborted');
}

async function safeReadText(response) {
  try { return await response.text(); } catch { return ''; }
}

/**
 * Strip the API key (and any other obvious secrets) from error messages
 * before they bubble up to logs or the response. Anthropic keys start with
 * `sk-ant-` so we redact anything matching that prefix.
 */
const ANTHROPIC_KEY_RX = /sk-ant-[A-Za-z0-9_\-]{20,}/g;
function redactString(s) {
  if (typeof s !== 'string') return s;
  return s.replace(ANTHROPIC_KEY_RX, 'sk-ant-[redacted]');
}
function redactError(err) {
  if (err && typeof err.message === 'string') {
    err.message = redactString(err.message);
  }
  return err;
}
