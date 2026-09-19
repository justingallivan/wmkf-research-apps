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
import ExcelJS from 'exceljs';
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
import { estimateCostCents } from '../../../lib/utils/usage-logger';
import {
  serializeDynamicsExplorerRecordForModel,
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
import { callClaude, callClaudeBatch } from '../../../lib/services/dynamics-explorer/model-call';
import { findReportsDue, searchRecords } from '../../../lib/services/dynamics-explorer/tools/composite';
import { describeTable } from '../../../lib/services/dynamics-explorer/tools/describe-table';
import { getEntity } from '../../../lib/services/dynamics-explorer/tools/get-entity';
import { getRelated } from '../../../lib/services/dynamics-explorer/tools/get-related';
import { listDocuments, searchDocuments } from '../../../lib/services/dynamics-explorer/tools/documents';
import { validateEffectiveODataCall, validatorReject, classifyToolError } from '../../../lib/services/dynamics-explorer/tool-errors';
import { runSampleProcessing, processRecordsBatch } from '../../../lib/services/dynamics-explorer/tools/batch-processing';

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
