/**
 * API Route: /api/phase-i-dynamics/summarize-v2
 *
 * Phase 0 reference call site for the shared Executor (lib/services/execute-prompt.js).
 *
 * Responsibilities of THIS route (Vercel-specific concerns):
 *   - auth + rate limiting
 *   - body parsing (requestGuid, fileRef, summary parameters)
 *   - load proposal text from fileRef (upload OR user-picked SharePoint file)
 *   - turn `blocked` Executor result into HTTP 409 with conflict details
 *   - shape the success response for the existing UI
 *
 * Everything else (prompt fetch, variable resolution, Claude call, writeback,
 * audit log) lives in executePrompt() — see docs/EXECUTOR_CONTRACT.md.
 *
 * Pre-Phase 0 this file was ~290 lines and reimplemented the prompt fetch /
 * Claude / writeback / audit dance inline. The new shape is intentionally
 * minimal — file loading is the only Vercel-specific concern that doesn't
 * belong in the Executor (file source ambiguity is a UI concern, not a
 * prompt-execution concern).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { logUsage } from '../../../lib/utils/usage-logger';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { loadFile } from '../../../lib/utils/file-loader';
import { executePrompt } from '../../../lib/services/execute-prompt';
import { isGuid } from '../../../lib/utils/guid';

const APP_KEY = 'batch-phase-i-summaries';
const PROMPT_NAME = 'phase-i.summary';
const limiter = nextRateLimiter({ max: 5 });

const AUDIENCE_DESCRIPTIONS = {
  'general-audience': 'a general audience, avoiding technical jargon and explaining concepts in accessible terms',
  'technical-non-expert': 'a technical non-expert audience, using some technical terms but explaining complex concepts clearly',
  'technical-expert': 'a technical expert audience, using field-specific terminology and assuming domain knowledge',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  const {
    requestGuid = null,
    fileRef = null,
    summaryLength = 1,
    summaryLevel = 'technical-non-expert',
    overwrite = false,
  } = req.body || {};

  if (!requestGuid) return res.status(400).json({ error: 'requestGuid is required' });
  // Client-supplied id reaches a raw Dataverse key predicate via executePrompt →
  // grantRequestAdapter → DynamicsService.getRecord/updateRecord. Validate at the
  // route edge (trust-boundary contract; mirrors synthesize-reviews.js).
  if (!isGuid(requestGuid)) return res.status(400).json({ error: 'requestGuid must be a valid GUID' });
  if (!fileRef) return res.status(400).json({ error: 'fileRef is required' });

  let fileLoad;
  try {
    fileLoad = await loadFile(fileRef);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: `Failed to load file: ${err.message}` });
  }

  let result;
  try {
    result = await executePrompt({
      promptName: PROMPT_NAME,
      requestId: requestGuid,
      overrideVariables: {
        // The Executor enforces the cap via the prompt row's variable
        // declaration (dataClass=proposal_text, maxChars=100000). See
        // docs/EXECUTOR_CONTRACT.md § "Data classification + payload boundary"
        // and scripts/seed-phase-i-summary-prompt.js. Source in audit:
        //   executor.phase-i.summary.proposal_text
        proposal_text: fileLoad.text,
        summary_length: summaryLength,
        summary_length_suffix: summaryLength > 1 ? 's' : '',
        audience_description:
          AUDIENCE_DESCRIPTIONS[summaryLevel] || AUDIENCE_DESCRIPTIONS['technical-non-expert'],
      },
      runSource: 'Vercel Interactive',
      forceOverwrite: !!overwrite,
      actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
    });
  } catch (err) {
    console.error('[summarize-v2] executePrompt failed:', err.message);
    return res.status(500).json({
      error: 'Failed to summarize proposal',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      runId: err.runId || null,
    });
  }

  // Block path → HTTP 409 in the shape the UI expects (existingLength,
  // existingContent, recordModifiedOn on a single `conflict` object).
  if (result.blocked) {
    const c = result.conflicts.find(x => x.field === 'wmkf_ai_summary') || result.conflicts[0];
    return res.status(409).json({
      error: 'wmkf_ai_summary already populated — confirm overwrite to proceed',
      runId: result.runId,
      conflict: {
        field: c.field,
        existingLength: c.existingLength,
        existingContent: c.existingContent,
        recordModifiedOn: c.modifiedOn,
      },
    });
  }

  // Surface API usage to the per-user usage log.
  logUsage({
    userProfileId: access.profileId,
    appName: 'batch-phase-i',
    model: result.meta?.modelUsed,
    inputTokens: result.usage?.input_tokens || 0,
    outputTokens: result.usage?.output_tokens || 0,
    cacheCreationTokens: result.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
    latencyMs: 0, // Executor doesn't expose this yet — add to meta if needed
    status: 'success',
  });

  const summaryWrite = result.writeResults?.results?.find(r => r.output === 'summary');
  const writebackOk = !!summaryWrite?.ok;
  const writebackFailure = writebackOk ? null : (summaryWrite?.reason || 'writeback_failed');

  return res.status(200).json({
    summary: result.parsed?.summary || '',
    filename: fileLoad.filename,
    model: result.meta?.modelUsed || null,
    runId: result.runId,
    writtenToDynamics: writebackOk,
    writebackFailure,
    auditLogCreated: true, // Executor's audit-completeness invariant
    promptMeta: {
      source: 'dynamics',
      promptName: result.meta?.promptName,
      promptVersion: result.meta?.promptVersion,
      systemPromptChars: result.meta?.systemChars || 0,
      userPromptChars: result.meta?.bodyChars || 0,
    },
    cacheMeta: {
      cacheCreationTokens: result.usage?.cache_creation_input_tokens || 0,
      cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
      inputTokens: result.usage?.input_tokens || 0,
    },
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};
