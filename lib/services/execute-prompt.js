/**
 * Phase 0 Executor — Vercel implementation of docs/EXECUTOR_CONTRACT.md.
 *
 * Production prompt path: reads current prompt rows from Dataverse entity set
 * wmkf_ai_prompts and writes execution audit rows to wmkf_ai_runs. Used in
 * production by /api/phase-i-dynamics/summarize-v2; does not use the legacy
 * PromptResolver scratch-row path.
 *
 * Single entry point: executePrompt({ promptName, requestId,
 *   overrideVariables, runSource, forceOverwrite }) → { parsed, runId,
 *   cacheHit, blocked, conflicts, writeResults }
 *
 * Phase 0 supported:
 *   source.kind:    dynamics, sharepoint, override
 *   target.kind:    akoya_request (with optional jsonPath $.foo), none
 *   guard:          skip-if-populated (default for akoya_request), always-overwrite
 *   parseMode:      raw, json
 *   preprocess:     pdf_to_text
 *
 * Anything outside this list throws — better to fail loud than drift silently.
 *
 * Out of scope (separate code paths): tool-use loops, streaming, non-Claude
 * models, Batch API, multi-turn. See contract § Scope of generality.
 */

import { withDalContext } from '../dataverse/core/context.js';
import * as grantRequestAdapter from '../dataverse/adapters/grant-request.js';
import * as aiRunAdapter from '../dataverse/adapters/ai-run.js';
import { GraphService } from './graph-service.js';
import { getRequestSharePointBuckets } from '../utils/sharepoint-buckets.js';
import { extractTextFromBuffer } from '../utils/file-loader.js';
import { BASE_CONFIG } from '../../shared/config/baseConfig.js';
import {
  buildBoundedTextPayload,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
  deriveStableNonce,
} from '../utils/ai-payload-boundary.js';
import { applyRawOutputRetention } from '../utils/ai-run-retention.js';
import { resolveModel, loadAvailableModels, resolveModelWithCapabilities } from './model-resolver.js';
import { LLMClient } from './llm-client.js';
import { validateAiJson } from '../utils/ai-output-schema.js';
import { fetchCurrentPrompt, interpolate } from './prompt-store.js';

