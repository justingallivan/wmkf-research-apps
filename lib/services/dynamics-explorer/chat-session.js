/**
 * Dynamics Explorer chat session: the agentic tool-use loop that runs inside
 * the route's `withDynamicsContext` callback. Builds the system prompt,
 * drives round-by-round Claude calls and tool execution, and resolves a
 * terminal `{ outcome, rounds }` (or `{ outcome: 'client_disconnected' }`)
 * for the route to finalize telemetry against.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:68, 192-392
 * (pre-S2 line numbers); characterization tests are the safety net. The
 * route's direct lifecycle-variable writes (`lastModel`, `completedRounds`,
 * `lastStopReason`, `errorStage`, `terminalIntent`, `finalizeLifecycle`) are
 * replaced here by the `onRoundComplete`/`onStage`/`onTerminal` callbacks and
 * the `isDisconnected()` poll, per
 * docs/plans/DYNAMICS_EXPLORER_CHAT_SERVICE_EXTRACTION_PLAN_2026-09-18.md
 * section 3.3. Errors are never caught and wrapped here; they propagate to
 * the route's outer catch unchanged.
 */

import { callClaude } from './model-call';
import { executeTool } from './tool-executor';
import { checkRestriction } from './restriction-guard';
import { trimConversation, compactMessages } from './conversation';
import {
  getThinkingMessage,
  deriveRecordCount,
  TOOL_CHAR_LIMITS,
  MAX_RESULT_CHARS,
  truncateResult,
} from './result-shaping';
import { logQuery } from './explorer-store';
import { detectPossibleFailure } from './failure-copy';
import { classifyToolError } from './tool-errors';
import { serializeDynamicsExplorerToolResult } from '../../utils/dynamics-explorer-serializer';
import {
  DATA_CLASSES,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../utils/ai-payload-boundary';
import { buildSystemPrompt, TOOL_DEFINITIONS } from '../../../shared/config/prompts/dynamics-explorer';
import { buildResolvedTaxonomyPromptBlock } from '../dynamics-explorer-taxonomy';
import { testRequestIsolationEnabled } from '../test-requests/isolation.js';
import { getModelForApp, getFallbackModelForApp } from '../../../shared/config/baseConfig';

const MAX_TOOL_ROUNDS = 15;

export async function runExplorerChat({
  messages,
  sessionId,
  userProfileId,
  userRole,
  restrictions,
  requestId,
  apiKey,
  sendEvent,
  signal,
  isDisconnected,
  onRoundComplete,
  onStage,
  onTerminal,
}) {
  // A7 Part 3: CRM records returned as tool_result are untrusted — applicant-
  // and staff-authored free-text fields can carry injection payloads that get
  // re-fed into the agent loop. Each tool_result content string is wrapped in
  // nonce sentinels (see executeOne); the preamble tells the model that
  // sentinel-delimited tool output is data, not instructions. A fresh nonce
  // per round means the preamble carries the general rule, not a nonce list.
  const resolvedTaxonomyBlock = await buildResolvedTaxonomyPromptBlock({ restrictions });
  const systemPrompt = `${buildUntrustedContentPreamble()}\n\n${buildSystemPrompt({ userRole, restrictions, resolvedTaxonomyBlock })}`;
  const testRequestIsolation = testRequestIsolationEnabled();

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
  onRoundComplete({ round: 0, model, stopReason: null });

  while (round < MAX_TOOL_ROUNDS) {
    if (isDisconnected()) {
      return { outcome: 'client_disconnected' };
    }
    round++;

    onStage('model');
    const claudeResponse = await callClaude({
      apiKey,
      model,
      fallbackModel,
      systemPrompt,
      messages: currentMessages,
      tools: TOOL_DEFINITIONS,
      userProfileId,
      requestId,
      requestRound: round,
      signal,
      onTextDelta: (text) => {
        // Stream text chunks to client in real-time
        sendEvent('text_delta', { text });
      },
    });
    onRoundComplete({ round, model: claudeResponse.model, stopReason: claudeResponse.stopReason || null });

    const textBlocks = claudeResponse.content.filter(b => b.type === 'text');
    const toolBlocks = claudeResponse.content.filter(b => b.type === 'tool_use');

    if (toolBlocks.length === 0) {
      const outcome = claudeResponse.refused || claudeResponse.stopReason === 'refusal'
        ? 'refused'
        : claudeResponse.stopReason === 'max_tokens'
          ? 'truncated'
          : 'completed';
      await onTerminal({ outcome, rounds: round });

      if (!claudeResponse._textStreamed) {
        // Text wasn't streamed (shouldn't happen, but fallback)
        const finalText = textBlocks.map(b => b.text).join('\n');
        sendEvent('response', { content: finalText });
      }
      // Check if response suggests failure — prompt user for feedback
      const finalText = textBlocks.map(b => b.text).join('\n');
      const suggestFeedback = outcome !== 'completed' || detectPossibleFailure(finalText);
      sendEvent('complete', {
        requestId,
        rounds: round,
        outcome,
        suggestFeedback,
        testRequestIsolation,
      });
      return { outcome, rounds: round };
    }

    onStage('tool');
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

    if (isDisconnected()) {
      return { outcome: 'client_disconnected' };
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
  await onTerminal({ outcome: 'max_rounds', rounds: round });
  sendEvent('response', { content: 'Reached maximum query steps. Please refine your question.' });
  sendEvent('complete', {
    requestId,
    rounds: round,
    outcome: 'max_rounds',
    maxRoundsReached: true,
    suggestFeedback: true,
    testRequestIsolation,
  });
  return { outcome: 'max_rounds', rounds: round };
}
