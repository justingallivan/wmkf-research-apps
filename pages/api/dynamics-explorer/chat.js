/**
 * API Route: /api/dynamics-explorer/chat
 *
 * Agentic chat endpoint for the Dynamics Explorer.
 * Runs a server-side tool-use loop: user question → Claude tool calls
 * → Dynamics API execution → Claude response → SSE stream to client.
 *
 * Data boundary: role-gated, org-wide CRM exploration. The caller's access
 * is shaped by `dynamics_user_roles` (read_only / read_write / superuser)
 * plus org-wide table/field rules in `dynamics_restrictions`, loaded into
 * `withDynamicsContext` here and enforced inside every tool by
 * `DynamicsService.checkRestriction`. Within those rules the user sees
 * Dynamics data org-wide — not user-scoped — because CRM records belong
 * to the foundation, not to individual staff. Tightening to per-user
 * visibility (e.g., PD-only) is the job of Dataverse security roles, not
 * this layer.
 *
 * Architecture: Search-first discovery with server-side relationship traversal.
 * 11 tools: search, get_entity, get_related, describe_table, query_records,
 * count_records, aggregate, find_reports_due, list_documents, search_documents, export_csv.
 */

import crypto from 'crypto';
import { requireAppAccess } from '../../../lib/utils/auth';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { sql } from '@vercel/postgres';
import ExcelJS from 'exceljs';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { withDynamicsContext } from '../../../lib/services/dynamics-context';
import { GraphService } from '../../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../../lib/utils/sharepoint-buckets';
import { buildSystemPrompt, TOOL_DEFINITIONS, TABLE_ANNOTATIONS, formatInlineFieldDescription, formatInlineRule } from '../../../shared/config/prompts/dynamics-explorer';
import {
  DATA_CLASSES,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../../lib/utils/ai-payload-boundary';
import { getModelForApp, getFallbackModelForApp } from '../../../shared/config/baseConfig';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { estimateCostCents } from '../../../lib/utils/usage-logger';
import { LLMClient } from '../../../lib/services/llm-client';
import {
  serializeDynamicsExplorerFieldValueForModel,
  serializeDynamicsExplorerRecordForModel,
  serializeDynamicsExplorerToolResult,
} from '../../../lib/utils/dynamics-explorer-serializer';
import { buildResolvedTaxonomyPromptBlock } from '../../../lib/services/dynamics-explorer-taxonomy';
import {
  DynamicsExplorerRequestTelemetry,
  normalizeSessionId,
} from '../../../lib/services/dynamics-explorer-request-telemetry';
import {
  expandRestrictedFieldNames,
  isLookupAliasType,
  lookupAliasFor,
  validateODataCall,
} from '../../../lib/services/dynamics-odata-validator';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};

const limiter = nextRateLimiter({ max: 10 });

const MAX_TOOL_ROUNDS = 15;
const MAX_RESULT_CHARS = 16000;
// A7 Part 3: cap for the untrusted-content wrapper applied to CRM records in
// the AI export pass. Generous — a 15-record batch of serialized rows — but
// finite so a runaway payload cannot ride through unbounded.
const DYNEXP_EXPORT_MAX_CHARS = 500_000;
const OPERATIONAL_LOG_TABLES = new Set(['wmkf_ai_run', 'wmkf_ai_runs']);

// Per-tool char limits — composite tools return compact text and need more room
const TOOL_CHAR_LIMITS = {
  search: 12000,
  get_related: 12000,
  find_reports_due: 12000,
  describe_table: 12000,
  list_documents: 8000,
  search_documents: 10000,
  export_csv: 4000,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const access = await requireAppAccess(req, res, 'dynamics-explorer');
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      return false;
    }
  };

  const { messages, sessionId: rawSessionId } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    sendEvent('error', { message: 'At least one message is required' });
    res.end();
    return;
  }

  const userProfileId = access.profileId;
  const sessionId = normalizeSessionId(rawSessionId);
  const requestId = crypto.randomUUID();
  const abortController = new AbortController();
  let terminalIntent = false;
  let disconnectObserved = false;
  let completedRounds = 0;
  let lastModel = null;
  let lastStopReason = null;
  let errorStage = 'context';

  const finalizeLifecycle = (outcome, overrides = {}) =>
    DynamicsExplorerRequestTelemetry.finalizeRequest({
      requestId,
      userProfileId,
      sessionId,
      outcome,
      roundsUsed: completedRounds,
      model: lastModel,
      stopReason: lastStopReason,
      errorStage: outcome === 'error' ? errorStage : null,
      ...overrides,
    });

  const handleDisconnect = () => {
    if (terminalIntent || disconnectObserved) return;
    // LOAD-BEARING ordering: the abort rejection reaches the outer catch. Set
    // the durable classification flag before aborting so that catch converges
    // on client_disconnected instead of racing an `error` finalizer.
    disconnectObserved = true;
    abortController.abort();
    void finalizeLifecycle('client_disconnected');
  };

  req.once?.('aborted', handleDisconnect);
  res.once?.('close', handleDisconnect);

  await DynamicsExplorerRequestTelemetry.startRequest({
    requestId,
    userProfileId,
    sessionId,
  });

  if (disconnectObserved) {
    req.off?.('aborted', handleDisconnect);
    res.off?.('close', handleDisconnect);
    return;
  }

  try {
    const claudeApiKey = process.env.CLAUDE_API_KEY;

    if (!claudeApiKey) {
      errorStage = 'model';
      terminalIntent = true;
      await finalizeLifecycle('error');
      sendEvent('error', {
        message: 'Claude API key not configured on server',
        requestId,
      });
      return;
    }

    await loadModelOverrides();

    const [userRole, restrictions] = await Promise.all([
      getUserRole(userProfileId),
      getActiveRestrictions(),
    ]);
    return await withDynamicsContext({ restrictions, requestId }, async () => {
    // A7 Part 3: CRM records returned as tool_result are untrusted — applicant-
    // and staff-authored free-text fields can carry injection payloads that get
    // re-fed into the agent loop. Each tool_result content string is wrapped in
    // nonce sentinels (see executeOne); the preamble tells the model that
    // sentinel-delimited tool output is data, not instructions. A fresh nonce
    // per round means the preamble carries the general rule, not a nonce list.
    const resolvedTaxonomyBlock = await buildResolvedTaxonomyPromptBlock({ restrictions });
    const systemPrompt = `${buildUntrustedContentPreamble()}\n\n${buildSystemPrompt({ userRole, restrictions, resolvedTaxonomyBlock })}`;

    // Only send the last few user/assistant exchanges to stay within token limits
    const claudeMessages = trimConversation(messages);

    sendEvent('thinking', { message: 'Analyzing your question...' });

    // ─── Agentic loop ───
    let round = 0;
    let currentMessages = [...claudeMessages];
    const model = getModelForApp('dynamics-explorer');
    const fallbackModel = getFallbackModelForApp('dynamics-explorer');
    lastModel = model;

    while (round < MAX_TOOL_ROUNDS) {
      if (disconnectObserved) {
        await finalizeLifecycle('client_disconnected');
        return;
      }
      round++;

      errorStage = 'model';
      const claudeResponse = await callClaude({
        apiKey: claudeApiKey,
        model,
        fallbackModel,
        systemPrompt,
        messages: currentMessages,
        tools: TOOL_DEFINITIONS,
        userProfileId,
        requestId,
        requestRound: round,
        signal: abortController.signal,
        onTextDelta: (text) => {
          // Stream text chunks to client in real-time
          sendEvent('text_delta', { text });
        },
      });
      completedRounds = round;
      lastModel = claudeResponse.model || lastModel;
      lastStopReason = claudeResponse.stopReason || null;

      const textBlocks = claudeResponse.content.filter(b => b.type === 'text');
      const toolBlocks = claudeResponse.content.filter(b => b.type === 'tool_use');

      if (toolBlocks.length === 0) {
        const outcome = claudeResponse.refused || claudeResponse.stopReason === 'refusal'
          ? 'refused'
          : claudeResponse.stopReason === 'max_tokens'
            ? 'truncated'
            : 'completed';
        terminalIntent = true;
        await finalizeLifecycle(outcome);

        if (!claudeResponse._textStreamed) {
          // Text wasn't streamed (shouldn't happen, but fallback)
          const finalText = textBlocks.map(b => b.text).join('\n');
          sendEvent('response', { content: finalText });
        }
        // Check if response suggests failure — prompt user for feedback
        const finalText = textBlocks.map(b => b.text).join('\n');
        const suggestFeedback = outcome !== 'completed' || detectPossibleFailure(finalText);
        sendEvent('complete', { requestId, rounds: round, outcome, suggestFeedback });
        return;
      }

      errorStage = 'tool';
      // Execute tool calls — parallel when multiple tools in one round
      const toolResults = [];

      // Send all thinking messages upfront
      for (const toolBlock of toolBlocks) {
        const restricted = checkRestriction(toolBlock.name, toolBlock.input, restrictions);
        if (!restricted) {
          sendEvent('thinking', { message: getThinkingMessage(toolBlock.name, toolBlock.input) });
        }
      }

      const executeOne = async (toolBlock) => {
        const { id, name, input } = toolBlock;
        if (process.env.NODE_ENV === 'development') {
          console.log(`[DynExp] Round ${round} tool: ${name}`, JSON.stringify(input).substring(0, 200));
        }

        const restricted = checkRestriction(name, input, restrictions);
        if (restricted) {
          sendEvent('thinking', { message: `Blocked: ${restricted}` });
          logQuery({ requestId, requestRound: round, userProfileId, sessionId, queryType: name, tableName: input.table_name || null, queryParams: input, recordCount: 0, executionTime: 0, wasDenied: true, denialReason: restricted });
          return { type: 'tool_result', tool_use_id: id, content: `DENIED: ${restricted}` };
        }

        const startTime = Date.now();
        let result;
        try {
          result = await executeTool(name, input, sendEvent, userProfileId, restrictions);
        } catch (err) {
          const errMsg = err.message || 'Unknown error';
          console.log(`[DynExp] Round ${round} ${name} ERROR:`, errMsg.substring(0, 200));
          // A5: classify into a typed, actionable result (unknown field/entity →
          // closest valid names + describe_table pointer) so Claude can
          // deterministically self-correct instead of re-guessing across rounds.
          result = await classifyToolError(err, name, input, restrictions);
        }
        const executionTime = Date.now() - startTime;

        const recordCount = deriveRecordCount(name, result);
        console.log(`[DynExp] Round ${round} ${name} → ${recordCount} records, ${executionTime}ms`);

        logQuery({
          requestId,
          requestRound: round,
          userProfileId,
          sessionId,
          queryType: name,
          tableName: input.table_name || null,
          queryParams: input,
          recordCount,
          executionTime,
          wasDenied: false,
          denialReason: result?._validatorReject ? `ODATA_VALIDATOR_REJECT: ${result.error}` : null,
        });

        // `_notFound` is internal telemetry framing — strip it before the
        // result reaches the model.
        if (result && typeof result === 'object' && '_notFound' in result) {
          delete result._notFound;
        }

        const resultForModel = serializeDynamicsExplorerToolResult(
          result?._validatorReject ? { error: result.error } : result,
          { toolName: name }
        );
        const charLimit = TOOL_CHAR_LIMITS[name] || MAX_RESULT_CHARS;
        const resultStr = truncateResult(resultForModel, charLimit);

        // A7 Part 3: wrap the CRM tool output in nonce sentinels so injection
        // text in a record field cannot pose as an instruction to the agent.
        const wrapped = wrapUntrustedContent({
          text: resultStr,
          source: `dynamics-explorer.tool_result.${name}`,
          dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
          maxChars: charLimit,
          label: `${name} result`,
        });

        return { type: 'tool_result', tool_use_id: id, content: wrapped.text };
      };

      // `settled` is index-aligned with toolBlocks, so a rejected executeOne
      // still knows which tool_use it belongs to. Answering with a literal
      // 'unknown' id instead left the real tool_use unanswered AND added a
      // tool_result for an id that was never issued — both of which the
      // Anthropic API rejects on the next round, turning any rejection here
      // into an unexplainable top-level failure.
      const settled = await Promise.allSettled(toolBlocks.map(executeOne));
      settled.forEach((s, i) => {
        toolResults.push(s.status === 'fulfilled' ? s.value : {
          type: 'tool_result',
          tool_use_id: toolBlocks[i].id,
          content: JSON.stringify({ error: s.reason?.message || 'Tool execution failed' }),
        });
      });

      if (disconnectObserved) {
        await finalizeLifecycle('client_disconnected');
        return;
      }

      // Append assistant + tool results, then compact old rounds
      currentMessages.push({
        role: 'assistant',
        content: claudeResponse.content,
      });
      currentMessages.push({
        role: 'user',
        content: toolResults,
      });

      // Compact earlier tool rounds to save tokens for the next call
      currentMessages = compactMessages(currentMessages);
    }

    console.log(`[DynExp] Hit max rounds (${MAX_TOOL_ROUNDS}) without final answer`);
    terminalIntent = true;
    await finalizeLifecycle('max_rounds');
    sendEvent('response', { content: 'Reached maximum query steps. Please refine your question.' });
    sendEvent('complete', { requestId, rounds: round, outcome: 'max_rounds', maxRoundsReached: true, suggestFeedback: true });
    });
  } catch (error) {
    if (disconnectObserved) {
      await finalizeLifecycle('client_disconnected');
      return;
    }

    terminalIntent = true;
    await finalizeLifecycle('error');
    console.error(`Dynamics Explorer chat error [requestId=${requestId}]:`, error);
    sendEvent('error', {
      message: describeChatFailure(error),
      requestId,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    req.off?.('aborted', handleDisconnect);
    res.off?.('close', handleDisconnect);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

// ─── Top-level failure copy ───
//
// Tool failures never reach this path — they are classified by
// classifyToolError and fed back into the agent loop. Everything that DOES
// reach the outer catch is infrastructure: the Claude call, the role/
// restriction load, or the taxonomy build. A single "Query failed" string told
// the user nothing about which, and left nothing to quote when escalating.
//
// In production the raw error stays server-side (logged above with the same
// requestId); in development it is ALSO returned as `details` for local
// debugging — so "server-side only" holds for production, not for every mode.
// Copy follows the house voice for transient failures: the system is the
// subject, plain words, and a retry → administrator action ladder. It never
// implies the user's own access is in doubt.

// "press retry" would name a button the Explorer does not have — an error
// message is a plain chat bubble, and the only recovery is asking again.
const RETRY_LADDER = 'Please try asking again, and if the problem doesn\'t resolve, contact an administrator.';

/**
 * Map a top-level chat failure to user-facing copy.
 * @param {Error & { status?: number }} error
 * @returns {string}
 */
function describeChatFailure(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  const raw = String(error?.message || '');
  const isAbort = error?.name === 'AbortError' || /\baborted\b/i.test(raw);
  const isTimeout = /\btimeout\b/i.test(raw);

  if (isTimeout || isAbort) {
    return 'That question took too long to answer, so I stopped it. Narrowing it usually '
      + 'helps — name a single organization, or add a date range. '
      + 'No data was changed. ' + RETRY_LADDER;
  }

  if (status === 429) {
    return 'The AI service is handling too many requests at the moment, so it turned '
      + 'mine away. This is usually a temporary blip. ' + RETRY_LADDER;
  }

  if (status === 529 || status === 503) {
    return 'The AI service is temporarily overloaded and couldn\'t take my request. '
      + 'This is usually a temporary blip. ' + RETRY_LADDER;
  }

  if (status !== null) {
    return 'I\'m having trouble reaching the AI service, so I couldn\'t work through '
      + 'your question. This is usually a temporary blip. ' + RETRY_LADDER;
  }

  return 'Something went wrong on my side before I could finish your question. '
    + 'This is usually a temporary blip. ' + RETRY_LADDER;
}

// ─── Auto-detection ───

/**
 * Check if Claude's final response text suggests a failure to find or answer.
 * Returns true if the response contains patterns indicating no results or inability to answer.
 */
function detectPossibleFailure(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const failurePatterns = [
    'i couldn\'t find',
    'i could not find',
    'i wasn\'t able to',
    'i was not able to',
    'no results',
    'no records found',
    'no matching',
    'unable to locate',
    'unable to find',
    'doesn\'t appear to',
    'does not appear to',
    'i don\'t have enough',
    'i do not have enough',
    'unfortunately',
    'i\'m not sure how to',
  ];
  return failurePatterns.some(pattern => lower.includes(pattern));
}

// ─── Conversation management ───

/**
 * Bound conversation history to six messages. When trimming is required, two
 * synthetic context notices plus the four most recent real messages are sent.
 * The most recent user message is always kept.
 */
function trimConversation(messages) {
  const cleaned = messages.map(m => ({ role: m.role, content: m.content }));
  if (cleaned.length <= 6) return cleaned;
  // Keep a two-message summary hint + the last four real messages.
  return [
    { role: 'user', content: '[Earlier conversation context was trimmed to save tokens]' },
    { role: 'assistant', content: 'Understood, I\'ll work with the recent context.' },
    ...cleaned.slice(-4),
  ];
}

/**
 * Compact old tool-use rounds: replace all but the most recent tool results
 * with brief summaries to dramatically reduce token count.
 */
function compactMessages(messages) {
  // Find all tool_result message indices (role=user, content is array of tool_results)
  const toolResultIndices = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result') {
      toolResultIndices.push(i);
    }
  }

  // Only compact if there are 2+ tool rounds — keep the latest intact
  if (toolResultIndices.length < 2) return messages;

  const result = [...messages];
  // Compact all but the last tool round
  for (let idx = 0; idx < toolResultIndices.length - 1; idx++) {
    const msgIdx = toolResultIndices[idx];
    const oldResults = result[msgIdx].content;

    // Replace verbose tool results with one-line summaries
    const compacted = oldResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.tool_use_id,
      content: summarizeToolResult(tr.content),
    }));

    result[msgIdx] = { ...result[msgIdx], content: compacted };

    // Also compact the preceding assistant message's tool_use input fields
    const assistantIdx = msgIdx - 1;
    if (assistantIdx >= 0 && result[assistantIdx].role === 'assistant' && Array.isArray(result[assistantIdx].content)) {
      result[assistantIdx] = {
        ...result[assistantIdx],
        content: result[assistantIdx].content.map(block => {
          if (block.type === 'tool_use') {
            return { ...block, input: {} }; // Clear verbose input since result is summarized
          }
          return block;
        }),
      };
    }
  }

  return result;
}

