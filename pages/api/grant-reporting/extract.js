/**
 * API Route: /api/grant-reporting/extract
 *
 * POST: Extract structured grant report data and (optionally) compare the
 *       original proposal to the report for a goals assessment. Supports three
 *       modes:
 *
 *  - mode: "full"               Run extraction + goals assessment in parallel.
 *  - mode: "regenerate"         Re-run extraction for a single narrative field.
 *  - mode: "regenerate-goals"   Re-run only the goals assessment.
 *
 * Files are described by FileRef objects:
 *  { source: "upload",     fileUrl, filename }
 *  { source: "sharepoint", library, folder, filename }
 *
 * The goals assessment helper (`compareProposalToReport`) is exported as a
 * pure async function so a future backend pipeline can call it directly
 * without going through req/res.
 */

import { jsonrepair } from 'jsonrepair';
import { requireAppAccess } from '../../../lib/utils/auth';
import { BASE_CONFIG, getModelForApp, getFallbackModelForApp } from '../../../shared/config/baseConfig';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import {
  createGrantReportExtractionPrompt,
  createFieldRegenerationPrompt,
  createGoalsAssessmentPrompt,
  GRANT_REPORT_PROMPT_VERSION,
} from '../../../shared/config/prompts/grant-reporting';
import { logUsage, estimateCostCents } from '../../../lib/utils/usage-logger';
import { LLMClient } from '../../../lib/services/llm-client';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { loadFile, httpError } from '../../../lib/utils/file-loader';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  DATA_CLASSES,
  GRANT_REPORTING_REPORT_MAX_CHARS,
  GRANT_REPORTING_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../../lib/utils/ai-payload-boundary';
import { validateAiJson } from '../../../lib/utils/ai-output-schema';
import {
  GRANT_REPORT_EXTRACTION_SCHEMA,
  GOALS_ASSESSMENT_SCHEMA,
  FIELD_REGEN_SCHEMA,
} from '../../../shared/config/grant-reporting-output-schema';

const APP_KEY = 'grant-reporting';
const limiter = nextRateLimiter({ max: 5 });

