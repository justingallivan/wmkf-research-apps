/**
 * Phase I Dynamics — single-request summarize + writeback service
 * (Route→Service Consolidation Plan, Stage 5).
 *
 * Holds the business logic for POST /api/phase-i-dynamics/summarize; the
 * route is a thin shell (method dispatch, app-access guard, rate limit,
 * model-override warm, input validation, DAL context, HTTP mapping).
 *
 * Flow (moved verbatim): overwrite preflight (ETag captured for optimistic
 * concurrency) → loadFile → untrusted-content wrapping → LLM → conditional
 * writeback to akoya_request.wmkf_ai_summary (If-Match; 412 surfaces as the
 * 'conflict' category, never a silent overwrite) → append-only wmkf_ai_run
 * audit row (best-effort; boolean surfaces as auditLogCreated).
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 envelope;
 *   - throws ServiceHttpError for the 409 overwrite-conflict (explicit body —
 *     it carries a `conflict` object) and the 502 empty-summary;
 *   - loadFile/LLM errors propagate raw — the shell keeps the historical
 *     err.status→{error} mapping and the 500 dev-details fallback;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import {
  BASE_CONFIG,
  KECK_GUIDELINES,
  getModelForApp,
} from '../../../shared/config';
import {
  createPhaseISummarizationPrompt,
  PHASE_I_PROMPT_VERSION,
} from '../../../shared/config/prompts/phase-i-summaries';
import { createLLMClient } from '../llm-client';
import { loadFile } from '../../utils/file-loader';
import { DynamicsService } from '../dynamics-service';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import {
  DATA_CLASSES,
  BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
  buildUntrustedContentPreamble,
} from '../../utils/ai-payload-boundary';
import { ServiceHttpError } from '../service-http-error';

/**
 * Summarize a Phase I proposal and write the narrative back to Dynamics.
 *
 * @param {Object} args
 * @param {string} args.requestGuid - GUID (already validated by the shell)
 * @param {Object} args.fileRef - FileRef (presence already validated by the shell)
 * @param {number} [args.summaryLength]
 * @param {string} [args.summaryLevel]
 * @param {boolean} [args.overwrite]
 * @param {string} args.apiKey
 * @param {*} args.profileId
 * @param {string|null} args.actingUserSystemId
 * @returns {Promise<{ summary, filename, model, writtenToDynamics, writebackFailure, auditLogCreated }>}
 * @throws {ServiceHttpError} 409 existing-summary conflict (explicit body), 502 empty summary
 */