/**
 * Summarize a tool result string to a brief one-liner.
 */
function summarizeToolResult(content) {
  if (!content || content.length < 100) return content;
  try {
    const data = JSON.parse(content);
    if (data.error) return `Error: ${data.error.substring(0, 80)}`;
    if (data.totalCount !== undefined && data.results) return `Search: ${data.totalCount} results`;
    if (data.count !== undefined && data.tables) return `Found ${data.count} tables`;
    if (data.count !== undefined && !data.records) return `Count: ${data.count}`;
    if (data.results && data.operation) {
      if (data.results.length === 1) return `${data.operation}: ${data.results[0]?.value ?? 'null'}`;
      return `${data.operation}: ${data.results.length} groups`;
    }
    if (data.records) return `Returned ${data.records.length} records`;
    if (data.emailCount !== undefined) return `Found ${data.emailCount} emails`;
    if (data.reportCount !== undefined) return `Found ${data.reportCount} reports`;
    if (data.documentCount !== undefined) return `Found ${data.documentCount} documents`;
    if (data.searchCount !== undefined) return `Found ${data.searchCount} matching documents`;
    if (data.fields) return `Table schema returned`;
    if (data.exportedCount !== undefined) return `Exported ${data.exportedCount} records`;
    if (data.estimatedCount !== undefined) return `Estimate: ${data.estimatedCount} records, ~$${(data.estimatedCostCents / 100).toFixed(2)}`;
    return content.substring(0, 100) + '...';
  } catch {
    return content.substring(0, 100) + '...';
  }
}

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
async function callClaude({ apiKey, model, fallbackModel, systemPrompt, messages, tools, userProfileId, requestId, requestRound, signal, onTextDelta }) {
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

// ─── Tool execution ───

/**
 * Strip _formatted fields from $select — they are auto-returned via the
 * Prefer: odata.include-annotations="*" header and cannot be $selected.
 * The model sometimes includes them despite the system prompt rule.
 */
function sanitizeSelect(select) {
  if (!select) return select;
  const fields = select.split(',').map(f => f.trim()).filter(f => !f.endsWith('_formatted'));
  return fields.length > 0 ? fields.join(',') : undefined;
}

/**
 * Inject `statecode eq 0` into a Dynamics OData filter so inactive records are
 * excluded by default. Skipped when the caller opts in via `include_inactive`,
 * or when the user filter already references statecode (respect explicit intent).
 */
function applyActiveOnlyFilter(userFilter, includeInactive) {
  if (includeInactive) return userFilter;
  if (userFilter && /\bstatecode\b/i.test(userFilter)) return userFilter;
  const active = 'statecode eq 0';
  return userFilter ? `(${userFilter}) and ${active}` : active;
}

function isOperationalLogTable(tableName) {
  return OPERATIONAL_LOG_TABLES.has(String(tableName || '').trim().toLowerCase());
}

async function executeTool(name, input, sendEvent, userProfileId, restrictions = []) {
  switch (name) {
    case 'search':
      return await searchRecords(input);

    case 'get_entity':
      {
        const validation = await validateEffectiveODataCall(name, input, restrictions);
        if (validation.reject) return validatorReject(validation.reject);
      }
      return await getEntity(input);

    case 'get_related':
      {
        const validation = await validateEffectiveODataCall(name, input, restrictions);
        if (validation.reject) return validatorReject(validation.reject);
      }
      return await getRelated(input);

    case 'describe_table':
      return await describeTable(input, restrictions);

    case 'query_records': {
      const effectiveInput = {
        ...input,
        select: sanitizeSelect(input.select),
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const result = await DynamicsService.queryRecords(entitySet, {
        select: effectiveInput.select,
        filter: effectiveInput.filter,
        orderby: input.orderby,
        top: input.top || 50,
        expand: input.expand,
      });
      result.records = result.records.map(stripEmpty);
      return result;
    }

    case 'count_records': {
      const effectiveInput = {
        ...input,
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const count = await DynamicsService.countRecords(
        entitySet,
        effectiveInput.filter,
      );
      return { count };
    }

    case 'aggregate': {
      const effectiveInput = {
        ...input,
        filter: applyActiveOnlyFilter(input.filter, input.include_inactive),
      };
      const validation = await validateEffectiveODataCall(name, effectiveInput, restrictions);
      if (validation.reject) return validatorReject(validation.reject);
      const entitySet = await DynamicsService.resolveEntitySetName(input.table_name);
      const result = await DynamicsService.aggregateRecords(entitySet, {
        field: input.field,
        operation: input.operation,
        filter: effectiveInput.filter,
        groupBy: input.group_by,
      });
      if (result.results) result.results = result.results.map(stripEmpty);
      return result;
    }

    case 'find_reports_due':
      return await findReportsDue(input);

    case 'list_documents': {
      const docResult = await listDocuments(input);
      if (docResult._files?.length > 0) {
        sendEvent('document_links', {
          requestNumber: docResult.requestNumber,
          files: docResult._files,
        });
        delete docResult._files; // Don't send structured data to Claude
      }
      return docResult;
    }

    case 'search_documents': {
      const searchResult = await searchDocuments(input);
      if (searchResult._files?.length > 0) {
        sendEvent('document_links', { files: searchResult._files });
        delete searchResult._files;
      }
      return searchResult;
    }

    case 'export_csv':
      return await exportCsv(input, sendEvent, userProfileId, restrictions);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function validateEffectiveODataCall(name, input, restrictions) {
  if (isOperationalLogTable(input?.table_name)) {
    return {
      reject: 'DENIED: wmkf_ai_run is an operational AI audit log, not business data. '
        + 'Dynamics Explorer does not expose it through natural-language queries.',
    };
  }
  return await validateODataCall(name, input, {
    tableAnnotations: TABLE_ANNOTATIONS,
    getEntityAttributes: tableName => DynamicsService.getEntityAttributes(tableName),
    restrictions,
    entityConfigs: ENTITY_TYPE_CONFIGS,
  });
}

function validatorReject(message) {
  return { error: message, _validatorReject: true };
}

// `get_entity` resolves to a BARE record rather than a collection. `get_record`
// is deliberately NOT here: no such branch exists in executeTool.
const ENTITY_LOOKUP_TOOLS = new Set(['get_entity']);

// Tools that answer with SCHEMA rather than data. A successful describe_table
// has no count field at all; reporting 0 would file a success under
// "zero results", so it counts as the one schema it returned.
const METADATA_TOOLS = new Set(['describe_table']);

// Count fields in preference order, derived from the actual return shapes in
// this file rather than guessed. Two rules make the order what it is:
//
//  1. `count` first — for count_records the count IS the answer.
//  2. The TARGET of the call beats incidental context, and `totalCount` comes
//     LAST. Several relationship handlers return both a specific count and a
//     total: account→emails returns `emailCount` (emails found) alongside
//     `requestCount` (requests scanned to find them), and most handlers return
//     `totalCount` (total matching in Dataverse) next to the number of target
//     rows actually returned. Those tool-specific counts win. Search is the
//     deliberate exception: its formatted `results` value is a string, so
//     `totalCount` is the relevant search cardinality. `requestCount` sits after
//     the other targets because it is context whenever one of them is present.
const COUNT_FIELDS = [
  'count',
  'emailCount', 'paymentCount', 'reportCount', 'annotationCount', 'reviewerCount',
  'documentCount', 'searchCount',
  'exportedCount', 'estimatedCount',
  'requestCount',
  'totalCount',
];

/**
 * What to write to dynamics_query_log.record_count for one tool result.
 *
 * Semantics: the tool result's relevant cardinality. Search reports total
 * matches; collection queries, exports, and relationship tools report the
 * target rows returned; 0 means a genuine zero-result answer (including an
 * explicitly classified name-based lookup miss); -1 means the tool errored;
 * a schema or single-entity answer counts as 1.
 *
 * The original expression was a falsy-chain
 * (`records?.length || results?.length || count || searchCount || …`) which
 * logged `search`'s formatted-string LENGTH as a count (212 for 3 hits), logged
 * 0 for every successful get_entity, and ignored export counts entirely. A
 * first correction fixed those but still preferred `totalCount` over the
 * tool-specific field and omitted `annotationCount`/`reviewerCount`, so
 * relationship calls reported total matches instead of returned rows and
 * request→reviewers reported 0 on success. Both rounds of that are covered by
 * tests built from the real return shapes.
 *
 * NOTE: rows written before this change carry the old semantics — any trend
 * analysis spanning it must treat the eras separately.
 */
export function deriveRecordCount(name, result) {
  if (!result || typeof result !== 'object') return 0;
  if (result._validatorReject) return 0;
  if (result._notFound) return 0;
  if (result.error) return -1;

  // Arrays are genuine collections. Strings never are — that was the search bug.
  if (Array.isArray(result.records)) return result.records.length;
  if (Array.isArray(result.results)) return result.results.length;

  for (const field of COUNT_FIELDS) {
    if (Number.isFinite(result[field])) return result[field];
  }

  if (ENTITY_LOOKUP_TOOLS.has(name)) return 1;
  if (METADATA_TOOLS.has(name)) return 1;
  return 0;
}

/**
 * Strip null, empty string, false, and 0 values from a record.
 * Also remove internal fields (starting with @ or containing "odata").
 * This dramatically reduces payload for sparse Dynamics records.
 */
function stripEmpty(record) {
  if (!record || typeof record !== 'object') return record;
  const cleaned = {};
  for (const [key, value] of Object.entries(record)) {
    // Skip OData metadata
    if (key.startsWith('@') || key.includes('odata')) continue;
    // Skip null/empty/zero/false
    if (value === null || value === undefined || value === '' || value === false || value === 0) continue;
    // Skip GUID-like null values (all zeros)
    if (typeof value === 'string' && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Truncate a tool result to fit within charLimit while preserving valid JSON.
 * For results with records arrays, trims records and reports how many were cut
 * so Claude knows to paginate if needed.
 */
function truncateResult(result, charLimit) {
  let str = JSON.stringify(result);
  if (str.length <= charLimit) return str;

  // Record-aware truncation: trim records array rather than cutting JSON mid-string
  if (result?.records && Array.isArray(result.records) && result.records.length > 0) {
    const totalReturned = result.records.length;
    const totalCount = result.totalCount || totalReturned;
    const avgCharsPerRecord = str.length / totalReturned;
    // Leave room for metadata fields (count, totalCount, hasMore, note)
    const maxRecords = Math.max(1, Math.floor((charLimit - 300) / avgCharsPerRecord));

    if (maxRecords < totalReturned) {
      const trimmed = {
        records: result.records.slice(0, maxRecords),
        count: maxRecords,
        totalCount,
        note: `Showing ${maxRecords} of ${totalCount} total. Present the totalCount to the user. To see more, use a tighter $select (fewer fields) or narrower $filter, or present what you have and offer to query with different criteria.`,
      };
      return JSON.stringify(trimmed);
    }
  }

  // Fallback: string truncation for non-record results
  return str.substring(0, charLimit) + '... [truncated]';
}

// ─── describe_table ───

/**
 * Return annotated and live field metadata for a table, or list all annotated
 * tables if no table is requested.
 */
function restrictedFieldsForTable(tableName, restrictions) {
  return new Set(
    restrictions
      .filter(r => r.field_name && r.table_name === tableName)
      .map(r => r.field_name)
  );
}

// Redact restricted field NAMES wherever they appear in free text (table
// descriptions, rules, other fields' descriptions). Dropping a restricted
// field from the field list is not enough — its logical name can still be
// referenced in prose ("filter by wmkf_x ..."), which leaks its existence.
// Token-bounded so a restricted name isn't matched inside a longer logical
// name (logical names are [A-Za-z0-9_]).
function redactRestrictedFieldNames(text, restrictedFieldNames) {
  if (!text || restrictedFieldNames.size === 0) return text;
  let out = String(text);
  for (const name of restrictedFieldNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g');
    out = out.replace(re, '[restricted]');
  }
  return out;
}

// ─── A5: fail-loud typed errors ───
//
// Dataverse 400s for a bad field/entity name are returned as truncated plain
// strings today, so the model re-guesses across rounds (the dominant Explorer
// failure per the S200 soak). Classify the common "unknown field/property"
// shape and hand back a deterministic correction path: the offending name, the
// closest VALID field names (restriction-filtered, capped for token budget),
// and a describe_table pointer — instead of a bare error string.

const UNKNOWN_FIELD_RE = /Could not find a property named '([^']+)'/i;
const UNKNOWN_PROP_RE = /The property '([^']+)' does not exist/i;
const UNKNOWN_SEGMENT_RE = /Resource not found for the segment '([^']+)'/i;

/**
 * Rank valid field names by similarity to a bad name (prefix overlap +
 * substring containment). Lookup fields are filtered as `x` in metadata but
 * queried as `_x_value`, so compare against the de-affixed core too. Returns
 * up to `limit` names.
 */
function closestFieldNames(invalid, validFields, limit = 8) {
  const lc = String(invalid).toLowerCase();
  const core = lc.replace(/^_/, '').replace(/_value$/, '');
  const scored = [];
  for (const v of validFields) {
    const vl = v.toLowerCase();
    let score = 0;
    if (vl === lc || vl === core) score += 100;
    else if (vl.includes(core) || core.includes(vl)) score += 50;
    let p = 0;
    while (p < vl.length && p < core.length && vl[p] === core[p]) p++;
    score += p;
    if (score > 2) scored.push({ v, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.v);
}

async function classifyToolError(err, name, input, restrictions = []) {
  const raw = err?.message || 'Unknown error';
  const fallback = { error: raw.substring(0, 500) };

  // The /$count Edm.Int32 bug surfaces UNKNOWN_FIELD_RE with the CORRECT field
  // name on type 'Edm.Int32' — not a real unknown field. A3 fixed the count
  // path, but guard anyway so this never mislabels it as a bad field.
  if (/on type 'Edm\.Int32'/i.test(raw)) return fallback;

  const fieldMatch = raw.match(UNKNOWN_FIELD_RE) || raw.match(UNKNOWN_PROP_RE);
  if (fieldMatch && input?.table_name) {
    const invalidField = fieldMatch[1];
    try {
      // Normalize to the logical name so enrichment works when the model passed
      // an accepted entity-set alias (e.g. "akoya_requests"), and so restriction
      // filtering matches restrictions (keyed by logical name). Inside the try so
      // any failure falls back to the raw error — enrichment never masks it.
      const tableName = DynamicsService.resolveLogicalName(input.table_name);
      const attrs = await DynamicsService.getEntityAttributes(tableName);
      // Expanded across both lookup spellings so a restriction stored under one
      // can't be suggested back under the other.
      const restricted = expandRestrictedFieldNames(
        restrictedFieldsForTable(tableName, restrictions),
        attrs,
      );
      // Suggest the spelling the model must actually type in $select/$filter.
      // Offering the bare lookup name here contradicted this hint's own
      // "_<name>_value" instruction and cost a round every time.
      const validNames = attrs
        .map(a => (isLookupAliasType(a.type) ? lookupAliasFor(a.logicalName) : a.logicalName))
        .filter(f => !restricted.has(f));
      const suggestions = closestFieldNames(invalidField, validNames);
      return {
        error: raw.substring(0, 300),
        errorType: 'unknown_field',
        invalidField,
        table: tableName,
        suggestions,
        hint: `"${invalidField}" is not a readable field on ${tableName}. Do NOT retry with a guessed name. ${
          suggestions.length ? `Closest valid fields: ${suggestions.join(', ')}. ` : ''
        }Lookup fields are queried as _<name>_value in $filter/$select. For the full field list call describe_table with { table_name: "${tableName}", full: true }.`,
      };
    } catch {
      return fallback; // enrichment is best-effort; never mask the original error
    }
  }

  const segMatch = raw.match(UNKNOWN_SEGMENT_RE);
  if (segMatch) {
    return {
      error: raw.substring(0, 300),
      errorType: 'unknown_entity',
      invalidSegment: segMatch[1],
      hint: `"${segMatch[1]}" is not a valid table/navigation. Use discover_tables to find the correct table name, then describe_table before querying. Do NOT guess.`,
    };
  }

  return fallback;
}

async function describeTable({ table_name, full = false }, restrictions = []) {
  if (!table_name) {
    const tables = Object.entries(TABLE_ANNOTATIONS).map(([name, info]) => {
      const restricted = restrictedFieldsForTable(name, restrictions);
      return `${name} (${info.entitySet}) — ${redactRestrictedFieldNames(info.description, restricted)}`;
    });
    return {
      tables: tables.join('\n'),
      count: tables.length,
      note: 'All annotated tables listed above. Call with a specific table_name for field details, including live Dataverse fields.',
    };
  }
  if (isOperationalLogTable(table_name)) {
    return {
      error: 'DENIED: wmkf_ai_run is an operational AI audit log, not business data. '
        + 'Dynamics Explorer does not expose it through schema suggestions.',
    };
  }

  // Field-level restriction gate. getEntityAttributes only checks TABLE-level
  // restrictions (a wholly-restricted table is blocked upstream by
  // checkRestriction), so a field-level restriction would otherwise leak the
  // restricted attribute's name/metadata through this listing. Drop any field
  // restricted for this table from both the curated and live field sets, and
  // redact its name from all remaining free text (descriptions + rules).
  const table = TABLE_ANNOTATIONS[table_name];
  const liveAttributes = await DynamicsService.getEntityAttributes(table_name);
  // Live metadata is needed to expand a restriction across both lookup
  // spellings, so the attribute fetch has to precede the restriction set.
  const restrictedFieldNames = expandRestrictedFieldNames(
    restrictedFieldsForTable(table_name, restrictions),
    liveAttributes,
  );
  const curatedFields = Object.fromEntries(
    Object.entries(table?.fields || {}).filter(([field]) => !restrictedFieldNames.has(field))
  );
  const curatedNames = new Set(Object.keys(curatedFields));
  const additionalLiveFields = liveAttributes
    .filter(attr => !curatedNames.has(attr.logicalName) && !restrictedFieldNames.has(attr.logicalName))
    .map(attr => {
      const field = {
        logicalName: attr.logicalName,
        displayName: redactRestrictedFieldNames(attr.displayName, restrictedFieldNames),
        type: attr.type,
        description: redactRestrictedFieldNames(attr.description, restrictedFieldNames),
      };
      // AttributeMetadata reports the BARE lookup column, which is exactly the
      // spelling the model then wrote into $filter and Dataverse 400'd. Surface
      // the queryable computed alias alongside it so this path teaches the right
      // name instead of the wrong one.
      if (isLookupAliasType(attr.type)) field.queryAs = lookupAliasFor(attr.logicalName);
      return field;
    });
  const hasLookupAlias = additionalLiveFields.some(f => f.queryAs);

  // Apply the same inline-render sanitizers used by buildInlineSchemas so the
  // describe_table path can't leak stale hardcoded option-set codes (e.g.
  // wmkf_request_type's baked 100000001) that A2 replaced with the resolved
  // taxonomy block. Without this, describe_table('akoya_request') would still
  // surface the raw annotation codes and conflict with the live resolution.
  const fieldLines = Object.entries(curatedFields).map(([field, desc]) =>
    `  ${field}: ${formatInlineFieldDescription(table_name, field, desc)}`
  );
  const rulesBlock = table?.rules?.length > 0
    ? `\nRULES:\n${table.rules.map(r => `  - ${formatInlineRule(table_name, r)}`).join('\n')}`
    : '';

  const result = {
    table: table_name,
    entitySet: table?.entitySet || null,
    description: redactRestrictedFieldNames(
      table?.description || 'Live Dataverse table metadata. No curated annotation is available for this table.',
      restrictedFieldNames,
    ),
    fields: redactRestrictedFieldNames(fieldLines.join('\n'), restrictedFieldNames),
    rules: redactRestrictedFieldNames(rulesBlock, restrictedFieldNames),
    additionalLiveFieldCount: additionalLiveFields.length,
  };

  if (hasLookupAlias) {
    // The bare logicalName is NOT the navigation property. Navigation property
    // names come from relationship metadata (CSDL), are case-sensitive, and for
    // multi-table Customer/Owner/regarding lookups bear no fixed relation to the
    // column's logical name — this path has attribute metadata only, so it must
    // not teach a guess.
    result.lookupFieldNote = 'Lookup/Customer/Owner columns carry a "queryAs" name. '
      + 'Use queryAs (_<name>_value) in $select and $filter, compared to an UNQUOTED GUID or to null. '
      + 'The bare logicalName is not a queryable property, and it is not necessarily the $expand navigation '
      + 'property either: navigation property names come from relationship metadata, are case-sensitive, and '
      + 'for multi-table lookups do not follow the column name — do not guess them. '
      + 'Neither spelling is accepted in $orderby or as an aggregate field/group_by.';
  }

  if (full) {
    result.additionalLiveFields = additionalLiveFields;
  } else {
    result.additionalLiveFieldSample = additionalLiveFields.slice(0, 12);
    result.note = additionalLiveFields.length > result.additionalLiveFieldSample.length
      ? `There are ${additionalLiveFields.length} readable live fields beyond the curated annotations. Call describe_table with full:true for the complete additional list.`
      : 'All additional live fields are shown in the sample.';
  }

  if (!table) {
    result.fields = '';
    result.note = full
      ? 'Unknown to curated annotations; returned full live Dataverse readable fields.'
      : 'Unknown to curated annotations; returned a live Dataverse readable-field sample. Call describe_table with full:true for the complete list.';
  }

  return result;
}

// ─── get_entity ───

/**
 * Entity type configurations for get_entity lookups.
 * Each type defines its entity set, primary key, curated $select, and
 * the field + strategy used for name/number lookups.
 */
const ENTITY_TYPE_CONFIGS = {
  request: {
    entitySet: 'akoya_requests',
    idField: 'akoya_requestid',
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,wmkf_meetingdate,wmkf_numberofyearsoffunding,wmkf_abstract,wmkf_researchconceptstatus,wmkf_mrconcept1title,wmkf_mrconcept2title,wmkf_mrconcept3title,wmkf_mrconcept4title,wmkf_seconcept1title,wmkf_seconcept2title,wmkf_seconcept3title,wmkf_seconcept4title,wmkf_numberofconcepts,wmkf_numberofpayments,wmkf_excludedreviewers,_akoya_applicantid_value,_akoya_primarycontactid_value,_wmkf_programdirector_value,_wmkf_programcoordinator_value,_wmkf_grantprogram_value,_akoya_programid_value,_wmkf_type_value,_wmkf_projectleader_value,_wmkf_researchleader_value,_wmkf_ceo_value,akoya_request,akoya_expenses,akoya_grant,akoya_balance,akoya_originalgrantamount,akoya_loireceived,akoya_decisiondate,akoya_begindate,akoya_enddate,wmkf_phaseistatus,wmkf_phaseiistatus,_wmkf_potentialreviewer1_value,_wmkf_potentialreviewer2_value,_wmkf_potentialreviewer3_value,_wmkf_potentialreviewer4_value,_wmkf_potentialreviewer5_value,statecode,createdon',
    filterField: 'akoya_requestnum',
    filterExact: true, // eq instead of contains
    nameField: 'akoya_requestnum',
  },
  account: {
    entitySet: 'accounts',
    idField: 'accountid',
    select: 'name,akoya_aka,wmkf_legalname,wmkf_dc_aka,akoya_constituentnum,akoya_totalgrants,akoya_countofawards,akoya_countofrequests,wmkf_countofprogramgrants,wmkf_countofconcepts,wmkf_countofdiscretionarygrant,wmkf_sumofprogramgrants,wmkf_sumofdiscretionarygrants,wmkf_eastwest,address1_city,address1_stateorprovince,websiteurl,telephone1,akoya_institutiontype,accountid,createdon',
    filterField: 'name',
    altFilterFields: ['akoya_aka', 'wmkf_dc_aka'], // common name + abbreviation — searched alongside primary name
    filterExact: false, // contains
    nameField: 'name',
    altNameFields: ['akoya_aka', 'wmkf_dc_aka'],
  },
  contact: {
    entitySet: 'contacts',
    idField: 'contactid',
    select: 'fullname,firstname,lastname,emailaddress1,jobtitle,telephone1,akoya_contactnum,statecode,contactid,createdon',
    filterField: 'fullname',
    filterExact: false,
    nameField: 'fullname',
  },
  reviewer: {
    entitySet: 'wmkf_potentialreviewerses',
    idField: 'wmkf_potentialreviewersid',
    select: 'wmkf_name,wmkf_firstname,wmkf_lastname,wmkf_title,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_areaofexpertise,wmkf_potentialreviewersid',
    filterField: 'wmkf_name',
    filterExact: false,
    nameField: 'wmkf_name',
  },
  email: {
    entitySet: 'emails',
    idField: 'activityid',
    select: 'subject,description,sender,torecipients,createdon,directioncode,activityid,_regardingobjectid_value,statecode',
    filterField: null, // GUID-only
    nameField: 'subject',
  },
  payment: {
    entitySet: 'akoya_requestpayments',
    idField: 'akoya_requestpaymentid',
    select: 'akoya_paymentnum,akoya_type,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_postingdate,akoya_requirementdue,akoya_requirementtype,akoya_folio,wmkf_reporttype,_akoya_requestlookup_value,_akoya_requestapplicant_value,statecode,createdon',
    filterField: 'akoya_paymentnum',
    filterExact: true,
    nameField: 'akoya_paymentnum',
  },
  staff: {
    entitySet: 'systemusers',
    idField: 'systemuserid',
    select: 'fullname,firstname,lastname,internalemailaddress,systemuserid,isdisabled',
    filterField: 'fullname',
    filterExact: false,
    nameField: 'fullname',
  },
};

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find a specific entity by human-readable identifier or GUID.
 * Returns full details with resolved lookup display names.
 */
async function getEntity({ type, identifier }) {
  const cfg = ENTITY_TYPE_CONFIGS[type];
  if (!cfg) {
    return { error: `Unknown entity type: "${type}". Valid types: ${Object.keys(ENTITY_TYPE_CONFIGS).join(', ')}` };
  }

  const isGuid = GUID_PATTERN.test(identifier);

  // GUID lookup — direct fetch
  if (isGuid) {
    const record = await DynamicsService.getRecord(cfg.entitySet, identifier, {
      select: cfg.select,
    });
    return stripEmpty(record);
  }

  // Name/number lookup
  if (!cfg.filterField) {
    return { error: `${type} requires a GUID identifier. Use search to find ${type} records first.` };
  }

  const escaped = identifier.replace(/'/g, "''");
  let filter;
  if (cfg.filterExact) {
    filter = `${cfg.filterField} eq '${escaped}'`;
  } else if (cfg.altFilterFields) {
    // Search primary name + all alternate name fields (common name, abbreviation, etc.)
    const clauses = [cfg.filterField, ...cfg.altFilterFields].map(f => `contains(${f},'${escaped}')`);
    filter = `(${clauses.join(' or ')})`;
  } else {
    filter = `contains(${cfg.filterField},'${escaped}')`;
  }

  // For accounts, run Dataverse Search in parallel with OData to catch
  // abbreviation/synonym matches that contains() can't find (e.g. "USC" → "University of Southern California")
  const odataPromise = DynamicsService.queryRecords(cfg.entitySet, {
    select: cfg.select,
    filter,
    top: 10,
  });
  const searchPromise = type === 'account'
    ? DynamicsService.searchRecords(identifier, { entities: ['account'], top: 3 }).catch(() => null)
    : Promise.resolve(null);

  const [result, searchResult] = await Promise.all([odataPromise, searchPromise]);

  // Enrich OData results with high-scoring search results not already found
  if (searchResult?.results?.length) {
    const existingIds = new Set(result.records.map(r => r[cfg.idField]));
    for (const sr of searchResult.results) {
      if (!existingIds.has(sr.objectId) && sr.score > 5) {
        try {
          const fullRecord = await DynamicsService.getRecord(cfg.entitySet, sr.objectId, { select: cfg.select });
          result.records.push(fullRecord);
        } catch (e) { /* search enrichment is best-effort */ }
      }
    }
  }

  if (!result.records.length) {
    // A real zero-result answer, not a tool failure — see deriveRecordCount.
    return { error: `No ${type} found matching "${identifier}"`, _notFound: true };
  }

  // Prefer exact match — check both primary and alternate name fields
  let match;
  if (!cfg.filterExact && result.records.length > 1) {
    const lowerIdent = identifier.toLowerCase();
    const exactMatches = result.records.filter(r => {
      const primary = r[cfg.nameField];
      if (primary && primary.toLowerCase() === lowerIdent) return true;
      if (cfg.altNameFields) {
        for (const altField of cfg.altNameFields) {
          const alt = r[altField];
          if (alt && alt.toLowerCase() === lowerIdent) return true;
        }
      }
      return false;
    });
    // If multiple exact matches, prefer the one with the most requests (most active)
    let exact;
    if (exactMatches.length > 1) {
      exact = exactMatches.sort((a, b) =>
        (b.akoya_countofrequests || b.akoya_countofawards || 0) - (a.akoya_countofrequests || a.akoya_countofawards || 0)
      )[0];
    } else {
      exact = exactMatches[0];
    }

    // If exact match exists but a more-active account also matched (e.g. "USC" matches
    // South Carolina via dc_aka but Southern California has 6x more requests), present
    // all candidates so the model can disambiguate based on conversation context.
    if (exact) {
      const mostActive = [...result.records].sort((a, b) =>
        (b.akoya_countofrequests || 0) - (a.akoya_countofrequests || 0)
      )[0];
      if (mostActive[cfg.idField] !== exact[cfg.idField]) {
        match = mostActive;
        const names = result.records.map(r => {
          const n = r[cfg.nameField] || '';
          const akas = (cfg.altNameFields || []).map(f => r[f]).filter(Boolean);
          const akaStr = akas.length ? ` (aka ${akas.join(', ')})` : '';
          const count = r.akoya_countofrequests || 0;
          return `${n}${akaStr} [${count} requests]`;
        }).filter(Boolean);
        const cleaned = stripEmpty(match);
        cleaned._note = `Ambiguous: "${identifier}" matched multiple accounts. Returning most active. All candidates: ${names.join('; ')}. If the user meant a different one, ask them to clarify.`;
        return cleaned;
      }
    }

    match = exact || result.records[0];

    if (!exact) {
      const names = result.records.map(r => {
        const n = r[cfg.nameField] || '';
        const akas = (cfg.altNameFields || [])
          .map(f => r[f]).filter(Boolean);
        const akaStr = akas.length ? ` (aka ${akas.join(', ')})` : '';
        return n + akaStr;
      }).filter(Boolean);
      const cleaned = stripEmpty(match);
      cleaned._note = `Multiple matches (${result.records.length}). Showing first. All matches: ${names.join('; ')}`;
      return cleaned;
    }
  } else {
    match = result.records[0];
  }

  return stripEmpty(match);
}

// ─── get_related ───

/**
 * Resolve a source entity by name/number to get its GUID.
 * Used by get_related when source_name is provided instead of source_id.
 */
async function resolveEntity(sourceType, sourceName) {
  const result = await getEntity({ type: sourceType, identifier: sourceName });
  // Carry the not-found marker through so get_related logs a zero-result rather
  // than an error when the source simply doesn't exist.
  if (result.error) return { error: result.error, _notFound: result._notFound };

  // Extract the GUID from the result
  const cfg = ENTITY_TYPE_CONFIGS[sourceType];
  const id = result[cfg.idField];
  if (!id) {
    return { error: `Could not resolve ${sourceType} "${sourceName}" to a GUID` };
  }

  return { id, record: result };
}

/**
 * Get request IDs for an account. Shared helper for account→emails/payments/reports.
 * Returns { requestIds, requestLookup, account } or { error }.
 */
async function getAccountRequestIds(accountId) {
  const requestResult = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requestid,akoya_requeststatus',
    filter: `_akoya_applicantid_value eq ${accountId}`,
    orderby: 'createdon desc',
    top: 100,
  });

  if (!requestResult.records.length) {
    return { requestIds: [], requestLookup: {} };
  }

  const requestIds = requestResult.records.map(r => r.akoya_requestid);
  const requestLookup = {};
  for (const r of requestResult.records) {
    requestLookup[r.akoya_requestid] = r.akoya_requestnum;
  }

  return { requestIds, requestLookup, totalRequests: requestResult.totalCount };
}

/**
 * Valid relationship paths and their target types.
 */
const VALID_RELATIONSHIPS = {
  account: ['requests', 'emails', 'payments', 'reports'],
  request: ['payments', 'reports', 'emails', 'annotations', 'reviewers'],
  contact: ['requests'],
  reviewer: ['requests'],
};

/**
 * Follow relationships from a source entity. Handles multi-step lookups server-side.
 */
async function getRelated({ source_type, source_id, source_name, target_type, date_from, date_to }) {
  // Validate relationship
  const validTargets = VALID_RELATIONSHIPS[source_type];
  if (!validTargets) {
    return { error: `Unknown source type: "${source_type}". Valid: ${Object.keys(VALID_RELATIONSHIPS).join(', ')}` };
  }
  if (!validTargets.includes(target_type)) {
    return { error: `Unknown relationship: ${source_type}→${target_type}. Valid targets for ${source_type}: ${validTargets.join(', ')}` };
  }

  // Must have source_id or source_name
  if (!source_id && !source_name) {
    return { error: 'Either source_id (GUID) or source_name (name/number) is required.' };
  }

  // Resolve source_name to GUID if needed
  let resolvedId = source_id;
  let sourceRecord = null;
  if (!resolvedId) {
    const resolved = await resolveEntity(source_type, source_name);
    if (resolved.error) return { error: resolved.error, _notFound: resolved._notFound };
    resolvedId = resolved.id;
    sourceRecord = resolved.record;
  }

  // Build date filter fragment
  const buildDateFilter = (field) => {
    let df = '';
    if (date_from) df += ` and ${field} ge ${date_from}`;
    if (date_to) df += ` and ${field} lt ${date_to}`;
    return df;
  };

  // Dispatch to relationship handler
  const key = `${source_type}→${target_type}`;
  switch (key) {
    // ─── account relationships ───

    case 'account→requests':
      return await handleAccountRequests(resolvedId, sourceRecord, buildDateFilter);

    case 'account→emails':
      return await handleAccountEmails(resolvedId, sourceRecord, buildDateFilter);

    case 'account→payments':
      return await handleAccountPayments(resolvedId, sourceRecord, buildDateFilter);

    case 'account→reports':
      return await handleAccountReports(resolvedId, sourceRecord, buildDateFilter);

    // ─── request relationships ───

    case 'request→payments':
      return await handleRequestPayments(resolvedId, buildDateFilter);

    case 'request→reports':
      return await handleRequestReports(resolvedId, buildDateFilter);

    case 'request→emails':
      return await handleRequestEmails(resolvedId);

    case 'request→annotations':
      return await handleRequestAnnotations(resolvedId, buildDateFilter);

    case 'request→reviewers':
      return await handleRequestReviewers(resolvedId);

    // ─── contact relationships ───

    case 'contact→requests':
      return await handleContactRequests(resolvedId, buildDateFilter);

    // ─── reviewer relationships ───

    case 'reviewer→requests':
      return await handleReviewerRequests(resolvedId, buildDateFilter);

    default:
      return { error: `Unimplemented relationship: ${key}` };
  }
}

// ─── Relationship handlers ───

async function handleAccountRequests(accountId, sourceRecord, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,_akoya_primarycontactid_value,_wmkf_grantprogram_value',
    filter: `_akoya_applicantid_value eq ${accountId}${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const fy = r.akoya_fiscalyear || '';
    const paid = r.akoya_paid_formatted || r.akoya_paid || '';
    const type = r.wmkf_request_type || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    return `Req ${num} | ${status} | ${date} | FY: ${fy} | ${type} | ${program} | Paid: ${paid}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | FY | Type | Program | Paid',
    requests: lines.join('\n') || 'No requests found.',
  };
}

async function handleAccountEmails(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup, totalRequests } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      requestCount: 0,
      emailCount: 0,
      emails: 'No requests found for this account, so no linked emails.',
    };
  }

  const orClauses = requestIds.map(id => `_regardingobjectid_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('createdon');

  const emailResult = await DynamicsService.queryRecords('emails', {
    select: 'subject,sender,torecipients,createdon,directioncode,_regardingobjectid_value',
    filter: `(${orClauses})${dateFilter}`,
    orderby: 'createdon desc',
    top: 100,
  });

  const lines = emailResult.records.map(e => {
    const dir = e.directioncode ? 'Out' : 'In';
    const date = e.createdon_formatted || e.createdon || '';
    const reqNum = requestLookup[e._regardingobjectid_value] || '?';
    const subj = (e.subject || '').substring(0, 80);
    const sender = (e.sender || '').substring(0, 30);
    const to = (e.torecipients || '').substring(0, 40);
    return `[${dir}] ${date} | Req ${reqNum} | ${sender} → ${to} | ${subj}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    requestCount: totalRequests,
    emailCount: emailResult.records.length,
    totalEmailCount: emailResult.totalCount,
    hasMore: emailResult.hasMore,
    emails: lines.join('\n') || 'No emails found.',
  };
}