const ALLOWED_NARRATIVE_FIELDS = new Set([
  'project_impacts',
  'awards_and_honors',
  'publication_1',
  'publication_2',
  'implications_for_future_grantmaking',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Claude API key not configured on server' });
  }

  const {
    mode = 'full',
    reportRef,
    proposalRef = null,
    headerFromDynamics = {},
    fieldKey,
    currentValues = {},
    requestGuid = null,
  } = req.body || {};

  try {
    if (mode === 'full') {
      return await handleFull({
        res,
        access,
        apiKey,
        reportRef,
        proposalRef,
        headerFromDynamics,
        requestGuid,
      });
    }

    if (mode === 'regenerate') {
      return await handleRegenerate({
        res,
        access,
        apiKey,
        reportRef,
        fieldKey,
        currentValues,
        requestGuid,
      });
    }

    if (mode === 'regenerate-goals') {
      return await handleRegenerateGoals({
        res,
        access,
        apiKey,
        reportRef,
        proposalRef,
        headerFromDynamics,
        currentValues,
        requestGuid,
      });
    }

    return res.status(400).json({ error: `Unknown mode: ${mode}` });
  } catch (err) {
    // Convert known HTTP errors to proper status codes
    if (err.status && err.status >= 400 && err.status < 600) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[GrantReporting:extract] Unhandled error:', err);
    return res.status(500).json({
      error: 'Failed to process grant report',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

// ─── Mode handlers ─────────────────────────────────────────────────────────

async function handleFull({ res, access, apiKey, reportRef, proposalRef, headerFromDynamics, requestGuid }) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!reportRef) {
    return res.status(400).json({ error: 'reportRef is required for mode=full' });
  }

  const reportLoad = await loadFile(reportRef);
  const proposalLoad = proposalRef ? await loadFile(proposalRef) : null;

  const model = getModelForApp(APP_KEY);
  const fallback = getFallbackModelForApp(APP_KEY);

  // Run extraction + goals assessment in parallel
  const extractionPromise = extractReport({
    reportText: reportLoad.text,
    headerFromDynamics,
    apiKey,
    model,
    fallback,
    userProfileId: access.profileId,
    requestGuid,
    actingUserSystemId,
  });

  const goalsPromise = proposalLoad
    ? compareProposalToReport({
        proposalText: proposalLoad.text,
        reportText: reportLoad.text,
        headerContext: headerFromDynamics,
        apiKey,
        model,
        fallback,
        userProfileId: access.profileId,
        requestGuid,
        actingUserSystemId,
      })
    : Promise.resolve(null);

  const [extraction, goalsAssessment] = await Promise.all([extractionPromise, goalsPromise]);

  return res.status(200).json({
    header: extraction.header,
    counts: extraction.counts,
    narratives: extraction.narratives,
    goalsAssessment,
    metadata: {
      reportFilename: reportLoad.filename,
      proposalFilename: proposalLoad?.filename || null,
      model,
    },
  });
}

async function handleRegenerate({ res, access, apiKey, reportRef, fieldKey, currentValues, requestGuid }) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!reportRef) {
    return res.status(400).json({ error: 'reportRef is required for mode=regenerate' });
  }
  if (!fieldKey || !ALLOWED_NARRATIVE_FIELDS.has(fieldKey)) {
    return res.status(400).json({
      error: `fieldKey must be one of: ${[...ALLOWED_NARRATIVE_FIELDS].join(', ')}`,
    });
  }

  const reportLoad = await loadFile(reportRef);
  const model = getModelForApp(APP_KEY);
  const fallback = getFallbackModelForApp(APP_KEY);

  const reportPayload = wrapUntrustedContent({
    text: reportLoad.text,
    source: 'grant-reporting.regenerate.reportText',
    dataClass: DATA_CLASSES.GRANT_REPORT_TEXT,
    maxChars: GRANT_REPORTING_REPORT_MAX_CHARS,
    label: 'grant report',
  });
  const prompt = createFieldRegenerationPrompt({
    wrappedReport: reportPayload.text,
    fieldKey,
    currentValues,
    nonces: [reportPayload.nonce],
  });
  const temperature = fieldKey === 'implications_for_future_grantmaking' ? 0.6 : 0.1;

  const start = Date.now();
  let result;
  try {
    result = await callClaudeWithFallback({
      apiKey,
      model,
      fallback,
      prompt,
      temperature,
      maxTokens: 2048,
    });
  } catch (err) {
    await tryLogAiRun({
      requestGuid,
      model,
      status: 'failed',
      rawOutput: { error: err.message, fieldKey },
      notes: `Grant Reporting regenerate (${fieldKey}) — Claude call failed`,
      actingUserSystemId,
    });
    throw err;
  }
  const latencyMs = Date.now() - start;

  logUsage({
    userProfileId: access.profileId,
    appName: APP_KEY,
    model: result.modelUsed,
    inputTokens: result.usage?.input_tokens || 0,
    outputTokens: result.usage?.output_tokens || 0,
    latencyMs,
    status: 'success',
  });

  const parsed = parseJsonResponse(result.text);
  const isPublication = fieldKey === 'publication_1' || fieldKey === 'publication_2';
  const validated = validateAndStrip(
    parsed,
    isPublication ? FIELD_REGEN_SCHEMA.publication : FIELD_REGEN_SCHEMA.string,
    `regenerate.${fieldKey}`,
  );
  const value =
    validated.value ??
    (isPublication ? { citation: '', abstract: '', source: 'verbatim' } : '');

  await tryLogAiRun({
    requestGuid,
    model: result.modelUsed,
    status: 'completed',
    rawOutput: { fieldKey, value },
    notes: `Grant Reporting regenerate (${fieldKey})`,
    actingUserSystemId,
  });

  return res.status(200).json({ value });
}

async function handleRegenerateGoals({
  res,
  access,
  apiKey,
  reportRef,
  proposalRef,
  headerFromDynamics,
  currentValues,
  requestGuid,
}) {
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!reportRef || !proposalRef) {
    return res.status(400).json({
      error: 'Both reportRef and proposalRef are required for mode=regenerate-goals',
    });
  }

  const [reportLoad, proposalLoad] = await Promise.all([loadFile(reportRef), loadFile(proposalRef)]);
  const model = getModelForApp(APP_KEY);
  const fallback = getFallbackModelForApp(APP_KEY);

  const goalsAssessment = await compareProposalToReport({
    proposalText: proposalLoad.text,
    reportText: reportLoad.text,
    headerContext: headerFromDynamics,
    currentNarratives: currentValues?.narratives || null,
    apiKey,
    model,
    fallback,
    userProfileId: access.profileId,
    requestGuid,
    actingUserSystemId,
    logContext: 'regenerate-goals',
  });

  return res.status(200).json({ goalsAssessment });
}

// ─── Pure helpers (callable headless) ──────────────────────────────────────

/**
 * Run the report extraction Claude call. Returns { header, counts, narratives }.
 *
 * Pure helper — no req/res coupling.
 */
