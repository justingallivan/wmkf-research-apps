/**
 * API Route: /api/qa
 *
 * Streaming Q&A endpoint for the Proposal Summarizer.
 * Accepts multi-turn conversation history + proposal text,
 * streams Claude responses via SSE, supports web search tool.
 */

import { BASE_CONFIG, getModelForApp } from '../../shared/config/baseConfig';
import { loadModelOverrides } from '../../lib/services/model-override-loader';
import { nextRateLimiter } from '../../shared/api/middleware/rateLimiter';
import { requireAppAccess } from '../../lib/utils/auth';
import { LLMClient } from '../../lib/services/llm-client';
import { createQASystemPrompt } from '../../shared/config/prompts/proposal-summarizer';
import {
  DATA_CLASSES,
  QA_PROPOSAL_CONTEXT_MAX_CHARS,
  QA_SUMMARY_MAX_CHARS,
  wrapUntrustedContent,
  deriveStableNonce,
} from '../../lib/utils/ai-payload-boundary';

export const config = {
  api: {
    bodyParser: { sizeLimit: '4mb' },
  },
  maxDuration: 120,
};

const limiter = nextRateLimiter({ max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'phase-ii-writeup', 'batch-proposal-summaries');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { question, messages = [], proposalText, summaryText, filename } = req.body;

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      sendEvent('error', { message: 'Claude API key not configured on server' });
      return res.end();
    }

    if (!question) {
      sendEvent('error', { message: 'Question is required' });
      return res.end();
    }

    const userProfileId = access.profileId;

    // Prompt caching: Q&A is multi-turn against ONE proposal+summary that lead
    // the (cache_control-marked) system prompt. A fresh per-call nonce would put
    // unique bytes at the front and defeat prefix caching, so derive a nonce
    // that is stable for this proposal/summary across the conversation's turns
    // (keyed by a server secret — see deriveStableNonce). Different content
    // yields a different nonce; if no server secret is configured this is null
    // and wrapUntrustedContent falls back to a per-call random nonce (safe, but
    // uncached). The two nonces stay distinct because their source tag differs.
    const proposalPayload = wrapUntrustedContent({
      text: proposalText || '',
      source: 'qa.system.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: QA_PROPOSAL_CONTEXT_MAX_CHARS,
      label: 'research proposal',
      nonce: deriveStableNonce('qa.system.proposalText', filename || '', proposalText || ''),
    });
    const summaryPayload = wrapUntrustedContent({
      text: summaryText || '',
      source: 'qa.system.summaryText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: QA_SUMMARY_MAX_CHARS,
      label: 'generated summary',
      nonce: deriveStableNonce('qa.system.summaryText', filename || '', summaryText || ''),
    });
    sendEvent('payload_boundary', {
      message: proposalPayload.metadata.truncated
        ? `Proposal text truncated to ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before Q&A`
        : `Proposal text bounded at ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before Q&A`,
      aiPayloadBoundary: proposalPayload.metadata,
    });

    // Build system prompt with proposal context
    const systemPrompt = createQASystemPrompt(
      proposalPayload.text,
      summaryPayload.text,
      filename || 'Unknown',
      [proposalPayload.nonce, summaryPayload.nonce],
    );

    // Build conversation messages — trim to last 6 messages (3 exchanges)
    // to keep context manageable while preserving recent conversation
    let conversationMessages = [];
    if (messages.length > 6) {
      conversationMessages.push({
        role: 'user',
        content: '[Earlier conversation messages omitted for brevity. The proposal text and summary are in the system prompt above.]'
      });
      conversationMessages.push({
        role: 'assistant',
        content: 'Understood. I have the full proposal and summary available. How can I help?'
      });
      conversationMessages = conversationMessages.concat(messages.slice(-6));
    } else {
      conversationMessages = [...messages];
    }

    // Add the new question
    conversationMessages.push({ role: 'user', content: question });

    sendEvent('thinking', { message: 'Analyzing your question...' });

    const model = getModelForApp('qa');

    // LLMClient handles usage logging (incl. cache tokens) internally now.
    const response = await callClaudeStreaming(apiKey, model, systemPrompt, conversationMessages, sendEvent, userProfileId);

    sendEvent('complete', {
      // Let client know if the turn was paused (response may be incomplete)
      ...(response.stopReason === 'pause_turn' ? { paused: true } : {}),
    });
  } catch (error) {
    console.error('Q&A streaming error:', error);
    sendEvent('error', { message: error.message || 'Failed to process question' });
  } finally {
    res.end();
  }
}

/**
 * Call Claude API with streaming + web_search, relay text deltas + final
 * citation sources to the client. Cache tokens land in usage logging.
 */
async function callClaudeStreaming(apiKey, model, systemPrompt, messages, sendEvent, userProfileId) {
  const claude = new LLMClient({
    apiKey,
    model,
    appName: 'qa',
    userProfileId,
    // The wrapper's default 3 retries on 429/529 supersedes the old "retry
    // once on 429" — the route's UX is identical otherwise.
  });

  const sources = [];
  let sentSearchEvent = false;

  const r = await claude.stream({
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
    maxTokens: 4096,
    temperature: 0.4,
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
      // code_execution auto-injected by web_search_20260209 for dynamic filtering
    ],
    onTextDelta: (text) => sendEvent('text_delta', { text }),
    onEvent: (event) => {
      // Web search "Searching..." progress signal
      if (event.type === 'content_block_start' &&
          event.content_block?.type === 'server_tool_use' && !sentSearchEvent) {
        sendEvent('thinking', { message: 'Searching the web...' });
        sentSearchEvent = true;
      }
      // Source URLs from web_search_tool_result blocks
      if (event.type === 'content_block_start' &&
          event.content_block?.type === 'web_search_tool_result') {
        const results = event.content_block.content;
        if (Array.isArray(results)) {
          for (const x of results) {
            if (x.type === 'web_search_result' && x.url && !sources.some(s => s.url === x.url)) {
              sources.push({ url: x.url, title: x.title || '' });
            }
          }
        }
      }
      // Inline citations on text_delta events
      if (event.type === 'content_block_delta' && event.delta?.citations) {
        for (const cite of event.delta.citations) {
          if (cite.url && !sources.some(s => s.url === cite.url)) {
            sources.push({ url: cite.url, title: cite.title || '', cited_text: cite.cited_text || '' });
          }
        }
      }
    },
  });

  if (sources.length > 0) {
    sendEvent('sources', { sources });
  }

  // Match legacy return shape so the caller's logUsage block keeps working.
  return {
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
    },
    model: r.model,
    stopReason: r.stopReason,
  };
}

function getApiErrorMessage(status, responseText) {
  switch (status) {
    case 429:
      return 'Rate limit exceeded. Please wait a moment and try again.';
    case 529:
    case 503:
      return 'Claude API is temporarily overloaded. Please try again in a minute.';
    case 401:
      return 'API authentication failed. Please contact an administrator.';
    case 400: {
      if (responseText.includes('context_length_exceeded') || responseText.includes('too many tokens')) {
        return 'Conversation is too long. Please start a new chat.';
      }
      return 'Request error. Please try again.';
    }
    default:
      return `API error (${status}). Please try again.`;
  }
}