async function handleAccountPayments(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      paymentCount: 0,
      payments: 'No requests found for this account.',
    };
  }

  const orClauses = requestIds.map(id => `_akoya_requestlookup_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('akoya_paymentdate');

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_folio,_akoya_requestlookup_value',
    filter: `akoya_type eq false and (${orClauses})${dateFilter}`,
    orderby: 'akoya_paymentdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const amt = r.akoya_amount_formatted || r.akoya_amount || '';
    const net = r.akoya_netamount_formatted || r.akoya_netamount || '';
    const date = r.akoya_paymentdate_formatted || r.akoya_paymentdate || '';
    const status = r.akoya_folio || '';
    const reqNum = requestLookup[r._akoya_requestlookup_value] || '?';
    return `${num} | ${date} | ${amt} | Net: ${net} | ${status} | Req ${reqNum}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    paymentCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Payment# | Date | Amount | Net | Status | Request#',
    payments: lines.join('\n') || 'No payments found.',
  };
}

async function handleAccountReports(accountId, sourceRecord, buildDateFilter) {
  const { requestIds, requestLookup } = await getAccountRequestIds(accountId);

  if (!requestIds.length) {
    return {
      account: sourceRecord?.name || accountId,
      reportCount: 0,
      reports: 'No requests found for this account.',
    };
  }

  const orClauses = requestIds.map(id => `_akoya_requestlookup_value eq ${id}`).join(' or ');
  const dateFilter = buildDateFilter('akoya_requirementdue');

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestlookup_value,statecode',
    filter: `akoya_type eq true and (${orClauses})${dateFilter}`,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const reqNum = requestLookup[r._akoya_requestlookup_value] || '?';
    const status = r.statecode_formatted || '';
    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | Req ${reqNum} | ${status}`;
  });

  return {
    account: sourceRecord?.name || accountId,
    reportCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Report# | Due | Type | Request# | Status',
    reports: lines.join('\n') || 'No reports found.',
  };
}

async function handleRequestPayments(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_paymentdate');
  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_amount,akoya_netamount,akoya_paymentdate,akoya_postingdate,akoya_folio,_akoya_requestapplicant_value,statecode',
    filter: `_akoya_requestlookup_value eq ${requestId} and akoya_type eq false${dateFilter}`,
    orderby: 'akoya_paymentdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const amt = r.akoya_amount_formatted || r.akoya_amount || '';
    const net = r.akoya_netamount_formatted || r.akoya_netamount || '';
    const date = r.akoya_paymentdate_formatted || r.akoya_paymentdate || '';
    const status = r.akoya_folio || '';
    return `${num} | ${date} | ${amt} | Net: ${net} | ${status}`;
  });

  return {
    requestId,
    paymentCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Payment# | Date | Amount | Net | Status',
    payments: lines.join('\n') || 'No payments found for this request.',
  };
}

async function handleRequestReports(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_requirementdue');
  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestapplicant_value,statecode',
    filter: `_akoya_requestlookup_value eq ${requestId} and akoya_type eq true${dateFilter}`,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const status = r.statecode_formatted || '';
    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | ${status}`;
  });

  return {
    requestId,
    reportCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Report# | Due | Type | Status',
    reports: lines.join('\n') || 'No reports found for this request.',
  };
}

