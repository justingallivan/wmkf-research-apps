/**
 * Expertise Finder — batch proposal-match service (Route→Service Consolidation
 * Plan, Stage 5).
 *
 * Holds the business logic for POST /api/expertise-finder/batch-match; the
 * route is a thin shell (method dispatch, app-access guard, model-override
 * warm at ROUTE level per the Stage 4 gate contract, input validation, DAL
 * context, HTTP mapping).
 *
 * Pipeline: proposal → SharePoint folder → Phase_I_Staff_Version PDF →
 * pdf-parse → Claude → schema-validate → persist to expertise_matches.
 *
 * Contract (plan Decision 3):
 *   - plain argument object, never req/res;
 *   - returns the exact 200 envelope the route historically sent;
 *   - throws ServiceHttpError for every historical non-2xx envelope; the
 *     multi-key envelopes (requestNumber/folder/availableFiles/filename/
 *     rawResponse/details) are set as explicit `body` (Decision 3 — not
 *     `{ error }`-shaped);
 *   - usage logging (success AND unexpected-error) stays here with the
 *     pipeline it measures;
 *   - ASSUMES a trusted DAL context already exists — never establishes one.
 */

import pdf from 'pdf-parse';
import { sql } from '@vercel/postgres';
import { getModelForApp, getFallbackModelForApp } from '../../../shared/config/baseConfig';
import { buildCacheableSystemPrompt, buildUserPrompt } from '../../../shared/config/prompts/expertise-finder';
import { logUsage, estimateCostCents } from '../../utils/usage-logger';
import { LLMClient } from '../llm-client';
import { createHash } from 'crypto';
import * as sharepointDocumentLocationAdapter from '../../dataverse/adapters/sharepoint-document-location.js';
import { GraphService } from '../graph-service';
import {
  DATA_CLASSES,
  EXPERTISE_FINDER_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../../utils/ai-payload-boundary';
import { validateAiJson } from '../../utils/ai-output-schema';
import { EXPERTISE_MATCH_SCHEMA } from '../../../shared/config/expertise-finder-output-schema';
import { ServiceHttpError } from '../service-http-error';

const APP_KEY = 'expertise-finder';

/**
 * Match a single Dynamics proposal to the expertise roster.
 *
 * @param {Object} args
 * @param {string} args.requestId - Dynamics akoya_request GUID (presence already validated by the shell)
 * @param {string} [args.requestNumber] - for display/logging
 * @param {string} [args.additionalNotes]
 * @param {*} args.profileId - authenticated user profile id (from the shell's access gate)
 * @returns {Promise<{ success: true, matchId: *, requestNumber: *, results: Object, metadata: Object }>}
 * @throws {ServiceHttpError} with the historical status + envelope for every failure path
 */
export async function batchMatch({ requestId, requestNumber, additionalNotes, profileId }) {
  const startTime = Date.now();
  const primaryModel = getModelForApp(APP_KEY);
  const fallbackModel = getFallbackModelForApp(APP_KEY);

  try {
    // Step 1: Resolve SharePoint folder for this request
    const locResult = await sharepointDocumentLocationAdapter.findByRegardingObject(requestId, {
      select: 'name,relativeurl,_parentsiteorlocation_value',
    });

    if (!locResult.records.length) {
      throw new ServiceHttpError('No SharePoint document location found for this request', {
        httpStatus: 404,
        body: {
          error: 'No SharePoint document location found for this request',
          requestNumber,
        },
      });
    }

    // Resolve parent location to get library name
    const parentIds = [...new Set(
      locResult.records.map(r => r._parentsiteorlocation_value).filter(Boolean)
    )];

    let libraryName = 'akoya_request';
    if (parentIds.length > 0) {
      try {
        const parentResult = await sharepointDocumentLocationAdapter.findByParentIds(parentIds, {
          select: 'relativeurl',
          top: 5,
        });
        if (parentResult.records.length > 0 && parentResult.records[0].relativeurl) {
          libraryName = parentResult.records[0].relativeurl;
        }
      } catch (e) {
        // Fall back to default
      }
    }

    const folderPath = locResult.records[0].relativeurl;

    // Step 2: List files and find Phase_I_Staff_Version PDF
    const files = await GraphService.listFiles(libraryName, folderPath);
    const staffVersionFile = files.find(f =>
      f.name.includes('Phase_I_Staff_Version') && f.name.toLowerCase().endsWith('.pdf')
    );

    if (!staffVersionFile) {
      throw new ServiceHttpError('No Phase_I_Staff_Version PDF found in SharePoint folder', {
        httpStatus: 404,
        body: {
          error: 'No Phase_I_Staff_Version PDF found in SharePoint folder',
          requestNumber,
          folder: folderPath,
          availableFiles: files.map(f => f.name),
        },
      });
    }

    // Step 3: Download and extract text
    const { buffer } = await GraphService.downloadFileByPath(libraryName, folderPath, staffVersionFile.name);
    const pdfData = await pdf(buffer);
    const proposalText = pdfData.text;

    if (!proposalText || proposalText.trim().length < 100) {
      throw new ServiceHttpError('PDF appears to be empty or contains insufficient text', {
        httpStatus: 400,
        body: {
          error: 'PDF appears to be empty or contains insufficient text',
          requestNumber,
          filename: staffVersionFile.name,
        },
      });
    }

    // Step 4: Fetch active roster and run Claude
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new ServiceHttpError('Claude API key not configured on server', { httpStatus: 500 });
    }

    const rosterResult = await sql`
      SELECT * FROM expertise_roster WHERE is_active = true ORDER BY role_type, name
    `;

    if (rosterResult.rows.length === 0) {
      throw new ServiceHttpError('No active roster members found', { httpStatus: 400 });
    }

    // See match.js for the cache split rationale. Batch runs hit the cache
    // hardest — every proposal after the first reuses the same system
    // prefix (task + rules + roster + output spec).
    const systemPrompt = buildCacheableSystemPrompt(rosterResult.rows);
    const proposalPayload = wrapUntrustedContent({
      text: proposalText,
      source: 'expertise-finder.batch-match.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: EXPERTISE_FINDER_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });
    const userPrompt = buildUserPrompt(proposalPayload.text, additionalNotes);

    let result;
    let modelUsed = primaryModel;

    try {
      result = await callClaude(apiKey, primaryModel, systemPrompt, userPrompt);
    } catch (primaryError) {
      console.warn(`[ExpertiseFinder:Batch] Primary model (${primaryModel}) failed: ${primaryError.message}, trying fallback...`);
      modelUsed = fallbackModel;
      result = await callClaude(apiKey, fallbackModel, systemPrompt, userPrompt);
    }

    const latencyMs = Date.now() - startTime;

    // Step 5: Parse response
    let matchResults;
    try {
      const text = result.content[0].text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
      matchResults = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[ExpertiseFinder:Batch] Failed to parse Claude response:', parseError.message);
      throw new ServiceHttpError('Failed to parse matching results', {
        httpStatus: 500,
        body: {
          error: 'Failed to parse matching results',
          requestNumber,
          rawResponse: result.content[0].text,
        },
      });
    }

    // Validate against the per-app schema (A7 Part 5) before persisting to
    // expertise_matches — drop any keys an injected model added.
    const validatedMatch = validateAiJson(matchResults, EXPERTISE_MATCH_SCHEMA);
    if (!validatedMatch.ok) {
      console.error('[ExpertiseFinder:Batch] Output schema validation failed:', validatedMatch.errors.join('; '));
      throw new ServiceHttpError('Claude returned structurally invalid matching results', {
        httpStatus: 502,
        body: { error: 'Claude returned structurally invalid matching results', requestNumber },
      });
    }
    matchResults = validatedMatch.value;

    // Step 6: Save to database
    const textHash = createHash('sha256').update(proposalText).digest('hex').substring(0, 64);
    const inputTokens = result.usage?.input_tokens || 0;
    const outputTokens = result.usage?.output_tokens || 0;
    const costCents = estimateCostCents(modelUsed, inputTokens, outputTokens) || 0;

    const saveResult = await sql`
      INSERT INTO expertise_matches (
        user_profile_id, proposal_title, proposal_filename,
        proposal_text_hash, match_results, model_used,
        input_tokens, output_tokens, estimated_cost_cents
      ) VALUES (
        ${profileId},
        ${matchResults.proposal_summary?.title || requestNumber || 'Untitled'},
        ${staffVersionFile.name},
        ${textHash},
        ${JSON.stringify(matchResults)},
        ${modelUsed},
        ${inputTokens},
        ${outputTokens},
        ${costCents}
      )
      RETURNING id
    `;

    logUsage({
      userProfileId: profileId,
      appName: APP_KEY,
      model: modelUsed,
      inputTokens,
      outputTokens,
      latencyMs,
      status: 'success',
    });

    return {
      success: true,
      matchId: saveResult.rows[0].id,
      requestNumber,
      results: matchResults,
      metadata: {
        model: modelUsed,
        inputTokens,
        outputTokens,
        estimatedCostCents: costCents,
        latencyMs,
        rosterSize: rosterResult.rows.length,
        filename: staffVersionFile.name,
      },
    };
  } catch (error) {
    // Typed-error passthrough FIRST (P1m note 4) — the historical early
    // returns never usage-logged an error, only the unexpected catch did.
    if (error instanceof ServiceHttpError) throw error;

    const latencyMs = Date.now() - startTime;
    console.error('[ExpertiseFinder:Batch] Match error:', error);

    logUsage({
      userProfileId: profileId,
      appName: APP_KEY,
      model: primaryModel,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: 'error',
      errorMessage: error.message,
    });

    throw new ServiceHttpError('Failed to process proposal', {
      httpStatus: 500,
      body: {
        error: 'Failed to process proposal',
        requestNumber,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
    });
  }
}

async function callClaude(apiKey, model, systemPrompt, userPrompt) {
  // appName omitted — service does its own logging with modelUsed tracking.
  const claude = new LLMClient({ apiKey, model });
  const r = await claude.complete({
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0.2,
  });
  return {
    content: r.content,
    usage: { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens },
    model: r.model,
  };
}
