/**
 * Claude API calls for the Dynamics Explorer: the streaming, tool-capable
 * call used by the interactive chat loop, and the non-streaming call used by
 * AI batch processing.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:596-640,
 * 2472-2498 (pre-S2 line numbers); characterization tests are the safety
 * net. The `// ─── AI Batch Processing: batch call ───` and
 * `// ─── End of model calls ───` markers below are not verbatim source —
 * they exist to satisfy tests/unit/dynamics-explorer-call-config.test.js's
 * function-slicing seam, which requires a trailing `// ───` marker after
 * each isolated function.
 */

import { LLMClient } from '../llm-client';
import { getModelForApp } from '../../../shared/config/baseConfig';

// ─── Claude API call ───

/**
 * Call Claude API with streaming. Returns a parsed response object.
 * When onTextDelta is provided AND the response is text-only (no tool use),
 * text chunks are forwarded in real-time via the callback.
 *
 * @param {Object} opts
 * @param {Function} [opts.onTextDelta] - callback(text) for streaming text chunks
 * @returns {Promise<{content, model, usage}>}
 */
export async function callClaude({ apiKey, model, fallbackModel, systemPrompt, messages, tools, userProfileId, requestId, requestRound, signal, onTextDelta }) {
  const claude = new LLMClient({
    apiKey,
    model,
    fallbackModel,
    appName: 'dynamics-explorer',
    userProfileId,
    requestId,
    requestRound,
  });
  const r = await claude.stream({
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
    tools,
    maxTokens: 16000,
    outputConfig: { effort: 'low' },
    signal,
    onTextDelta,
  });
  return {
    content: r.content,
    model: r.model,
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
    },
    stopReason: r.stopReason,
    refused: r.refused,
    _textStreamed: r.textStreamed, // flag so the caller knows text was already sent
  };
}

// ─── AI Batch Processing: batch call ───

/**
 * Non-streaming Claude API call for batch processing.
 * No tools, no text streaming — just returns raw text and usage.
 */
export async function callClaudeBatch({ systemPrompt, userMessage, userProfileId }) {
  const claude = new LLMClient({
    apiKey: process.env.CLAUDE_API_KEY,
    model: getModelForApp('dynamics-explorer'),
    appName: 'dynamics-explorer-export',
    userProfileId,
  });
  const r = await claude.complete({
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 4096,
  });
  return {
    text: r.text,
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
    },
  };
}

// ─── End of model calls ───