async function handleRequestEmails(requestId) {
  const emailResult = await DynamicsService.queryRecords('emails', {
    select: 'subject,sender,torecipients,createdon,directioncode,description,activityid',
    filter: `_regardingobjectid_value eq ${requestId}`,
    orderby: 'createdon desc',
    top: 50,
  });

  const lines = emailResult.records.map(e => {
    const dir = e.directioncode ? 'Out' : 'In';
    const date = e.createdon_formatted || e.createdon || '';
    const subj = (e.subject || '').substring(0, 80);
    const sender = (e.sender || '').substring(0, 30);
    const to = (e.torecipients || '').substring(0, 40);
    const rawBody = (e.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const body = rawBody.length > 800 ? rawBody.substring(0, 800) + '...[truncated]' : rawBody;
    const id = e.activityid || '';
    return `[${dir}] ${date} | ${sender} → ${to} | ${subj}\nID: ${id}\n${body || '(no body text)'}`;
  });

  return {
    requestId,
    emailCount: emailResult.records.length,
    totalCount: emailResult.totalCount,
    hasMore: emailResult.hasMore,
    emails: lines.join('\n---\n') || 'No emails found for this request.',
  };
}

async function handleRequestAnnotations(requestId, buildDateFilter) {
  const dateFilter = buildDateFilter('createdon');
  const result = await DynamicsService.queryRecords('annotations', {
    select: 'subject,notetext,filename,mimetype,filesize,isdocument,createdon,annotationid',
    filter: `_objectid_value eq ${requestId}${dateFilter}`,
    orderby: 'createdon desc',
    top: 50,
  });

  const lines = result.records.map(r => {
    const subj = (r.subject || '').substring(0, 80);
    const date = r.createdon_formatted || r.createdon || '';
    const text = (r.notetext || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
    const file = r.filename ? ` | File: ${r.filename} (${r.mimetype}, ${r.filesize} bytes)` : '';
    return `${date} | ${subj}${file}\n  ${text || '(no text)'}`;
  });

  return {
    requestId,
    annotationCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    annotations: lines.join('\n') || 'No notes/attachments found for this request.',
  };
}

async function handleRequestReviewers(requestId) {
  // Get the request record with reviewer lookup fields
  const req = await DynamicsService.getRecord('akoya_requests', requestId, {
    select: '_wmkf_potentialreviewer1_value,_wmkf_potentialreviewer2_value,_wmkf_potentialreviewer3_value,_wmkf_potentialreviewer4_value,_wmkf_potentialreviewer5_value,wmkf_excludedreviewers',
  });

  const processed = DynamicsService.processAnnotations(req);

  // Collect reviewer GUIDs and their _formatted names
  const reviewers = [];
  for (let i = 1; i <= 5; i++) {
    const guid = processed[`_wmkf_potentialreviewer${i}_value`];
    const name = processed[`_wmkf_potentialreviewer${i}_value_formatted`];
    if (guid && !/^0{8}-/.test(guid)) {
      reviewers.push({ slot: i, id: guid, name: name || 'Unknown' });
    }
  }

  // If we have GUIDs, batch lookup full reviewer details
  if (reviewers.length > 0) {
    const orClauses = reviewers.map(r => `wmkf_potentialreviewersid eq ${r.id}`).join(' or ');
    const detailResult = await DynamicsService.queryRecords('wmkf_potentialreviewerses', {
      select: 'wmkf_name,wmkf_title,wmkf_emailaddress,wmkf_organizationname,wmkf_primaryaffiliation,wmkf_areaofexpertise,wmkf_potentialreviewersid',
      filter: orClauses,
      top: 5,
    });

    // Merge details back
    const detailMap = {};
    for (const r of detailResult.records) {
      detailMap[r.wmkf_potentialreviewersid] = r;
    }

    for (const rev of reviewers) {
      const detail = detailMap[rev.id];
      if (detail) {
        rev.title = detail.wmkf_title || '';
        rev.email = detail.wmkf_emailaddress || '';
        rev.organization = detail.wmkf_primaryaffiliation || detail.wmkf_organizationname || '';
        rev.expertise = detail.wmkf_areaofexpertise || '';
      }
    }
  }

  const lines = reviewers.map(r => {
    const parts = [`Slot ${r.slot}: ${r.name}`];
    if (r.title) parts.push(r.title);
    if (r.organization) parts.push(r.organization);
    if (r.email) parts.push(r.email);
    if (r.expertise) parts.push(`Expertise: ${r.expertise.substring(0, 100)}`);
    return parts.join(' | ');
  });

  const excluded = processed.wmkf_excludedreviewers || '';

  return {
    requestId,
    reviewerCount: reviewers.length,
    reviewers: lines.join('\n') || 'No reviewers assigned to this request.',
    excludedReviewers: excluded || null,
  };
}

async function handleContactRequests(contactId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  const contactRoleFields = [
    '_akoya_primarycontactid_value',
    '_wmkf_projectleader_value',
    '_wmkf_researchleader_value',
    '_wmkf_ceo_value',
    '_wmkf_authorizedofficial_value',
    '_wmkf_paymentcontact_value',
    '_wmkf_copi1_value',
    '_wmkf_copi2_value',
    '_wmkf_copi3_value',
    '_wmkf_copi4_value',
    '_wmkf_copi5_value',
  ];
  const roleFilter = contactRoleFields.map(field => `${field} eq ${contactId}`).join(' or ');
  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: `akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,akoya_paid,wmkf_request_type,_akoya_applicantid_value,_wmkf_grantprogram_value,${contactRoleFields.join(',')}`,
    filter: `(${roleFilter})${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const org = r._akoya_applicantid_value_formatted || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    const paid = r.akoya_paid_formatted || r.akoya_paid || '';
    const roles = [];
    if (r._akoya_primarycontactid_value === contactId) roles.push('Primary Contact');
    if (r._wmkf_projectleader_value === contactId) roles.push('PI');
    if (r._wmkf_researchleader_value === contactId) roles.push('VPR');
    if (r._wmkf_ceo_value === contactId) roles.push('CEO');
    if (r._wmkf_authorizedofficial_value === contactId) roles.push('Authorized Official');
    if (r._wmkf_paymentcontact_value === contactId) roles.push('Payment Contact');
    for (let i = 1; i <= 5; i++) {
      if (r[`_wmkf_copi${i}_value`] === contactId) roles.push(`Co-PI ${i}`);
    }
    return `Req ${num} | ${status} | ${date} | ${org} | ${program} | ${roles.join(', ') || 'Contact'} | Paid: ${paid}`;
  });

  return {
    contactId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | Organization | Program | Contact Role | Paid',
    requests: lines.join('\n') || 'No requests found for this contact.',
  };
}

async function handleReviewerRequests(reviewerId, buildDateFilter) {
  const dateFilter = buildDateFilter('akoya_submitdate');
  // OR across all 5 reviewer slots
  const orClauses = [1, 2, 3, 4, 5]
    .map(i => `_wmkf_potentialreviewer${i}_value eq ${reviewerId}`)
    .join(' or ');

  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,akoya_requeststatus,akoya_submitdate,akoya_fiscalyear,_akoya_applicantid_value,_wmkf_grantprogram_value',
    filter: `(${orClauses})${dateFilter}`,
    orderby: 'akoya_submitdate desc',
    top: 100,
  });

  const lines = result.records.map(r => {
    const num = r.akoya_requestnum || '?';
    const status = r.akoya_requeststatus_formatted || r.akoya_requeststatus || '';
    const date = r.akoya_submitdate_formatted || r.akoya_submitdate || '';
    const org = r._akoya_applicantid_value_formatted || '';
    const program = r._wmkf_grantprogram_value_formatted || '';
    return `Req ${num} | ${status} | ${date} | ${org} | ${program}`;
  });

  return {
    reviewerId,
    requestCount: result.records.length,
    totalCount: result.totalCount,
    hasMore: result.totalCount > result.records.length,
    header: 'Request# | Status | Submitted | Organization | Program',
    requests: lines.join('\n') || 'No requests found for this reviewer.',
  };
}

// ─── list_documents ───

const formatDocSize = (bytes) => {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * List SharePoint documents attached to a Dynamics CRM request.
 *
 * Walks every plausible (library, folder) bucket — Dynamics-tracked locations
 * plus the speculative `RequestArchive1/2/3` libraries — and recurses into
 * subfolders so migrated grants whose files live in `Final Report/`, `Year 1/`,
 * etc. are still surfaced. Each returned file carries its own library, folder
 * path, and (relative) subfolder so download URLs route correctly.
 */
async function listDocuments({ request_number, request_id }) {
  if (!request_number && !request_id) {
    return { error: 'Either request_number or request_id is required.' };
  }

  // Step 1: Resolve request number to GUID if needed
  let requestId = request_id;
  let requestNum = request_number;
  if (!requestId) {
    const result = await getEntity({ type: 'request', identifier: request_number });
    // Carry _notFound so an unresolvable request logs a zero-result rather
    // than an errored call (see deriveRecordCount).
    if (result.error) return { error: result.error, _notFound: result._notFound };
    requestId = result.akoya_requestid;
    requestNum = result.akoya_requestnum || request_number;
    if (!requestId) {
      return { error: `Could not resolve request "${request_number}" to a GUID.` };
    }
  }

  // Step 2: Discover every plausible bucket (Dynamics-tracked + archive probes)
  const buckets = await getRequestSharePointBuckets(requestId, requestNum);

  // Step 3: List each bucket in parallel, tolerating 404s / permission errors
  const bucketResults = await Promise.all(
    buckets.map(async b => {
      try {
        const files = await GraphService.listFiles(b.library, b.folder, { recursive: true });
        return { ...b, files, error: null };
      } catch (err) {
        return { ...b, files: [], error: err.message };
      }
    }),
  );

  // Step 4: Flatten + de-dupe by (library, full folder path, filename)
  const seen = new Set();
  const allFiles = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const fileFolder = f.folder || bucket.folder;
      const k = `${bucket.library}::${fileFolder}::${f.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const subfolder = fileFolder.startsWith(bucket.folder + '/')
        ? fileFolder.slice(bucket.folder.length + 1)
        : '';
      allFiles.push({
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        lastModified: f.lastModified,
        library: bucket.library,
        folder: fileFolder,
        subfolder,
      });
    }
  }

  // Per-bucket summary so Claude can describe the layout to the user.
  // Hide empty archive probes that returned no files and no error — they're
  // expected misses for non-migrated grants and would just be noise.
  const libraries = bucketResults
    .filter(b => b.files.length > 0 || (b.error && b.source !== 'archive'))
    .map(b => ({
      library: b.library,
      folder: b.folder,
      count: b.files.length,
      error: b.error,
    }));

  if (allFiles.length === 0) {
    return {
      requestNumber: requestNum,
      documentCount: 0,
      libraries,
      documents: 'No files found in any document library for this request.',
    };
  }

  const lines = allFiles.map(f => {
    const date = f.lastModified ? new Date(f.lastModified).toLocaleDateString() : '';
    const where = f.subfolder ? `${f.library}/${f.subfolder}` : f.library;
    return `${f.name} | ${formatDocSize(f.size)} | ${date} | ${f.mimeType || ''} | ${where}`;
  });

  return {
    requestNumber: requestNum,
    documentCount: allFiles.length,
    libraries,
    header: 'Filename | Size | Modified | Type | Location',
    documents: lines.join('\n'),
    // Structured file data for frontend download links (not sent to Claude).
    // Each file carries its own library/folder so downloads route correctly
    // even when files come from multiple libraries or nested subfolders.
    _files: allFiles.map(f => ({
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      lastModified: f.lastModified,
      library: f.library,
      folder: f.folder,
      subfolder: f.subfolder,
      // requestId bound into the URL so the server can verify the folder's
      // GUID suffix before streaming the file. See download-document.js.
      downloadUrl: `/api/dynamics-explorer/download-document?requestId=${encodeURIComponent(requestId)}&library=${encodeURIComponent(f.library)}&folder=${encodeURIComponent(f.folder)}&filename=${encodeURIComponent(f.name)}`,
    })),
  };
}

// ─── search_documents ───

/**
 * Search within SharePoint document contents for keywords or phrases.
 * Optionally scoped to a specific library or request folder.
 */
async function searchDocuments({ query, library, request_number }) {
  if (!query) {
    return { error: 'A search query is required.' };
  }

  // ── Resolve the search scope ─────────────────────────────────────────────
  // When a request_number is supplied, we can't trust a single (library,
  // folder) pair — older grants migrated from the previous grants management
  // system have files in `RequestArchive1/2/3` libraries on top of (or instead
  // of) the active `akoya_request` library. We discover every plausible bucket
  // up front and run the KQL search once per bucket in parallel, then merge
  // results. This fans out 4× per request-scoped search but is bounded and
  // parallel, and request-scoped searches are rare relative to broad ones.
  // The simpler alternative — one unscoped search post-filtered by webUrl —
  // loses too much KQL precision when scoring across the whole site.
  let scopes = []; // Array<{ libraryName: string|null, folderPath: string|null, label: string }>
  let scopeLabel;
  let requestId = null; // Hoisted so download-URL construction can use it when a request scope was supplied.

  if (request_number) {
    const reqResult = await getEntity({ type: 'request', identifier: request_number });
    // Same as listDocuments — a not-found source is a zero-result, not an error.
    if (reqResult.error) return { error: reqResult.error, _notFound: reqResult._notFound };
    requestId = reqResult.akoya_requestid;
    const requestNum = reqResult.akoya_requestnum || request_number;
    if (!requestId) {
      return { error: `Could not resolve request "${request_number}" to a GUID.` };
    }

    const buckets = await getRequestSharePointBuckets(requestId, requestNum);
    scopes = buckets.map(b => ({
      libraryName: b.library,
      folderPath: b.folder,
      label: `${b.library}/${b.folder}`,
    }));
    scopeLabel = `request ${requestNum} (${buckets.length} folder${buckets.length !== 1 ? 's' : ''})`;
  } else {
    scopes = [{ libraryName: library || null, folderPath: null, label: library || 'all libraries' }];
    scopeLabel = library || 'all libraries';
  }

  try {
    // Run all scopes in parallel; tolerate per-scope failures (archive probes
    // 404 for non-migrated grants, which is expected).
    const scopeResults = await Promise.all(
      scopes.map(async s => {
        try {
          const found = await GraphService.searchFiles(query, {
            libraryName: s.libraryName,
            folderPath: s.folderPath,
          });
          return { ...s, found, error: null };
        } catch (err) {
          return { ...s, found: [], error: err.message };
        }
      }),
    );

    // De-dupe by file id / webUrl / (library + folder + name)
    const seen = new Set();
    const merged = [];
    for (const sr of scopeResults) {
      for (const f of sr.found) {
        const k = f.id || f.webUrl || `${f.library}::${f.folder}::${f.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(f);
      }
    }

    if (!merged.length) {
      return {
        searchCount: 0,
        query,
        scope: scopeLabel,
        message: 'No documents found matching the search query.',
      };
    }

    // Build text summary for Claude
    const lines = merged.map(f => {
      const size = formatDocSize(f.size);
      const date = f.lastModified ? new Date(f.lastModified).toLocaleDateString() : '';
      const where = f.library && f.folder ? `${f.library}/${f.folder}` : (f.library || '');
      const snippet = f.summary ? `\n  Snippet: ${f.summary}` : '';
      return `${f.name} | ${size} | ${date} | ${where}${snippet}`;
    });

    return {
      searchCount: merged.length,
      query,
      scope: scopeLabel,
      header: 'Filename | Size | Modified | Location',
      documents: lines.join('\n'),
      // Structured file data for frontend download links (not sent to Claude)
      // Each file needs a requestId for the download URL. When a request_number
      // was supplied up front we use it for every file; otherwise we recover
      // the GUID from the folder name's `{num}_{GUID32}` suffix. Files whose
      // folder doesn't match the request-folder convention (e.g. templates in
      // a non-request folder) get no downloadUrl — they're not downloadable
      // through this proxy by design.
      _files: merged
        .filter(f => f.folder && f.library)
        .map(f => {
          const topLevel = String(f.folder).split('/')[0];
          const m = /^\d+_([0-9A-F]{32})$/.exec(topLevel);
          const fileGuid = m
            ? `${m[1].slice(0, 8)}-${m[1].slice(8, 12)}-${m[1].slice(12, 16)}-${m[1].slice(16, 20)}-${m[1].slice(20, 32)}`.toLowerCase()
            : null;
          const effectiveRequestId = requestId || fileGuid;
          const downloadUrl = effectiveRequestId
            ? `/api/dynamics-explorer/download-document?requestId=${encodeURIComponent(effectiveRequestId)}&library=${encodeURIComponent(f.library)}&folder=${encodeURIComponent(f.folder)}&filename=${encodeURIComponent(f.name)}`
            : null;
          return {
            name: f.name,
            size: f.size,
            mimeType: f.mimeType || null,
            lastModified: f.lastModified,
            library: f.library,
            folder: f.folder,
            downloadUrl,
          };
        }),
    };
  } catch (err) {
    return {
      searchCount: 0,
      error: `SharePoint search failed: ${err.message}`,
    };
  }
}

// ─── Export to Excel ───

const MAX_XLSX_BYTES = 3 * 1024 * 1024; // 3MB buffer limit (~4MB base64)

/**
 * Export query results as a downloadable Excel file.
 * Three-way branch:
 * 1. No process_instruction → existing behavior (straight export)
 * 2. process_instruction without confirmed → estimate mode
 * 3. process_instruction with confirmed: true → full AI batch processing + export
 */
async function exportCsv({ table_name, select, filter, orderby, filename, process_instruction, confirmed, include_inactive }, sendEvent, userProfileId, restrictions = []) {
  const cleanSelect = sanitizeSelect(select);
  const effectiveFilter = applyActiveOnlyFilter(filter, include_inactive);
  const validation = await validateEffectiveODataCall('export_csv', {
    table_name,
    select: cleanSelect,
    filter: effectiveFilter,
    orderby,
  }, restrictions);
  if (validation.reject) return validatorReject(validation.reject);
  const entitySet = await DynamicsService.resolveEntitySetName(table_name);

  // ─── Branch 1: No AI processing — straight export (unchanged) ───
  if (!process_instruction) {
    const result = await DynamicsService.queryAllRecords(entitySet, {
      select: cleanSelect,
      filter: effectiveFilter,
      orderby,
    });

    if (!result.records.length) {
      return { exportedCount: 0, message: 'No records matched the filter. No file generated.' };
    }

    const records = result.records.map(stripEmpty);
    return await generateExcelExport(records, cleanSelect, table_name, filename, result.totalCount, result.capped, sendEvent);
  }

  // ─── Branch 2: Estimate mode — count records, sample AI processing ───
  if (!confirmed) {
    // Fetch 3 sample records — also gives us totalCount without the /$count endpoint
    // (/$count fails with Edm.Int32 error on complex filters)
    const sampleResult = await DynamicsService.queryRecords(entitySet, {
      select: cleanSelect,
      filter: effectiveFilter,
      top: 3,
    });

    if (!sampleResult.records.length) {
      return { estimatedCount: 0, message: 'No records matched the filter.' };
    }

    const count = sampleResult.totalCount || sampleResult.records.length;

    // Run AI on first sample to determine columns and preview output
    const sampleRecord = serializeDynamicsExplorerRecordForModel(stripEmpty(sampleResult.records[0]));
    const { sampleOutput, usage } = await runSampleProcessing(sampleRecord, process_instruction, userProfileId);

    // Extrapolate cost: (tokens per record) × total records ÷ batch size
    const recordsPerBatch = 15;
    const totalBatches = Math.ceil(Math.min(count, 5000) / recordsPerBatch);
    // Estimate per-batch tokens as sample tokens × batch size (with some overhead)
    const estInputPerBatch = (usage.input_tokens || 500) * recordsPerBatch * 0.8; // records share system prompt
    const estOutputPerBatch = (usage.output_tokens || 100) * recordsPerBatch;
    const totalInputTokens = estInputPerBatch * totalBatches;
    const totalOutputTokens = estOutputPerBatch * totalBatches;

    const model = getModelForApp('dynamics-explorer');
    const costCents = estimateCostCents(model, totalInputTokens, totalOutputTokens) || 0;
    const estimatedTimeSeconds = Math.ceil(totalBatches / 3) * 2; // 3 concurrent, ~2s each

    return {
      estimatedCount: Math.min(count, 5000),
      totalMatched: count,
      capped: count > 5000,
      sampleOutput,
      aiColumns: Object.keys(sampleOutput),
      estimatedCostCents: Math.round(costCents * 100) / 100,
      estimatedTimeSeconds,
      message: `Found ${count} records${count > 5000 ? ' (will export first 5000)' : ''}. Sample AI output shown. Estimated cost: ~$${(costCents / 100).toFixed(2)}, time: ~${estimatedTimeSeconds}s. Ask the user to confirm before proceeding.`,
    };
  }

  // ─── Branch 3: Confirmed — full AI batch processing + export ───
  const result = await DynamicsService.queryAllRecords(entitySet, {
    select: cleanSelect,
    filter: effectiveFilter,
    orderby,
  });

  if (!result.records.length) {
    return { exportedCount: 0, message: 'No records matched the filter. No file generated.' };
  }

  let records = result.records.map(stripEmpty);

  // Run AI batch processing
  const { processedRecords, failedCount } = await processRecordsBatch(
    records, process_instruction, sendEvent, userProfileId
  );

  // Build combined select string including AI columns
  const aiColumns = Object.keys(processedRecords[0] || {}).filter(k => k.startsWith('ai_'));
  const combinedSelect = cleanSelect
    ? cleanSelect + ',' + aiColumns.join(',')
    : null;

  return await generateExcelExport(
    processedRecords, combinedSelect, table_name, filename,
    result.totalCount, result.capped, sendEvent, failedCount
  );
}

/**
 * Generate Excel file and send via SSE. Shared by plain and AI-processed exports.
 */
async function generateExcelExport(records, selectStr, tableName, filename, totalCount, capped, sendEvent, failedCount) {
  let xlsxBuf = await recordsToExcel(records, selectStr, tableName);

  // Safety: if xlsx exceeds size limit, trim records
  if (xlsxBuf.length > MAX_XLSX_BYTES) {
    const ratio = MAX_XLSX_BYTES / xlsxBuf.length;
    const trimCount = Math.floor(records.length * ratio * 0.9);
    records.length = trimCount;
    xlsxBuf = await recordsToExcel(records, selectStr, tableName);
    capped = true;
  }

  const base64 = Buffer.from(xlsxBuf).toString('base64');
  const columns = selectStr ? selectStr.split(',').map(f => f.trim()) : Object.keys(records[0] || {});
  const exportFilename = (filename || `${tableName}-export`).replace(/[^a-zA-Z0-9_-]/g, '_') + '.xlsx';

  sendEvent('file_ready', {
    base64,
    filename: exportFilename,
    recordCount: records.length,
    totalCount,
    capped,
    columns,
  });

  const result = {
    exportedCount: records.length,
    totalCount,
    capped,
    columnCount: columns.length,
    filename: exportFilename,
    message: `Excel file exported: ${records.length} records, ${columns.length} columns.${capped ? ` Capped at limit (${totalCount} total matched).` : ''}`,
  };

  if (failedCount > 0) {
    result.failedCount = failedCount;
    result.message += ` ${failedCount} records failed AI processing (columns left blank).`;
  }

  return result;
}

// ─── AI Batch Processing ───

/**
 * Non-streaming Claude API call for batch processing.
 * No tools, no text streaming — just returns raw text and usage.
 */
async function callClaudeBatch({ systemPrompt, userMessage, userProfileId }) {
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

/**
 * Run AI instruction on 1 sample record to determine output column names and preview.
 * Returns { sampleOutput: { col1: val1, ... }, usage }.
 */
async function runSampleProcessing(record, processInstruction, userProfileId) {
  // A7 Part 3: the CRM record is untrusted data — wrap it so injection text
  // in a record field cannot override the extraction instruction.
  const recordWrapped = wrapUntrustedContent({
    text: JSON.stringify(record, null, 2),
    source: 'dynamics-explorer.export.sample-record',
    dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
    maxChars: DYNEXP_EXPORT_MAX_CHARS,
    label: 'CRM record',
  });

  const systemPrompt = `${buildUntrustedContentPreamble([recordWrapped.nonce])}

You are a data processing assistant. The user will give you a record from a CRM database and an instruction for what to extract or analyze.

Return ONLY a JSON object with your results. Choose descriptive snake_case column names based on the instruction (e.g., "keywords", "research_area", "summary"). Keep values concise — suitable for spreadsheet cells.

Example output: {"keywords": "fungi, enzyme catalysis, bioremediation", "research_area": "Environmental Biology"}`;

  const userMessage = `Instruction: ${processInstruction}

Record (untrusted data):
${recordWrapped.text}`;

  const { text, usage } = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });

  // Parse the JSON response
  let sampleOutput;
  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    sampleOutput = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    sampleOutput = { result: text.substring(0, 200) };
  }

  return { sampleOutput, usage };
}

/**
 * Process all records through Claude in batches.
 * Batches records (15 per call, 3 concurrent), sends progress via SSE.
 * Returns { processedRecords, failedCount }.
 */
async function processRecordsBatch(records, processInstruction, sendEvent, userProfileId) {
  const BATCH_SIZE = 15;
  const CONCURRENCY = 3;

  // First, run sample to get column schema
  const { sampleOutput } = await runSampleProcessing(
    serializeDynamicsExplorerRecordForModel(records[0]),
    processInstruction,
    userProfileId,
  );
  const columnNames = Object.keys(sampleOutput);

  // A7 Part 3: a fresh nonce is generated per batch (below), so the system
  // prompt carries the general untrusted-content rule, not a nonce list.
  const systemPrompt = `${buildUntrustedContentPreamble()}

You are a data processing assistant. Process each record according to the instruction and return a JSON array of objects.

Each object in the array must have exactly these columns: ${JSON.stringify(columnNames)}
Return one object per input record, in the same order. Keep values concise — suitable for spreadsheet cells.
If a record lacks the needed data, use empty strings for the values.

Return ONLY the JSON array, no other text.`;

  // Split records into batches
  const batches = [];
  // Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push({ records: records.slice(i, i + BATCH_SIZE), startIndex: i });
  }

  let processed = 0;
  let failedCount = 0;

  // Initialize AI columns on all records with empty strings
  for (const record of records) {
    for (const col of columnNames) {
      record[`ai_${col}`] = '';
    }
  }

  // Process batches with concurrency limit
  // Mechanically swappable, but left hand-rolled for cohesion with the index-bearing sibling loop above (startIndex merge). See docs/CHUNK_CONSOLIDATION_PLAN.md C1.
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const chunk = batches.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      chunk.map(async (batch) => {
        const batchRecords = batch.records.map((r, idx) => ({
          index: idx + 1,
          ...serializeDynamicsExplorerRecordForModel(r),
        }));
        const recordsWrapped = wrapUntrustedContent({
          text: JSON.stringify(batchRecords, null, 1),
          source: 'dynamics-explorer.export.batch',
          dataClass: DATA_CLASSES.CRM_RECORD_TEXT,
          maxChars: DYNEXP_EXPORT_MAX_CHARS,
          label: 'CRM records',
        });
        const userMessage = `Instruction: ${processInstruction}

Records (${batchRecords.length}) — untrusted data:
${recordsWrapped.text}`;

        let result;
        try {
          result = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });
        } catch (err) {
          // Retry once
          console.log(`[DynExp Export] Batch retry after error: ${err.message.substring(0, 100)}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          result = await callClaudeBatch({ systemPrompt, userMessage, userProfileId });
        }

        // Parse the JSON array response
        const jsonMatch = result.text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array in response');
        const parsed = JSON.parse(jsonMatch[0]);

        // Merge AI results back into records
        for (let j = 0; j < batch.records.length && j < parsed.length; j++) {
          const aiResult = parsed[j];
          for (const col of columnNames) {
            records[batch.startIndex + j][`ai_${col}`] = aiResult[col] ?? '';
          }
        }

        return batch.records.length;
      })
    );

    // Count successes and failures
    for (const r of results) {
      if (r.status === 'fulfilled') {
        processed += r.value;
      } else {
        const chunkIdx = results.indexOf(r);
        const failedBatch = chunk[chunkIdx];
        failedCount += failedBatch?.records.length || 0;
        processed += failedBatch?.records.length || 0;
        console.log(`[DynExp Export] Batch failed: ${r.reason?.message?.substring(0, 100)}`);
      }
    }

    sendEvent('export_progress', { processed, total: records.length, failed: failedCount });
  }

  return { processedRecords: records, failedCount };
}

