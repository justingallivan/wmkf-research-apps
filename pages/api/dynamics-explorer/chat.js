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
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { withDynamicsContext } from '../../../lib/services/dynamics-context';
import { buildSystemPrompt, TOOL_DEFINITIONS } from '../../../shared/config/prompts/dynamics-explorer';
import {
  DATA_CLASSES,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../../lib/utils/ai-payload-boundary';
import { getModelForApp, getFallbackModelForApp } from '../../../shared/config/baseConfig';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import {
  serializeDynamicsExplorerToolResult,
} from '../../../lib/utils/dynamics-explorer-serializer';
import { buildResolvedTaxonomyPromptBlock } from '../../../lib/services/dynamics-explorer-taxonomy';
import {
  DynamicsExplorerRequestTelemetry,
  normalizeSessionId,
} from '../../../lib/services/dynamics-explorer-request-telemetry';
import { describeChatFailure, detectPossibleFailure } from '../../../lib/services/dynamics-explorer/failure-copy';
import { trimConversation, compactMessages } from '../../../lib/services/dynamics-explorer/conversation';
import { MAX_RESULT_CHARS, TOOL_CHAR_LIMITS, sanitizeSelect, applyActiveOnlyFilter, stripEmpty, truncateResult, deriveRecordCount, getThinkingMessage } from '../../../lib/services/dynamics-explorer/result-shaping';
import { checkRestriction } from '../../../lib/services/dynamics-explorer/restriction-guard';
import { getUserRole, getActiveRestrictions, logQuery } from '../../../lib/services/dynamics-explorer/explorer-store';
import { callClaude } from '../../../lib/services/dynamics-explorer/model-call';
import { findReportsDue, searchRecords } from '../../../lib/services/dynamics-explorer/tools/composite';
import { describeTable } from '../../../lib/services/dynamics-explorer/tools/describe-table';
import { getEntity } from '../../../lib/services/dynamics-explorer/tools/get-entity';
import { getRelated } from '../../../lib/services/dynamics-explorer/tools/get-related';
import { listDocuments, searchDocuments } from '../../../lib/services/dynamics-explorer/tools/documents';
import { validateEffectiveODataCall, validatorReject, classifyToolError } from '../../../lib/services/dynamics-explorer/tool-errors';
import { exportCsv } from '../../../lib/services/dynamics-explorer/tools/export';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};

const limiter = nextRateLimiter({ max: 10 });

const MAX_TOOL_ROUNDS = 15;

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
    // Per-request tool context. `searchThrottle` is a server-side circuit
    // breaker: once a document search hits a transient Graph failure
    // (tenant throttle / 5xx / no response), every later search_documents call
    // in THIS request short-circuits without touching Graph. Tool-result text
    // is untrusted content to the model by design (A7), so it cannot be the
    // control that stops a retry loop — this is (Codex adversarial S468).
    const toolContext = { searchThrottle: null };
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
          result = await executeTool(name, input, sendEvent, userProfileId, restrictions, toolContext);
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

async function executeTool(name, input, sendEvent, userProfileId, restrictions = [], toolContext = {}) {
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
      const searchResult = await searchDocuments(input, toolContext);
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