export async function summarizeToDynamics({
  requestGuid,
  fileRef,
  summaryLength = 1,
  summaryLevel = 'technical-non-expert',
  overwrite = false,
  apiKey,
  profileId,
  actingUserSystemId = null,
}) {
  // This surface only reads/writes akoya_request by ID — restrictions don't apply.

  // ─── Pre-flight: don't clobber existing wmkf_ai_summary ─────────────────
  // User-initiated flows should never silently overwrite prior analyses.
  // Backend/PowerAutomate flows can skip this check; they're authoritative reruns.
  //
  // Capture the record's @odata.etag so the PATCH below can use If-Match for
  // optimistic concurrency — closes the TOCTOU gap between this read and the
  // write. If another caller has updated the row in between, PATCH returns 412.
  let preflightEtag = null;
  if (!overwrite) {
    const existing = await grantRequestAdapter.getById(requestGuid, {
      select: 'wmkf_ai_summary,modifiedon',
    });
    const current = (existing?.wmkf_ai_summary || '').trim();
    if (current.length > 0) {
      throw new ServiceHttpError('wmkf_ai_summary already populated — confirm overwrite to proceed', {
        httpStatus: 409,
        body: {
          error: 'wmkf_ai_summary already populated — confirm overwrite to proceed',
          conflict: {
            field: 'wmkf_ai_summary',
            existingLength: current.length,
            existingContent: current,
            recordModifiedOn: existing?.modifiedon || null,
          },
        },
      });
    }
    preflightEtag = existing?._etag || null;
  }

  const fileLoad = await loadFile(fileRef);
  const model = getModelForApp('batch-phase-i');
  // A7 Part 2: the proposal is grantee-authored — wrap it in nonce-bearing
  // sentinels and prepend the hardening preamble so instructions embedded in
  // the proposal cannot hijack a summary that writes back to Dynamics.
  const proposalPayload = wrapUntrustedContent({
    text: fileLoad.text,
    source: 'phase-i-dynamics.summarize.proposalText',
    dataClass: DATA_CLASSES.PROPOSAL_TEXT,
    maxChars: BATCH_PHASE_I_PROPOSAL_MAX_CHARS,
    label: 'proposal',
  });
  const prompt = `${buildUntrustedContentPreamble([proposalPayload.nonce])}\n\n${createPhaseISummarizationPrompt(
    proposalPayload.text,
    summaryLength,
    summaryLevel,
    KECK_GUIDELINES,
  )}`;

  // ─── Call Claude ────────────────────────────────────────────────────────
  // Routed through the canonical LLMClient: SSRF allowlist, abortable
  // timeout, 429/529 retry + fallback, API-key redaction, and usage logging
  // (success + failure) all handled by the client — appName drives logUsage.
  let summaryText, modelUsed;
  try {
    const llm = createLLMClient({
      apiKey,
      model,
      appName: 'batch-phase-i',
      userProfileId: profileId,
    });
    const resp = await llm.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS,
      temperature: BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE,
    });
    summaryText = resp.text || '';
    modelUsed = resp.model || model;
  } catch (err) {
    await tryLogAiRun({
      requestGuid,
      model,
      status: 'failed',
      rawOutput: { error: err.message },
      rawOutputRetention: 'full',
      notes: `Phase I Dynamics summarize — Claude call failed (${fileLoad.filename})`,
      actingUserSystemId,
    });
    throw err;
  }

  if (!summaryText || summaryText.trim().length < 20) {
    await tryLogAiRun({
      requestGuid,
      model: modelUsed,
      status: 'failed',
      rawOutput: { error: 'empty-summary', raw: summaryText },
      rawOutputRetention: 'full',
      notes: `Phase I Dynamics summarize — empty summary (${fileLoad.filename})`,
      actingUserSystemId,
    });
    throw new ServiceHttpError('Claude returned an empty summary', { httpStatus: 502 });
  }

  // ─── Writeback to akoya_request.wmkf_ai_summary ─────────────────────────
  // Uses If-Match with the preflight ETag (when we have one) so concurrent
  // edits surface as 412 instead of silently overwriting.
  let writebackOk = false;
  let writebackFailureCategory = null;
  try {
    await grantRequestAdapter.updateById(
      requestGuid,
      { wmkf_ai_summary: summaryText },
      {
        ...(preflightEtag ? { ifMatch: preflightEtag } : {}),
        ...(actingUserSystemId ? { actingUserSystemId } : {}),
      },
    );
    writebackOk = true;
  } catch (err) {
    writebackFailureCategory = err.status === 412 ? 'conflict' : 'writeback_failed';
    console.error('[PhaseIDynamics:summarize] wmkf_ai_summary writeback failed:', err.message);
  }

  // ─── Append-only audit row ──────────────────────────────────────────────
  // Category label keeps raw Dynamics error out of the audit memo (which is
  // itself stored in Dynamics and visible to more users than the API caller).
  // Retention: the summary itself lands on `akoya_request.wmkf_ai_summary`,
  // so the audit row only needs correlation metadata, not a duplicate
  // narrative. Parity with summarize-v2's prompt-row `rawOutputRetention`.
  // On writeback failure (`needs_review`), the duplicate doesn't exist on
  // the request yet — but the user retained the response and can retry; the
  // hash is still sufficient for after-the-fact correlation.
  const auditLogCreated = await tryLogAiRun({
    requestGuid,
    model: modelUsed,
    status: writebackOk ? 'completed' : 'needs_review',
    rawOutput: { summary: summaryText, filename: fileLoad.filename, summaryLength, summaryLevel },
    rawOutputRetention: 'hash',
    notes: writebackOk
      ? `Phase I Dynamics summarize (${fileLoad.filename}) — wmkf_ai_summary updated`
      : `Phase I Dynamics summarize (${fileLoad.filename}) — writeback ${writebackFailureCategory}`,
    actingUserSystemId,
  });

  return {
    summary: summaryText,
    filename: fileLoad.filename,
    model: modelUsed,
    writtenToDynamics: writebackOk,
    // Category only — internal Dynamics error details stay in server logs.
    writebackFailure: writebackFailureCategory,
    auditLogCreated,
  };
}

// Returns true when the audit row was successfully created. Failures are
// logged but not rethrown — the user-facing flow must continue — however the
// boolean bubbles to the response as `auditLogCreated` so monitoring can
// alert on audit gaps. logAiRun stays on raw DynamicsService (non-entity
// transport); the trusted context is established by the route shell.
async function tryLogAiRun({ requestGuid, model, status, rawOutput, rawOutputRetention, notes, actingUserSystemId }) {
  if (!requestGuid) return false;
  try {
    await DynamicsService.logAiRun({
      requestGuid,
      taskType: 'summary',
      model,
      promptVersion: PHASE_I_PROMPT_VERSION,
      status,
      rawOutput,
      rawOutputRetention,
      notes,
      actingUserSystemId,
    });
    return true;
  } catch (err) {
    console.warn(`[PhaseIDynamics:summarize] logAiRun failed (non-fatal): ${err.message}`);
    return false;
  }
}