export async function extractReport({
  reportText,
  headerFromDynamics = {},
  apiKey,
  model,
  fallback,
  userProfileId,
  requestGuid = null,
  actingUserSystemId = null,
}) {
  const reportPayload = wrapUntrustedContent({
    text: reportText,
    source: 'grant-reporting.extract.reportText',
    dataClass: DATA_CLASSES.GRANT_REPORT_TEXT,
    maxChars: GRANT_REPORTING_REPORT_MAX_CHARS,
    label: 'grant report',
  });
  const prompt = createGrantReportExtractionPrompt({
    wrappedReport: reportPayload.text,
    headerFromDynamics,
    nonces: [reportPayload.nonce],
  });
  const start = Date.now();
  let result;
  try {
    result = await callClaudeWithFallback({
      apiKey,
      model,
      fallback,
      prompt,
      temperature: 0.1,
      maxTokens: 4096,
    });
  } catch (err) {
    await tryLogAiRun({
      requestGuid,
      model,
      status: 'failed',
      rawOutput: { error: err.message },
      notes: `Grant Reporting extraction — Claude call failed (boundary: ${reportPayload.metadata.transmittedChars}/${reportPayload.metadata.originalChars} chars, truncated=${reportPayload.metadata.truncated})`,
      actingUserSystemId,
    });
    throw err;
  }
  const latencyMs = Date.now() - start;

  logUsage({
    userProfileId,
    appName: APP_KEY,
    model: result.modelUsed,
    inputTokens: result.usage?.input_tokens || 0,
    outputTokens: result.usage?.output_tokens || 0,
    latencyMs,
    status: 'success',
  });

  const parsed = parseJsonResponse(result.text);
  const validated = validateAndStrip(
    parsed,
    GRANT_REPORT_EXTRACTION_SCHEMA,
    'extraction',
  );

  await tryLogAiRun({
    requestGuid,
    model: result.modelUsed,
    status: 'completed',
    rawOutput: validated,
    notes: 'Grant Reporting extraction (full report fields)',
    actingUserSystemId,
  });

  return validated;
}

/**
 * Compare an original proposal to a grant report and produce a structured
 * goals assessment. Pure helper — no req/res coupling. This is the seam for
 * the future backend automation pipeline.
 *
 * @returns {Promise<object>} The `goalsAssessment` JSON object (not wrapped).
 */
export async function compareProposalToReport({
  proposalText,
  reportText,
  headerContext = null,
  currentNarratives = null,
  apiKey,
  model,
  fallback,
  userProfileId,
  requestGuid = null,
  actingUserSystemId = null,
  logContext = 'goals-assessment',
}) {
  const proposalPayload = wrapUntrustedContent({
    text: proposalText,
    source: 'grant-reporting.goals.proposalText',
    dataClass: DATA_CLASSES.PROPOSAL_TEXT,
    maxChars: GRANT_REPORTING_PROPOSAL_MAX_CHARS,
    label: 'original proposal',
  });
  const reportPayload = wrapUntrustedContent({
    text: reportText,
    source: 'grant-reporting.goals.reportText',
    dataClass: DATA_CLASSES.GRANT_REPORT_TEXT,
    maxChars: GRANT_REPORTING_REPORT_MAX_CHARS,
    label: 'grant report',
  });
  const prompt = createGoalsAssessmentPrompt({
    wrappedProposal: proposalPayload.text,
    wrappedReport: reportPayload.text,
    headerContext,
    currentNarratives,
    nonces: [proposalPayload.nonce, reportPayload.nonce],
  });

  const start = Date.now();
  let result;
  try {
    result = await callClaudeWithFallback({
      apiKey,
      model,
      fallback,
      prompt,
      temperature: 0.2,
      maxTokens: 4096,
    });
  } catch (err) {
    await tryLogAiRun({
      requestGuid,
      model,
      status: 'failed',
      rawOutput: { error: err.message },
      notes: `Grant Reporting ${logContext} — Claude call failed`,
      actingUserSystemId,
    });
    throw err;
  }
  const latencyMs = Date.now() - start;

  logUsage({
    userProfileId,
    appName: APP_KEY,
    model: result.modelUsed,
    inputTokens: result.usage?.input_tokens || 0,
    outputTokens: result.usage?.output_tokens || 0,
    latencyMs,
    status: 'success',
  });

  const parsed = parseJsonResponse(result.text);
  const goalsAssessment = validateAndStrip(
    parsed.goalsAssessment ?? parsed,
    GOALS_ASSESSMENT_SCHEMA,
    logContext,
  );

  await tryLogAiRun({
    requestGuid,
    model: result.modelUsed,
    status: 'completed',
    rawOutput: { goalsAssessment },
    notes: `Grant Reporting ${logContext} (proposal vs. report)`,
    actingUserSystemId,
  });

  return goalsAssessment;
}