/**
 * Convert records to an xlsx buffer using ExcelJS.
 * Prefers _formatted values for human-readable output.
 */
async function recordsToExcel(records, selectStr, sheetName) {
  // Determine columns from $select
  const selectFields = selectStr
    ? selectStr.split(',').map(f => f.trim())
    : Object.keys(records[0] || {});

  // Build headers
  const headers = selectFields.map(f => cleanColumnName(f));

  // Build rows, preferring _formatted values
  const dataRows = records.map(r => {
    return selectFields.map(field => {
      const formatted = r[`${field}_formatted`];
      return formatted !== undefined ? formatted : (r[field] ?? '');
    });
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((sheetName || 'Export').substring(0, 31));

  // Add header row
  ws.addRow(headers);

  // Add data rows
  for (const row of dataRows) {
    ws.addRow(row);
  }

  // Auto-size columns based on content
  ws.columns.forEach((col, i) => {
    let maxLen = headers[i].length;
    for (const row of dataRows.slice(0, 100)) {
      const val = String(row[i] || '');
      if (val.length > maxLen) maxLen = val.length;
    }
    col.width = Math.min(maxLen + 2, 50);
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Clean column names: strip akoya_/wmkf_ prefixes, _value suffix,
 * and convert to Title Case. AI columns (ai_*) get "AI: " prefix.
 */
function cleanColumnName(field) {
  // AI-generated columns get "AI: " prefix
  if (field.startsWith('ai_')) {
    const aiName = field.slice(3)
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return `AI: ${aiName}`;
  }

  let name = field
    .replace(/^_/, '')
    .replace(/_value$/, '')
    .replace(/^akoya_/, '')
    .replace(/^wmkf_/, '');
  // Convert snake_case to Title Case
  return name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ─── Existing composite tools (kept) ───

/**
 * Find all reporting requirements due in a date range.
 * Single Dynamics query with _formatted annotations for org/request names.
 */
async function findReportsDue({ date_from, date_to, include_inactive }) {
  const base = `akoya_type eq true and akoya_requirementdue ge ${date_from} and akoya_requirementdue lt ${date_to}`;
  const filter = applyActiveOnlyFilter(base, include_inactive);

  const result = await DynamicsService.queryRecords('akoya_requestpayments', {
    select: 'akoya_paymentnum,akoya_requirementdue,akoya_requirementtype,wmkf_reporttype,_akoya_requestlookup_value,_akoya_requestapplicant_value,statecode',
    filter,
    orderby: 'akoya_requirementdue asc',
    top: 100,
  });

  if (!result.records.length) {
    return { reportCount: 0, totalCount: result.totalCount, message: 'No reports due in this date range.' };
  }

  // Group by due date for summary
  const byDate = {};
  const lines = result.records.map(r => {
    const num = r.akoya_paymentnum || '?';
    const due = r.akoya_requirementdue_formatted || r.akoya_requirementdue || '?';
    const type = r.akoya_requirementtype_formatted || '?';
    const detail = r.wmkf_reporttype_formatted || '';
    const reqNum = r._akoya_requestlookup_value_formatted || r._akoya_requestlookup_value || '?';
    const org = r._akoya_requestapplicant_value_formatted || '?';
    const status = r.statecode_formatted || '';

    // Track date grouping
    byDate[due] = (byDate[due] || 0) + 1;

    return `${num} | ${due} | ${type}${detail ? ' - ' + detail : ''} | Req ${reqNum} | ${org} | ${status}`;
  });

  const summary = Object.entries(byDate)
    .map(([date, count]) => `${date}: ${count}`)
    .join(', ');

  return {
    totalCount: result.totalCount,
    reportCount: result.records.length,
    hasMore: result.totalCount > result.records.length,
    byDate: summary,
    header: 'Report# | Due | Type | Request# | Organization | Status',
    reports: lines.join('\n'),
  };
}

/**
 * Full-text search across all indexed Dynamics tables.
 */
async function searchRecords({ search, entities, top }) {
  const requestedEntities = Array.isArray(entities)
    ? entities.filter(entity => !isOperationalLogTable(entity))
    : entities;
  if (Array.isArray(entities) && requestedEntities.length === 0) {
    return {
      totalCount: 0,
      query: search,
      message: 'No results found. Operational AI audit logs are not exposed in Dynamics Explorer.',
    };
  }

  const result = await DynamicsService.searchRecords(search, {
    entities: requestedEntities,
    top: top || 20,
  });
  const visibleResults = result.results.filter(r => !isOperationalLogTable(r.entity));
  const hiddenResultCount = result.results.length - visibleResults.length;

  if (!visibleResults.length) {
    return {
      totalCount: 0,
      query: result.queryContext?.alteredquery || search,
      message: 'No results found.',
    };
  }

  // Group results by entity for readable output
  const byEntity = {};
  for (const r of visibleResults) {
    if (!byEntity[r.entity]) byEntity[r.entity] = [];
    byEntity[r.entity].push(r);
  }

  const sections = [];
  for (const [entity, results] of Object.entries(byEntity)) {
    const lines = results.map(r => {
      const a = r.attributes;

      // Build a one-line identifier based on entity type
      let label;
      if (entity === 'akoya_request') {
        label = `Req ${a.akoya_requestnum || '?'} | ${a.akoya_applicantidname || '?'} | ${(a.akoya_title || '').substring(0, 80)}`;
      } else if (entity === 'contact') {
        label = `${a.fullname || '?'} | ${a.jobtitle || ''} | ${a.emailaddress1 || ''}`;
      } else if (entity === 'account') {
        label = `${a.name || '?'} | ${a.address1_city || ''}, ${a.address1_stateorprovince || ''}`;
      } else if (entity === 'annotation') {
        const noteField = a.subject ? 'subject' : 'notetext';
        const notePreview = serializeDynamicsExplorerFieldValueForModel(noteField, a.subject || a.notetext || '', { maxStringChars: 80 });
        label = `Note: ${String(notePreview).substring(0, 80)}`;
      } else if (entity === 'email') {
        const subjectPreview = serializeDynamicsExplorerFieldValueForModel('subject', a.subject || '', { maxStringChars: 80 });
        label = `Email: ${String(subjectPreview).substring(0, 80)} | ${a.createdon || ''}`;
      } else {
        label = `${a.wmkf_name || a.akoya_title || r.objectId}`;
      }

      // Format highlights — strip {crmhit} tags and show matched text
      const hlParts = [];
      for (const [field, values] of Object.entries(r.highlights)) {
        const cleanValues = (Array.isArray(values) ? values : [values])
          .map(v => {
            const clean = v.replace(/\{crmhit\}/g, '**').replace(/\{\/crmhit\}/g, '**');
            return serializeDynamicsExplorerFieldValueForModel(field, clean, { maxStringChars: 200 });
          });
        hlParts.push(`${field}: ${String(cleanValues[0]).substring(0, 200)}`);
      }

      return `${label}\n  ID: ${r.objectId}\n  ${hlParts.join('\n  ')}`;
    });

    sections.push(`[${entity}] (${results.length} results)\n${lines.join('\n')}`);
  }

  return {
    totalCount: hiddenResultCount > 0 ? visibleResults.length : result.totalCount,
    query: result.queryContext?.alteredquery || search,
    nextStepHint: (!requestedEntities?.length || requestedEntities.includes('akoya_request'))
      ? 'If the user asked for files/documents and a listed request looks plausible, call list_documents with that request number now instead of running more broad searches.'
      : undefined,
    results: sections.join('\n\n'),
  };
}

// ─── Helpers ───

function checkRestriction(toolName, input, restrictions) {
  if (!restrictions.length || !input.table_name) return null;
  for (const r of restrictions) {
    if (r.table_name === input.table_name) {
      if (!r.field_name) return `Table "${r.table_name}" is restricted`;
      if (input.select) {
        const fields = input.select.split(',').map(f => f.trim());
        if (fields.includes(r.field_name)) return `Field "${r.field_name}" is restricted`;
      }
      if (input.field) {
        const aggFields = [input.field];
        if (input.group_by) aggFields.push(input.group_by);
        for (const f of aggFields) {
          if (f === r.field_name) return `Field "${r.field_name}" is restricted`;
        }
      }
    }

    // Check $expand for restricted tables/fields via navigation properties
    if (input.expand) {
      const segments = splitChatExpandSegments(input.expand);
      for (const seg of segments) {
        const parenIdx = seg.indexOf('(');
        const navProperty = parenIdx === -1 ? seg.trim() : seg.substring(0, parenIdx).trim();
        // Table-level block: navigation property references restricted table
        if (!r.field_name && navProperty.toLowerCase().includes(r.table_name.toLowerCase())) {
          return `Table "${r.table_name}" is restricted (referenced via $expand "${navProperty}")`;
        }
        // Field-level block: nested $select contains restricted field
        if (r.field_name && r.table_name === input.table_name && parenIdx !== -1) {
          const options = seg.substring(parenIdx + 1, seg.lastIndexOf(')'));
          const selectMatch = options.match(/\$select\s*=\s*([^;)]+)/);
          if (selectMatch) {
            const nestedFields = selectMatch[1].split(',').map(f => f.trim());
            if (nestedFields.includes(r.field_name)) {
              return `Field "${r.field_name}" is restricted (referenced via $expand nested $select)`;
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Split $expand into segments, respecting parentheses depth.
 */
function splitChatExpandSegments(expand) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const ch of expand) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      segments.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function getThinkingMessage(toolName, input) {
  switch (toolName) {
    case 'search': return `Searching for "${input.search}"...`;
    case 'get_entity': return `Looking up ${input.type}: "${input.identifier}"...`;
    case 'get_related': return `Finding ${input.target_type} for ${input.source_type} ${input.source_name || input.source_id || ''}...`;
    case 'describe_table': return input.table_name ? `Describing ${input.table_name}...` : 'Listing available tables...';
    case 'query_records': return `Querying ${input.table_name}...`;
    case 'count_records': return `Counting ${input.table_name}...`;
    case 'aggregate': return `Calculating ${input.operation} of ${input.field}...`;
    case 'find_reports_due': return `Finding reports due ${input.date_from ? 'from ' + input.date_from.substring(0, 10) : ''}...`;
    case 'list_documents': return `Listing documents for request ${input.request_number || input.request_id || ''}...`;
    case 'search_documents': return `Searching documents for "${input.query}"...`;
    case 'export_csv':
      if (input.process_instruction && input.confirmed) return `Processing and exporting ${input.table_name || 'data'} with AI analysis...`;
      if (input.process_instruction) return `Estimating AI processing for ${input.table_name || 'data'} export...`;
      return `Exporting ${input.table_name || 'data'} as Excel...`;
    default: return `Running ${toolName}...`;
  }
}

// ─── Database helpers ───

async function getUserRole(userProfileId) {
  if (!userProfileId) return 'read_only';
  try {
    const result = await sql`SELECT role FROM dynamics_user_roles WHERE user_profile_id = ${userProfileId}`;
    return result.rows[0]?.role || 'read_only';
  } catch { return 'read_only'; }
}

async function getActiveRestrictions() {
  const result = await sql`SELECT table_name, field_name, restriction_type, reason FROM dynamics_restrictions ORDER BY table_name`;
  return result.rows;
}

function logQuery({ requestId, requestRound, userProfileId, sessionId, queryType, tableName, queryParams, recordCount, executionTime, wasDenied = false, denialReason = null }) {
  const correlatedWrite = sql`INSERT INTO dynamics_query_log (user_profile_id, session_id, query_type, table_name, query_params, record_count, execution_time_ms, was_denied, denial_reason, request_id, request_round)
    VALUES (${userProfileId || null}, ${sessionId || null}, ${queryType}, ${tableName}, ${JSON.stringify(queryParams)}, ${recordCount}, ${executionTime}, ${wasDenied}, ${denialReason}, ${requestId || null}, ${Number.isInteger(requestRound) ? requestRound : null})`;
  correlatedWrite.catch(err => {
    if (err?.code !== '42703') {
      console.warn('Failed to log dynamics query:', err.message);
      return;
    }
    sql`INSERT INTO dynamics_query_log (user_profile_id, session_id, query_type, table_name, query_params, record_count, execution_time_ms, was_denied, denial_reason)
      VALUES (${userProfileId || null}, ${sessionId || null}, ${queryType}, ${tableName}, ${JSON.stringify(queryParams)}, ${recordCount}, ${executionTime}, ${wasDenied}, ${denialReason})`
      .catch(fallbackError => console.warn('Failed to log dynamics query:', fallbackError.message));
  });
}