// Probed via metadata; see scripts/_tmp-probe-picklists.mjs (Session 110).
const RUN_STATUS = Object.freeze({
  completed: 682090000,
  failed: 682090001,
  needs_review: 682090002,
});
const RUN_SOURCE = Object.freeze({
  'PowerAutomate Auto': 682090000,
  'Vercel User': 682090001,
  'Vercel Test': 682090002,
  'Vercel Interactive': 682090003,
  'PowerAutomate Test': 682090004,
  'PowerAutomate Manual': 682090005,
});

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function executePrompt({
  promptName,
  requestId = null,
  overrideVariables = {},
  runSource,
  forceOverwrite = false,
  actingUserSystemId = null,
}) {
  if (!promptName) throw new Error('executePrompt: promptName required');
  if (!runSource) throw new Error('executePrompt: runSource required');
  if (!(runSource in RUN_SOURCE)) {
    throw new Error(`executePrompt: unknown runSource "${runSource}" (expected one of ${Object.keys(RUN_SOURCE).join(', ')})`);
  }

  return withDalContext('execute-prompt', async () => {
  const startedAt = Date.now();
  let promptRow = null;
  let variableDecls = [];
  let modelInfo = null;

  try {
    // Step 1: resolve prompt
    promptRow = await fetchCurrentPrompt(promptName);
    modelInfo = await resolvePromptClaudeModel(promptRow, promptName);

    // Step 2: parse declarations
    variableDecls = parseJsonField(promptRow.wmkf_ai_promptvariables, 'wmkf_ai_promptvariables').variables || [];
    const outputSchema = parseJsonField(promptRow.wmkf_ai_promptoutputschema, 'wmkf_ai_promptoutputschema');
    const outputs = outputSchema.outputs || [];
    const parseMode = outputSchema.parseMode || 'json';

    if (!['raw', 'json'].includes(parseMode)) {
      throw new Error(`Phase 0 supports parseMode raw|json (got "${parseMode}")`);
    }
    if (parseMode === 'raw' && outputs.length !== 1) {
      throw new Error(`parseMode=raw requires exactly one output (got ${outputs.length})`);
    }

    // Step 3: resolve variable values
    const requestRow = requestId ? await grantRequestAdapter.getById(requestId) : null;
    const rawVariables = await resolveVariables(variableDecls, { requestId, requestRow, overrideVariables });

    // Step 3b: apply per-variable AI payload boundary when declared.
    // See docs/EXECUTOR_CONTRACT.md § "Data classification + payload boundary".
    // A variable opts in by declaring BOTH `dataClass` and `maxChars`; the
    // Executor then enforces the cap uniformly regardless of source.kind.
    const { variables, aiPayloadBoundaries, untrustedNonces } = applyVariableBoundaries(
      variableDecls,
      rawVariables,
      promptRow.wmkf_ai_promptname || promptName,
    );

    // Step 4: preflight output guards
    const { conflicts, etag } = preflightGuards(outputs, requestRow);
    if (conflicts.length > 0 && !forceOverwrite) {
      const runId = await writeRunRow({
        promptRow, requestId, runSource,
        status: 'needs_review',
        rawOutput: { blocked: true, conflicts },
        notes: `Pre-flight blocked — ${conflicts.length} target(s) populated; caller did not pass forceOverwrite=true`,
        overrideVariables,
        variableDecls,
        modelUsed: modelInfo.model,
        actingUserSystemId,
      });
      return { parsed: null, runId, cacheHit: false, blocked: true, conflicts, writeResults: null };
    }

    // Steps 5+6: compose payload + call Claude
    const composed = composeMessages(promptRow, variables, untrustedNonces);
    const claudeResp = await callClaude(promptRow, composed, modelInfo);
    const cacheHit = (claudeResp.usage?.cache_read_input_tokens || 0) > 0;

    // Step 7: parse output
    const parsed = parseClaudeOutput(claudeResp, outputSchema);
    const rawOutputRetention = outputSchema.rawOutputRetention || 'full';
    const retainedRawOutput = applyRawOutputRetention(
      claudeResp.content?.[0]?.text || '',
      rawOutputRetention,
    );

    // Step 8: persist outputs
    const writeResults = await persistOutputs(outputs, parsed, requestId, etag, actingUserSystemId);

    const meta = {
      promptName: promptRow.wmkf_ai_promptname,
      promptVersion: promptRow.wmkf_promptversion,
      promptId: promptRow.wmkf_ai_promptid,
      modelUsed: claudeResp.model || modelInfo.model,
      systemChars: composed.system.length,
      bodyChars: composed.body.length,
      aiPayloadBoundaries,
      rawOutputRetention,
    };

    // Step 9: log run
    const runId = await writeRunRow({
      promptRow, requestId, runSource,
      status: writeResults.allOk ? 'completed' : 'needs_review',
      rawOutput: retainedRawOutput,
      notes: buildSuccessNotes(claudeResp, writeResults, Date.now() - startedAt, cacheHit, aiPayloadBoundaries),
      overrideVariables,
      variableDecls,
      modelUsed: claudeResp.model || modelInfo.model,
      actingUserSystemId,
    });

    // Step 10: return
    return {
      parsed, runId, cacheHit,
      blocked: false, conflicts: [],
      writeResults,
      usage: claudeResp.usage || null,
      meta,
    };
  } catch (err) {
    // Always log the failure (audit completeness invariant).
    let runId = null;
    try {
      runId = await writeRunRow({
        promptRow, requestId, runSource,
        status: 'failed',
        rawOutput: { error: err.message, stack: (err.stack || '').split('\n').slice(0, 6).join('\n') },
        notes: `Executor error: ${err.message}`,
        overrideVariables,
        variableDecls,
        modelUsed: modelInfo?.model || resolveModel(promptRow?.wmkf_ai_model) || promptRow?.wmkf_ai_model,
        actingUserSystemId,
      });
    } catch (logErr) {
      console.error('[executePrompt] also failed to log failure run row:', logErr.message);
    }
    err.runId = runId;
    throw err;
  }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1: prompt fetch — `fetchCurrentPrompt` lives in ./prompt-store.js (the
// dependency-free leaf shared with the reviewer-finder resolver, S222).
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Step 3: variable resolution
// ────────────────────────────────────────────────────────────────────────────

async function resolveVariables(decls, ctx) {
  const out = {};
  for (const decl of decls) {
    out[decl.name] = await resolveOne(decl, ctx);
  }
  return out;
}

async function resolveOne(decl, { requestId, requestRow, overrideVariables }) {
  const { name, source = {} } = decl;
  const kind = source.kind;

  if (kind === 'override') {
    const v = overrideVariables[name] !== undefined ? overrideVariables[name] : source.default;
    if (v === undefined && decl.required) {
      throw new Error(`Required override variable "${name}" not provided and no default`);
    }
    return v ?? '';
  }

  if (kind === 'dynamics') {
    const table = source.table || 'akoya_request';
    if (table !== 'akoya_request') {
      throw new Error(`Phase 0 dynamics source supports table=akoya_request only (got "${table}")`);
    }
    if (!requestRow) {
      throw new Error(`Variable "${name}" needs requestRow but no requestId was supplied`);
    }
    const v = requestRow[source.field];
    if (v == null && decl.required) {
      throw new Error(`Required dynamics variable "${name}" missing on request row (field=${source.field})`);
    }
    return v ?? '';
  }

  if (kind === 'sharepoint') {
    if (!requestId || !requestRow) {
      throw new Error(`Variable "${name}" needs requestId for sharepoint resolution`);
    }
    return resolveSharepointVar(decl, requestId, requestRow);
  }

  throw new Error(`Phase 0 unsupported source.kind "${kind}" for variable "${name}"`);
}

async function resolveSharepointVar(decl, requestId, requestRow) {
  const { source } = decl;
  const { pattern, preprocess, maxChars } = source;
  if (!pattern) throw new Error(`sharepoint variable "${decl.name}" requires source.pattern`);
  if (preprocess && preprocess !== 'pdf_to_text') {
    throw new Error(`Phase 0 supports preprocess=pdf_to_text only (got "${preprocess}")`);
  }

  const requestNumber = requestRow.akoya_requestnum;
  if (!requestNumber) throw new Error(`Cannot resolve sharepoint var: request row missing akoya_requestnum`);

  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  const matcher = patternToRegex(pattern);

  let chosen = null;
  for (const b of buckets) {
    let files;
    try {
      files = await GraphService.listFiles(b.library, b.folder, { recursive: true });
    } catch {
      continue; // archive 404s and similar are normal
    }
    const hit = (files || []).find(f => matcher.test(f.name));
    if (hit) {
      // listFiles returns each file with its actual folder path — use that
      // for downloadFileByPath so nested files resolve correctly.
      chosen = { library: b.library, folder: hit.folder || b.folder, name: hit.name };
      break;
    }
  }

  if (!chosen) {
    if (decl.required) {
      throw new Error(`No file matching "${pattern}" in any bucket for request ${requestNumber}`);
    }
    return '';
  }

  const downloaded = await GraphService.downloadFileByPath(chosen.library, chosen.folder, chosen.name);
  const text = await extractTextFromBuffer(downloaded.buffer, chosen.name, downloaded.mimeType);
  if (!text || text.trim().length < 100) {
    throw new Error(`Extracted text from "${chosen.name}" is empty or too short`);
  }
  return maxChars && text.length > maxChars ? text.substring(0, maxChars) : text;
}

function patternToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4: preflight guards
// ────────────────────────────────────────────────────────────────────────────

function preflightGuards(outputs, requestRow) {
  const conflicts = [];
  // ETag is a property of the row, shared across all akoya_request output writes.
  const etag = requestRow?._etag || null;

  for (const out of outputs) {
    const guard = out.guard || (out.target?.kind === 'akoya_request' ? 'skip-if-populated' : 'always-overwrite');
    if (guard === 'always-overwrite') continue;
    if (guard !== 'skip-if-populated') {
      throw new Error(`Phase 0 unsupported guard "${guard}" on output "${out.name}"`);
    }
    if (out.target?.kind !== 'akoya_request') continue; // guard only meaningful for writeable targets
    if (!requestRow) throw new Error(`Output "${out.name}" guard requires requestId`);

    const fieldName = out.target.field;
    const jsonPath = out.target.jsonPath || null;
    const raw = requestRow[fieldName];

    let populated;
    let existingPathValue = null;
    if (jsonPath) {
      const obj = parseMemoJson(raw);
      existingPathValue = readJsonPath(obj, jsonPath);
      populated = !isEmpty(existingPathValue);
    } else {
      populated = !isEmpty(raw);
    }

    if (populated) {
      conflicts.push({
        output: out.name,
        table: 'akoya_request',
        field: fieldName,
        jsonPath,
        existingContent: jsonPath ? existingPathValue : raw,
        existingLength: typeof raw === 'string' ? raw.length : (existingPathValue ? String(existingPathValue).length : 0),
        modifiedOn: requestRow.modifiedon || null,
      });
    }
  }
  return { conflicts, etag };
}

function isEmpty(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function parseMemoJson(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}

function readJsonPath(obj, path) {
  // Phase 0: support `$.foo` (single top-level key) only.
  const m = path.match(/^\$\.(\w+)$/);
  if (!m) throw new Error(`Phase 0 jsonPath supports top-level $.foo only (got "${path}")`);
  return obj?.[m[1]];
}

// ────────────────────────────────────────────────────────────────────────────
// Steps 5+6: compose + call Claude
// ────────────────────────────────────────────────────────────────────────────

async function resolvePromptClaudeModel(promptRow, promptName) {
  // Prompt-row model may be a tier key (opus/sonnet/haiku) or a concrete id.
  // Warm the resolver cache first so tier resolution hits a live model list
  // rather than the hand-maintained fallback table.
  await loadAvailableModels();
  const rawModel = promptRow.wmkf_ai_model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  const modelInfo = resolveModelWithCapabilities(rawModel);
  const model = modelInfo.model || rawModel;
  const capabilities = modelInfo.capabilities;
  if (capabilities.unknown) {
    const label = promptRow.wmkf_ai_promptname || promptName || '(unknown prompt)';
    throw new Error(
      `executePrompt: prompt "${label}" resolves to unreviewed Claude model "${model}". ` +
      'Add it to lib/services/model-capabilities.js and lib/utils/model-pricing.js before executing this prompt.',
    );
  }
  return { rawModel, model, capabilities };
}

function composeMessages(promptRow, variables, untrustedNonces = []) {
  // Phase 0 compromise: interpolate {{var}} across BOTH system and body.
  // Phase 0 declarations require placement="user" but the existing
  // phase-i.summary text has slots in the system block. See
  // scripts/seed-phase-i-summary-prompt.js header comment for full rationale;
  // Phase 2 placement="system" + context blocks will reconcile.
  let system = interpolate(promptRow.wmkf_ai_systemprompt || '', variables);

  // A7 Part 2: when any variable resolved to wrapped untrusted content, the
  // system prompt must carry the hardening preamble so the model knows the
  // sentinel-delimited text is data, never instructions. The preamble is
  // injected here (not seeded into the Dataverse prompt body) so it stays
  // consistent and the stored prompt text remains clean.
  if (untrustedNonces.length > 0) {
    system = `${buildUntrustedContentPreamble(untrustedNonces)}\n\n${system}`;
  }

  return {
    system,
    body: interpolate(promptRow.wmkf_ai_promptbody || '', variables),
  };
}

// `interpolate` lives in ./prompt-store.js (shared leaf, S222).

async function callClaude(promptRow, { system, body }, modelInfo) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set');

  const model = modelInfo.model;
  const maxTokens = promptRow.wmkf_ai_maxtokens || BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS;
  const temperature =
    promptRow.wmkf_ai_temperature != null
      ? Number(promptRow.wmkf_ai_temperature)
      : BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE;

  // Transport goes through the canonical LLMClient (safeFetch SSRF allowlist,
  // abortable timeout, 429/529 retry, API-key redaction) instead of a raw
  // fetch. No `appName` is passed on purpose: the Executor writes its own
  // wmkf_ai_run audit row, and the driver route (/api/phase-i-dynamics/
  // summarize-v2) already calls logUsage() — passing appName here would
  // double-count api_usage_log. (Consolidating Executor usage accounting is a
  // separate follow-up; see docs/security-audit/PHASE_2_EXECUTOR_TRANSPORT_DESIGN.)
  const client = new LLMClient({ apiKey, model });
  const r = await client.complete({
    maxTokens,
    temperature,
    // Single cache_control marker at the boundary between system and user.
    // Cacheable variables placed BEFORE this point (Phase 0: all live in
    // system) produce stable cache-key prefixes across reruns. LLMClient
    // passes this system array through to the API verbatim.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: body }],
  });

  // Re-shape LLMClient's normalized response back to the raw Anthropic shape
  // the rest of this module consumes (content[0].text, snake_case usage,
  // model). Keeps cache-hit detection, buildSuccessNotes, and the parse step
  // unchanged.
  return {
    content: r.content,
    model: r.model,
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 7: parse output
// ────────────────────────────────────────────────────────────────────────────

function parseClaudeOutput(claudeResp, outputSchema) {
  const text = claudeResp.content?.[0]?.text || '';
  const parseMode = outputSchema.parseMode || 'json';
  const outputs = outputSchema.outputs || [];

  if (parseMode === 'raw') {
    if (outputs.length !== 1) throw new Error(`parseMode=raw requires single output (got ${outputs.length})`);
    if (!text || text.trim().length < 20) {
      throw new Error(`Claude returned empty/short text (${text.length} chars)`);
    }
    return { [outputs[0].name]: text.trim() };
  }

  // json mode
  let jsonText = text.trim();
  const fenced = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) jsonText = fenced[1];

  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) { throw new Error(`Claude output not valid JSON: ${e.message}`); }

  if (outputSchema.jsonSchema?.required) {
    for (const k of outputSchema.jsonSchema.required) {
      if (!(k in parsed)) throw new Error(`Claude output missing required field "${k}"`);
    }
  }

  // A7 step 3: if the prompt row declares a `validationSchema` (a declarative
  // validateAiJson node — JSON-serialisable, stored alongside `outputs` in
  // wmkf_ai_promptoutputschema), validate the parsed model output against it
  // BEFORE it reaches persistOutputs() and the akoya_request writeback. This
  // drops keys the schema does not declare and bounds types/lengths, so an
  // injected field cannot ride through to a Dynamics sink. Prompts without a
  // `validationSchema` are unchanged (backward-compatible); `raw` parseMode is
  // never reached here.
  if (outputSchema.validationSchema) {
    const r = validateAiJson(parsed, outputSchema.validationSchema);
    if (!r.ok) {
      throw new Error(`Claude output failed schema validation: ${r.errors.join('; ')}`);
    }
    return r.value;
  }
  return parsed;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 8: persist
// ────────────────────────────────────────────────────────────────────────────

async function persistOutputs(outputs, parsed, requestId, etag, actingUserSystemId = null) {
  const results = [];
  let allOk = true;

  // Validate target kinds + collect akoya_request writes. `kind: 'none'`
  // means pass-through (computed but not persisted) and is silently
  // skipped — no result row, matching pre-S144 behavior. Anything other
  // than 'akoya_request' / 'none' is a programmer error and throws.
  const akoyaWrites = [];
  for (const out of outputs) {
    if (out.target?.kind === 'none') continue; // pass-through-only; not persisted
    if (out.target?.kind !== 'akoya_request') {
      throw new Error(`Phase 0 unsupported target.kind "${out.target?.kind}" on output "${out.name}"`);
    }
    akoyaWrites.push(out);
  }

  if (akoyaWrites.length === 0) return { results, allOk };
  if (!requestId) throw new Error('akoya_request outputs require requestId');

  // Schema-level validation: catch ambiguous schemas before any I/O.
  // Two outputs that write the same field with no jsonPath are a programmer
  // error — declaration order is undefined and one would silently overwrite
  // the other.
  const directFieldsSeen = new Set();
  for (const out of akoyaWrites) {
    if (out.target.jsonPath) continue;
    const field = out.target.field;
    if (directFieldsSeen.has(field)) {
      throw new Error(
        `Output schema error: multiple outputs write field "${field}" without a jsonPath; use distinct fields or jsonPath suffixes`,
      );
    }
    directFieldsSeen.add(field);
  }

  // Bucket writes into direct (single value per field) and jsonPath (multiple
  // path-keyed values per memo field). Outputs missing from `parsed` are
  // recorded as failed but don't block other outputs from landing — they
  // just don't contribute to the payload.
  const directWrites = {};                    // { field: stringValue }
  const jsonPathWrites = {};                  // { field: [{ path, value, outputName }, ...] }
  const eligibleOutputs = [];

  for (const out of akoyaWrites) {
    const value = parsed?.[out.name];
    if (value === undefined) {
      results.push({ output: out.name, ok: false, reason: 'missing in parsed output' });
      allOk = false;
      continue;
    }
    if (out.target.jsonPath) {
      const m = out.target.jsonPath.match(/^\$\.(\w+)$/);
      if (!m) throw new Error(`Unsupported jsonPath "${out.target.jsonPath}"`);
      (jsonPathWrites[out.target.field] ??= []).push({ path: out.target.jsonPath, value, outputName: out.name });
    } else {
      directWrites[out.target.field] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    eligibleOutputs.push(out);
  }

  if (eligibleOutputs.length === 0) return { results, allOk };

  // For each jsonPath field, GET the current memo and merge in declaration
  // order (later outputs win on key collisions — documented behavior).
  const payload = { ...directWrites };
  for (const [field, entries] of Object.entries(jsonPathWrites)) {
    const fresh = await grantRequestAdapter.getById(requestId, { select: field });
    const current = parseMemoJson(fresh?.[field]);
    for (const { path, value } of entries) {
      const m = path.match(/^\$\.(\w+)$/); // pre-validated above
      current[m[1]] = value;
    }
    payload[field] = JSON.stringify(current);
  }

  // Single coalesced PATCH. Success or failure applies to every contributing
  // output uniformly — there is no partial landing.
  try {
    await grantRequestAdapter.updateById(
      requestId, payload,
      {
        ...(etag ? { ifMatch: etag } : {}),
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      },
    );
    for (const out of eligibleOutputs) {
      results.push({ output: out.name, ok: true, field: out.target.field, jsonPath: out.target.jsonPath || null });
    }
  } catch (err) {
    const reason = err.status === 412 ? 'concurrent_edit' : 'writeback_failed';
    for (const out of eligibleOutputs) {
      results.push({ output: out.name, ok: false, reason, field: out.target.field, jsonPath: out.target.jsonPath || null, error: err.message });
    }
    allOk = false;
  }

  return { results, allOk };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 9: log run
// ────────────────────────────────────────────────────────────────────────────

async function writeRunRow({ promptRow, requestId, runSource, status, rawOutput, notes, overrideVariables, variableDecls = [], modelUsed, actingUserSystemId = null }) {
  const payload = {
    wmkf_ai_status: RUN_STATUS[status],
    wmkf_ai_runsource: RUN_SOURCE[runSource],
  };
  if (modelUsed) payload.wmkf_ai_model = String(modelUsed).slice(0, 64);
  if (promptRow?.wmkf_ai_promptid) {
    payload['wmkf_ai_Prompt@odata.bind'] = `/wmkf_ai_prompts(${promptRow.wmkf_ai_promptid})`;
  }
  if (promptRow?.wmkf_promptversion != null) {
    payload.wmkf_ai_promptversion = Number(promptRow.wmkf_promptversion);
  }
  if (requestId) {
    payload['wmkf_ai_Request@odata.bind'] = `/akoya_requests(${requestId})`;
  }
  const overrideKeys = Object.keys(overrideVariables || {});
  if (overrideKeys.length > 0) {
    payload.wmkf_ai_promptoverridden = true;
    const redacted = redactBoundedOverrides(overrideVariables, variableDecls);
    payload.wmkf_ai_promptoverride = truncate(JSON.stringify(redacted), 4000);
  } else {
    payload.wmkf_ai_promptoverridden = false;
  }
  if (rawOutput !== undefined && rawOutput !== null) {
    const s = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
    payload.wmkf_ai_rawoutput = truncate(s, 1_000_000);
  }
  if (notes) payload.wmkf_ai_notes = truncate(String(notes), 2000);

  const created = await aiRunAdapter.create(payload, { actingUserSystemId });
  return created.wmkf_ai_runid;
}

function truncate(s, max) {
  if (!s || s.length <= max) return s;
  const marker = `\n…[truncated ${s.length - max} chars]`;
  return s.slice(0, max - marker.length) + marker;
}

function buildSuccessNotes(claudeResp, writeResults, latencyMs, cacheHit, aiPayloadBoundaries = []) {
  const u = claudeResp.usage || {};
  const failed = writeResults.results.filter(r => !r.ok).map(r => `${r.output}:${r.reason}`).join(',');
  // Compact, content-free representation of any bounded variables. Goes into
  // the wmkf_ai_run audit trail so unattended PA-triggered runs preserve the
  // boundary record without storing raw input text.
  const boundary = (aiPayloadBoundaries || [])
    .map(b => `${b.source}:${b.transmittedChars}/${b.originalChars}${b.truncated ? ' truncated' : ''}`)
    .join(',');
  return [
    `latency=${latencyMs}ms`,
    `tokens in=${u.input_tokens || 0}/out=${u.output_tokens || 0}/cache_create=${u.cache_creation_input_tokens || 0}/cache_read=${u.cache_read_input_tokens || 0}`,
    `cacheHit=${cacheHit}`,
    failed ? `writes_failed=${failed}` : 'writes=ok',
    boundary ? `boundaries=${boundary}` : null,
  ].filter(Boolean).join('; ');
}

/**
 * Walk the variable declarations alongside their resolved values; for each
 * variable that opts in via `dataClass` + `maxChars`, apply a payload boundary
 * and collect metadata.
 *
 * Two boundary modes:
 *  - `untrusted: true` on the declaration → `wrapUntrustedContent`: the value
 *    is length-capped AND wrapped in nonce-bearing sentinels (A7 Part 2). The
 *    nonce is collected so `composeMessages` can add the hardening preamble.
 *  - otherwise → `buildBoundedTextPayload`: length cap only.
 *
 * `untrusted: true` requires `dataClass` + `maxChars` (the wrapper needs a
 * cap); a declaration that sets `untrusted` without them is a seed-script
 * error and throws.
 *
 * Variables without `dataClass`+`maxChars` pass through unchanged. Source
 * string is `executor.<promptName>.<variableName>` so audit logs and tests
 * can distinguish Executor-driven boundaries from route-driven ones.
 *
 * Non-string values (e.g. an `override` default that's a number) skip
 * boundary application — only string-bearing variables are bounded.
 *
 * @returns {{variables: Object, aiPayloadBoundaries: Array, untrustedNonces: string[]}}
 */
function applyVariableBoundaries(decls, resolved, promptName) {
  const variables = {};
  const aiPayloadBoundaries = [];
  const untrustedNonces = [];

  for (const decl of decls) {
    const name = decl.name;
    const value = resolved[name];
    const hasCap =
      decl.dataClass && Number.isInteger(decl.maxChars) && decl.maxChars > 0;

    if (decl.untrusted && !hasCap) {
      throw new Error(
        `Variable "${name}" declares untrusted:true but is missing dataClass/maxChars — ` +
          'untrusted text must be capped before wrapping (fix the prompt seed).',
      );
    }

    if (!hasCap || typeof value !== 'string') {
      variables[name] = value;
      continue;
    }

    if (decl.untrusted) {
      const payload = wrapUntrustedContent({
        text: value,
        source: `executor.${promptName}.${name}`,
        dataClass: decl.dataClass,
        maxChars: decl.maxChars,
        label: name,
        // Prompt caching: the wrapped block + preamble lead the marked system
        // prompt, so a fresh per-call nonce defeats prefix caching. Derive a
        // nonce that is stable for this exact (prompt, variable, content) tuple
        // (keyed by a server secret — see deriveStableNonce). An identical rerun
        // then reproduces a byte-identical system prompt and can hit the cache;
        // distinct documents get distinct nonces, so nothing is shared falsely.
        // (Full cross-document caching still needs the Phase 2 template/variable
        // split — see composeMessages — this only unblocks identical reruns.)
        nonce: deriveStableNonce(`executor.${promptName}.${name}`, value),
      });
      variables[name] = payload.text;
      aiPayloadBoundaries.push(payload.metadata);
      untrustedNonces.push(payload.nonce);
    } else {
      const payload = buildBoundedTextPayload({
        text: value,
        source: `executor.${promptName}.${name}`,
        dataClass: decl.dataClass,
        maxChars: decl.maxChars,
      });
      variables[name] = payload.text;
      aiPayloadBoundaries.push(payload.metadata);
    }
  }

  return { variables, aiPayloadBoundaries, untrustedNonces };
}

/**
 * Returns a copy of `overrideVariables` where any value whose declaration opts
 * into the payload boundary (`dataClass` + `maxChars`) is replaced with a
 * content-free summary. Used to keep raw bounded text (proposal bodies, etc.)
 * out of the `wmkf_ai_promptoverride` audit field — the bounded text is
 * already what was sent to Claude; the audit row only needs to record the
 * shape, not re-persist the raw input.
 *
 * Variables without a boundary declaration pass through unchanged.
 */
function redactBoundedOverrides(overrideVariables, variableDecls) {
  if (!overrideVariables) return overrideVariables;
  const declByName = new Map((variableDecls || []).map(d => [d.name, d]));
  const out = {};
  for (const [name, value] of Object.entries(overrideVariables)) {
    const decl = declByName.get(name);
    const isBounded =
      decl &&
      decl.dataClass &&
      Number.isInteger(decl.maxChars) &&
      decl.maxChars > 0 &&
      typeof value === 'string';
    if (!isBounded) {
      out[name] = value;
      continue;
    }
    out[name] = `[redacted: dataClass=${decl.dataClass}, originalChars=${value.length}, maxChars=${decl.maxChars}]`;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function parseJsonField(s, label) {
  if (!s || s.trim().length === 0) return {};
  try { return JSON.parse(s); }
  catch (e) { throw new Error(`Failed to parse ${label} as JSON: ${e.message}`); }
}