// ─── Claude calling ────────────────────────────────────────────────────────

async function callClaudeWithFallback({ apiKey, model, fallback, prompt, temperature, maxTokens }) {
  try {
    const r = await callClaude({ apiKey, model, prompt, temperature, maxTokens });
    return { ...r, modelUsed: model };
  } catch (primaryError) {
    if (!fallback || fallback === model) throw primaryError;
    console.warn(
      `[GrantReporting:extract] Primary model (${model}) failed: ${primaryError.message}; trying fallback ${fallback}`,
    );
    const r = await callClaude({ apiKey, model: fallback, prompt, temperature, maxTokens });
    return { ...r, modelUsed: fallback };
  }
}

async function callClaude({ apiKey, model, prompt, temperature, maxTokens }) {
  // Route handles its own usage logging (multiple modelUsed branches), so the
  // wrapper has no appName.
  const claude = new LLMClient({ apiKey, model });
  const r = await claude.complete({
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
    temperature,
  });
  return {
    text: r.text || '',
    usage: { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens },
  };
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function parseJsonResponse(text) {
  if (!text) {
    throw httpError(502, 'Claude returned an empty response');
  }
  // Strip optional ```json ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Fallback: attempt to repair common LLM JSON mistakes (unescaped quotes,
    // control chars, trailing commas) before giving up.
    try {
      const repaired = jsonrepair(jsonStr);
      const parsed = JSON.parse(repaired);
      console.warn(
        `[GrantReporting:extract] JSON required repair (original error: ${err.message})`,
      );
      return parsed;
    } catch (repairErr) {
      console.error('[GrantReporting:extract] Failed to parse JSON response:', err.message);
      console.error('[GrantReporting:extract] Repair also failed:', repairErr.message);
      console.error('[GrantReporting:extract] Raw text:', text.slice(0, 500));
      throw httpError(502, `Failed to parse JSON response from Claude: ${err.message}`);
    }
  }
}

/**
 * Validate parsed LLM JSON against a schema (A7 Part 1). Undeclared keys are
 * dropped; enum values are coerced to safe defaults; type mismatches are a
 * hard error. The model is given an explicit schema and untrusted text is
 * sentinel-wrapped, so a validation failure here means genuinely malformed
 * structured output — surfaced as a 502 rather than passed on to staff.
 */
function validateAndStrip(parsed, schema, context) {
  const result = validateAiJson(parsed, schema);
  if (!result.ok) {
    console.error(
      `[GrantReporting:extract] Output schema validation failed (${context}): ${result.errors.join('; ')}`,
    );
    throw httpError(502, `Claude returned structurally invalid ${context} output`);
  }
  return result.value;
}

// Fire-and-log wrapper around DynamicsService.logAiRun. Writeback is best-effort
// audit logging — a failure here must never break the user's extraction flow.
//
// Note on rawOutputRetention: deliberately omitted (defaults to 'full') across
// every call site. Grant Reporting has no save endpoint — extracted fields and
// the goals assessment flow only into the client-side Word export, never to a
// Dynamics field. The wmkf_ai_run row is therefore the ONLY durable copy of
// the model output, so hashing it would discard the underlying record. If a
// future iteration adds a save-to-akoya_request path, revisit and switch
// extract/regenerate to 'hash' (goals likely stays 'full' — see comment in
// compareProposalToReport).
async function tryLogAiRun({ requestGuid, model, status, rawOutput, notes, actingUserSystemId }) {
  if (!requestGuid) return;
  try {
    // DynamicsService writes require a trusted DAL context (see
    // lib/services/dynamics-context.js assertTrustedDalContext); without
    // this wrapper the write throws under DAL enforcement and is swallowed by
    // the catch below, silently dropping the audit log.
    await withDalContext('grant-reporting-extract-ai-log', () =>
      DynamicsService.logAiRun({
        requestGuid,
        taskType: 'report',
        model,
        promptVersion: GRANT_REPORT_PROMPT_VERSION,
        status,
        rawOutput,
        notes,
        actingUserSystemId,
      })
    );
  } catch (err) {
    console.warn(`[GrantReporting:extract] logAiRun failed (non-fatal): ${err.message}`);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  maxDuration: 300,
};
