/**
 * ClaudeReviewerService - Stage 1 of Expert Reviewer Finder
 *
 * Handles Claude API calls for:
 * 1. Analyzing proposals and generating reviewer suggestions with reasoning
 * 2. Generating reasoning for database-discovered candidates
 *
 * Anthropic transport goes through `LLMClient` (safeFetch SSRF allowlist,
 * AbortController-bound timeout, 429/529 retry, single fallback-model swap on
 * 529, structured usage logging on success/failure, API-key redaction in
 * thrown errors).
 */

import {
  parseAnalysisResponse,
  parseDiscoveredReasoningResponse,
  createProposalSummary,
  validateReviewerAnalysis,
  buildScorePromptParts,
} from '../../shared/config/prompts/reviewer-finder';
import { getModelForApp, getFallbackModelForApp } from '../../shared/config/baseConfig';
import { DEFAULT_REVIEWER_COUNT } from '../../shared/config/reviewerFinderPreferences';
import { LLMClient } from './llm-client.js';
import {
  resolveReviewerPrompt,
  REVIEWER_PROMPT_NAMES,
} from './reviewer-prompt-resolver.js';
import {
  composeAnalyzePrompt,
  composeScorePrompt,
} from './reviewer-prompt-composer.js';
import { mergeRequestContextIntoAnalysisResult } from './reviewer-request-context.js';
import {
  DATA_CLASSES,
  REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
  wrapUntrustedContent,
} from '../utils/ai-payload-boundary.js';

const DEBUG = process.env.DEBUG_REVIEWER_FINDER === 'true';

// Per-attempt hung-socket cap (ms) used when a reviewer search deadline is in
// effect: each Claude attempt is bounded by min(remaining budget, this), so a
// single stalled call can't silently consume the whole budget while the
// overall deadline AbortSignal bounds the total. See
// docs/REVIEWER_TIMEOUT_BUDGET_PLAN.md.
const REVIEWER_PER_ATTEMPT_CAP_MS = 180_000;
const ANALYZE_REPAIR_ATTEMPTS = 2;
const ANALYZE_REPAIR_MAX_TOKENS = 8192;
const ANALYZE_REPAIR_MIN_MS = 30_000;
const ANALYZE_TRUNCATION_REPAIR_MIN_MS = 60_000;

/** Normalize an aborted signal's reason into an Error to throw out of a loop. */
function abortError(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  const e = new Error('reviewer_time_budget_exceeded');
  e.code = 'reviewer_time_budget_exceeded';
  return e;
}

function hasParsedProposalInfo(proposalInfo) {
  return Object.values(proposalInfo || {}).some(value => String(value || '').trim().length > 0);
}

function isTruncationValidation(validation) {
  return (validation?.issues || []).some(issue => issue.code === 'truncated_response');
}

function canAttemptRepair({ signal, deadlineAt, minRepairMs }) {
  if (signal?.aborted) return false;
  if (deadlineAt == null) return true;
  return (deadlineAt - Date.now()) >= minRepairMs;
}

export function buildAnalyzeRepairInstructions(validation, reviewerCount) {
  const issues = (validation?.issues || [])
    .filter(issue => issue.severity !== 'warning')
    .map(issue => `- ${issue.code}: ${issue.message}`)
    .join('\n');
  if (!issues) return '';
  const truncation = isTruncationValidation(validation);
  return [
    truncation
      ? 'Your previous response appears truncated. Return a concise complete response in the same delimiter format.'
      : 'Your previous response failed validation. Return a corrected complete response in the same delimiter format.',
    `Validation issues to repair:\n${issues}`,
    `Provide exactly ${reviewerCount} distinct real reviewer suggestions when possible.`,
    'Every reviewer must include NAME, INSTITUTION, EXPERTISE, SENIORITY, REASONING, and SOURCE.',
    'Do not include placeholders, bracketed replacement text, duplicate people, or excluded names.',
  ].join('\n');
}

class ClaudeReviewerService {
  static get MODEL() {
    return getModelForApp('reviewer-finder');
  }
  static get FALLBACK_MODEL() {
    return getFallbackModelForApp('reviewer-finder');
  }
  // First-attempt output budget. Matches ANALYZE_REPAIR_MAX_TOKENS: a full
  // reviewer list (default 15, each with reasoning) does not fit in 4096, so the
  // old 4096 first attempt truncated by length and only the repair (8192) had
  // room. Starting at 8192 removes that asymmetry. See S286.
  static MAX_TOKENS = 8192;

  /**
   * Stage 1: Analyze proposal and generate reviewer suggestions
   *
   * @param {string} proposalText - Full text of the proposal
   * @param {string} apiKey - Optional Claude API key override (falls back to CLAUDE_API_KEY)
   * @param {Object} options
   * @param {string} options.additionalNotes
   * @param {string[]} options.excludedNames
   * @param {number} options.temperature
   * @param {number} options.reviewerCount
   * @param {Function} options.onProgress
   * @param {number|null} options.userProfileId
   * @param {'search'|'proposal_info'} options.analysisPurpose
   * @returns {Promise<Object>}
   */
  static async analyzeProposal(proposalText, apiKey, options = {}) {
    const {
      additionalNotes = '',
      excludedNames = [],
      temperature = 0.3,
      reviewerCount = DEFAULT_REVIEWER_COUNT,
      onProgress = () => {},
      userProfileId = null,
      signal = undefined,
      deadlineAt = undefined,
      analysisPurpose = 'search',
      requestContext = null,
    } = options;

    onProgress({ stage: 'analysis', status: 'starting', message: 'Starting proposal analysis...' });

    const proposalPayload = wrapUntrustedContent({
      text: proposalText,
      source: 'reviewer-finder.analyze.proposalText',
      dataClass: DATA_CLASSES.PROPOSAL_TEXT,
      maxChars: REVIEWER_FINDER_PROPOSAL_MAX_CHARS,
      label: 'research proposal',
    });

    onProgress({
      stage: 'analysis',
      status: 'payload_boundary',
      message: proposalPayload.metadata.truncated
        ? `Proposal text truncated to ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before AI analysis`
        : `Proposal text bounded at ${proposalPayload.metadata.transmittedChars.toLocaleString()} characters before AI analysis`,
      data: { aiPayloadBoundary: proposalPayload.metadata },
    });

    // Resolve the editable body (per-user override → Dataverse → code fallback)
    // and compose the final prompt with the code-owned A7 preamble. Fails loud
    // on structural store corruption; falls back to the code template only on a
    // transient Dataverse error.
    const resolved = await resolveReviewerPrompt(REVIEWER_PROMPT_NAMES.ANALYZE, { userProfileId });
    onProgress({
      stage: 'analysis',
      status: 'prompt_resolved',
      message: `Prompt source: ${resolved.source}${resolved.version != null ? ` v${resolved.version}` : ''}${resolved.overrideUsed ? ' (your edit)' : ''}${resolved.staleOverride ? ' — your edit is based on an older version' : ''}`,
      data: {
        promptProvenance: {
          name: REVIEWER_PROMPT_NAMES.ANALYZE,
          source: resolved.source,
          promptId: resolved.promptId,
          version: resolved.version,
          overrideUsed: resolved.overrideUsed,
          fallbackReason: resolved.fallbackReason,
          staleOverride: resolved.staleOverride,
        },
      },
    });

    // Surface the configured Claude model before the multi-minute call so the
    // live log is self-evidencing. A 529 fallback swap, if it happens, is
    // reported separately by the 'fallback' progress event below.
    onProgress({
      stage: 'analysis',
      status: 'model_resolved',
      message: `Model: ${this.MODEL}`,
      data: { model: this.MODEL, fallbackModel: this.FALLBACK_MODEL },
    });

    try {
      let repairInstructions = '';
      let finalInvalid = null;
      let lastMeta = {
        attempt: 0,
        maxTokens: this.MAX_TOKENS,
        stopReason: null,
        usedFallback: false,
        model: null,
      };

      for (let attempt = 1; attempt <= ANALYZE_REPAIR_ATTEMPTS; attempt += 1) {
        const maxTokens = repairInstructions && finalInvalid && isTruncationValidation(finalInvalid)
          ? ANALYZE_REPAIR_MAX_TOKENS
          : this.MAX_TOKENS;
        const prompt = composeAnalyzePrompt({
          body: resolved.body,
          proposalText: proposalPayload.text,
          nonces: [proposalPayload.nonce],
          additionalNotes,
          excludedNames,
          reviewerCount,
          repairInstructions,
          requestContext,
        });

        if (attempt > 1) {
          onProgress({
            stage: 'analysis',
            status: 'repairing',
            message: 'Retrying proposal analysis with repair instructions...',
            data: { attempt, maxTokens },
          });
        }

        const { text: response, usedFallback, model, stopReason } = await this._callLLM({
          prompt,
          apiKey,
          maxTokens,
          temperature,
          userProfileId,
          signal,
          deadlineAt,
        });
        lastMeta = { attempt, maxTokens, stopReason, usedFallback, model };

        if (usedFallback) {
          onProgress({
            stage: 'analysis',
            status: 'fallback',
            message: `Primary model overloaded, using fallback model (${model})`,
          });
        }

        if (DEBUG) {
          console.log('[ClaudeReviewerService] Response length:', response?.length || 0);
          console.log('[ClaudeReviewerService] Response preview (first 500 chars):', response?.substring(0, 500));
          console.log('[ClaudeReviewerService] Contains "REVIEWER:"?', response?.includes('REVIEWER:'));
          console.log('[ClaudeReviewerService] Contains "NAME:"?', response?.includes('NAME:'));
        }

        onProgress({ stage: 'analysis', status: 'parsing', message: 'Parsing Claude response...' });

        const parsed = mergeRequestContextIntoAnalysisResult(
          parseAnalysisResponse(response),
          requestContext,
        );

        if (DEBUG) {
          console.log('[ClaudeReviewerService] Parsed suggestions:', parsed.reviewerSuggestions?.length);
          console.log('[ClaudeReviewerService] First suggestion:', parsed.reviewerSuggestions?.[0]?.name);
          if (parsed.reviewerSuggestions?.length === 0) {
            console.log('[ClaudeReviewerService] WARNING: No suggestions parsed! Response snippet around PART 2:');
            const part2Index = response?.indexOf('PART 2');
            if (part2Index > -1) {
              console.log(response?.substring(part2Index, part2Index + 1000));
            }
          }
        } else if (parsed.reviewerSuggestions?.length === 0) {
          // Zero-result parsing failures are usually a markdown-decoration
          // drift. Log structural probe data unconditionally; only dump a
          // raw response window when DEBUG_REVIEWER_FINDER is on (Claude's
          // REASONING fields can echo proposal text, so the raw bytes are
          // treated as proposal-derived content for logging purposes).
          const responseStr = response || '';
          const reviewerIdx = responseStr.search(/REVIEWER/i);
          console.warn(
            '[ClaudeReviewerService] No suggestions parsed.',
            `responseLength=${responseStr.length}`,
            `containsReviewerToken=${reviewerIdx >= 0}`,
            `firstReviewerOffset=${reviewerIdx}`,
          );
          if (DEBUG && reviewerIdx >= 0) {
            const start = Math.max(0, reviewerIdx - 100);
            const end = Math.min(responseStr.length, reviewerIdx + 300);
            console.warn(
              `[ClaudeReviewerService] Window around first REVIEWER token (DEBUG):\n${responseStr.slice(start, end)}`,
            );
          }
        }

        const validation = validateReviewerAnalysis(parsed, {
          reviewerCount,
          stopReason,
          excludedNames,
          analysisPurpose,
        });
        const result = validation.sanitizedResult;

        if (validation.valid || (analysisPurpose === 'proposal_info' && hasParsedProposalInfo(result.proposalInfo))) {
          if (!validation.valid) {
            console.warn('Proposal-info analysis validation issues bypassed:', validation.issues);
          }
          onProgress({
            stage: 'analysis',
            status: 'complete',
            message: `Found ${result.reviewerSuggestions.length} suggestions`,
            data: {
              suggestionCount: result.reviewerSuggestions.length,
              attempt,
            },
          });

          return {
            success: true,
            ...result,
            validation,
            attempt,
            maxTokens,
            stopReason,
            usedFallback,
            model,
            promptProvenance: {
              name: REVIEWER_PROMPT_NAMES.ANALYZE,
              source: resolved.source,
              promptId: resolved.promptId,
              version: resolved.version,
              overrideUsed: resolved.overrideUsed,
              fallbackReason: resolved.fallbackReason,
              staleOverride: resolved.staleOverride,
            },
          };
        }

        finalInvalid = validation;
        console.warn('Analysis validation issues:', validation.issues);

        if (attempt >= ANALYZE_REPAIR_ATTEMPTS) break;
        const truncation = isTruncationValidation(validation);
        const minRepairMs = truncation ? ANALYZE_TRUNCATION_REPAIR_MIN_MS : ANALYZE_REPAIR_MIN_MS;
        if (!canAttemptRepair({ signal, deadlineAt, minRepairMs })) break;
        repairInstructions = validation.issues.some(issue => issue.code === 'empty_parse_failure')
          ? ''
          : buildAnalyzeRepairInstructions(validation, reviewerCount);
      }

      onProgress({
        stage: 'analysis',
        status: 'analysis_invalid',
        message: 'Proposal analysis returned an incomplete response after retry.',
        data: { validation: finalInvalid, attempt: lastMeta.attempt },
      });
      return {
        success: false,
        status: 'analysis_invalid',
        validation: {
          valid: false,
          issues: finalInvalid?.issues || [],
          severity: finalInvalid?.severity || 'error',
        },
        attempt: lastMeta.attempt,
        maxTokens: lastMeta.maxTokens,
        stopReason: lastMeta.stopReason,
        usedFallback: lastMeta.usedFallback,
        model: lastMeta.model,
        promptProvenance: {
          name: REVIEWER_PROMPT_NAMES.ANALYZE,
          source: resolved.source,
          promptId: resolved.promptId,
          version: resolved.version,
          overrideUsed: resolved.overrideUsed,
          fallbackReason: resolved.fallbackReason,
          staleOverride: resolved.staleOverride,
        },
      };
    } catch (error) {
      onProgress({ stage: 'analysis', status: 'error', message: error.message });
      throw error;
    }
  }

  /**
   * Stage 2 Helper: Generate reasoning for database-discovered candidates
   *
   * @param {Object} proposalInfo
   * @param {Array} candidates
   * @param {string} apiKey
   * @param {Function} onProgress
   * @param {number|null} userProfileId
   * @returns {Promise<Array>}
   */
  static async generateDiscoveredReasoning(proposalInfo, candidates, apiKey, onProgress = () => {}, userProfileId = null, options = {}) {
    const { signal, deadlineAt } = options;
    if (!candidates || candidates.length === 0) {
      return [];
    }

    onProgress({
      stage: 'reasoning',
      status: 'starting',
      message: `Generating reasoning for ${candidates.length} discovered candidates...`,
    });

    // Resolve the score-candidates body ONCE for the whole call (not per batch —
    // avoids N Dataverse fetches). Fails loud on structural store corruption.
    const resolved = await resolveReviewerPrompt(REVIEWER_PROMPT_NAMES.SCORE_CANDIDATES, { userProfileId });
    onProgress({
      stage: 'reasoning',
      status: 'prompt_resolved',
      message: `Scoring prompt source: ${resolved.source}${resolved.version != null ? ` v${resolved.version}` : ''}${resolved.overrideUsed ? ' (your edit)' : ''}${resolved.staleOverride ? ' — your edit is based on an older version' : ''}`,
      data: {
        promptProvenance: {
          name: REVIEWER_PROMPT_NAMES.SCORE_CANDIDATES,
          source: resolved.source,
          promptId: resolved.promptId,
          version: resolved.version,
          overrideUsed: resolved.overrideUsed,
          fallbackReason: resolved.fallbackReason,
          staleOverride: resolved.staleOverride,
        },
      },
    });

    // The proposal summary is constant across batches — build it once.
    const proposalSummary = createProposalSummary(proposalInfo);

    const BATCH_SIZE = 10;
    const results = [];

    // Index-bearing batch loop; not consolidated onto lib/utils/chunk.js (needs i). See docs/CHUNK_CONSOLIDATION_PLAN.md.
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      // Deadline reached between batches → stop scheduling more work and let the
      // route surface the timeout (don't churn through the rest producing
      // failed-placeholder rows).
      if (signal?.aborted) {
        throw abortError(signal);
      }
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);

      onProgress({
        stage: 'reasoning',
        status: 'processing',
        message: `Processing batch ${batchNum}/${totalBatches}...`,
      });

      const prompt = composeScorePrompt({
        body: resolved.body,
        ...buildScorePromptParts(proposalSummary, batch),
      });

      try {
        const { text: response, usedFallback, model } = await this._callLLM({
          prompt,
          apiKey,
          maxTokens: 1024,
          temperature: 0.3,
          userProfileId,
          signal,
          deadlineAt,
        });

        if (usedFallback) {
          onProgress({
            stage: 'reasoning',
            status: 'fallback',
            message: `Batch ${batchNum}: Primary model overloaded, using fallback (${model})`,
          });
        }

        if (DEBUG) {
          console.log(`[ClaudeReviewerService] Reasoning batch ${batchNum}:`, response?.substring(0, 300));
        }

        const enhanced = parseDiscoveredReasoningResponse(response, batch);

        for (const candidate of enhanced) {
          if (!candidate.generatedReasoning) {
            if (DEBUG) {
              console.warn(`[ClaudeReviewerService] No reasoning parsed for: ${candidate.name}`);
            }
            candidate.generatedReasoning = 'Reasoning not available';
            candidate.isRelevant = true;
          }
          if (usedFallback) {
            candidate.reasoningFromFallback = true;
          }
        }

        results.push(...enhanced);
      } catch (error) {
        // A deadline/cancel abort must NOT be swallowed as a per-batch failure —
        // rethrow so the route surfaces the timeout instead of churning the
        // remaining batches into failed placeholders.
        if (signal?.aborted) {
          throw error;
        }
        console.error(`Error generating reasoning for batch ${batchNum}:`, error.message);
        results.push(...batch.map(c => ({
          ...c,
          generatedReasoning: 'Reasoning generation failed',
          seniorityEstimate: 'Unknown',
          reasoningFailed: true,
        })));
      }

      if (i + BATCH_SIZE < candidates.length) {
        if (signal?.aborted) {
          throw abortError(signal);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    onProgress({
      stage: 'reasoning',
      status: 'complete',
      message: `Generated reasoning for ${results.length} candidates`,
    });

    return results;
  }

  /**
   * Single Claude call via LLMClient. Retry + 529 fallback swap + usage logging
   * + key redaction live in LLMClient. We surface `usedFallback` by comparing
   * the actually-used model against the configured primary.
   */
  static async _callLLM({ prompt, apiKey, maxTokens, temperature, userProfileId, signal, deadlineAt }) {
    const primary = this.MODEL;
    const fallback = this.FALLBACK_MODEL;

    const clientOpts = {
      apiKey: apiKey || process.env.CLAUDE_API_KEY,
      model: primary,
      fallbackModel: fallback && fallback !== primary ? fallback : null,
      appName: 'reviewer-finder',
      userProfileId,
    };
    // When a search deadline is in effect, bound this attempt by the smaller of
    // the remaining budget and the per-attempt hung-socket cap. Without a
    // deadline, leave the LLMClient default (120s) untouched.
    if (deadlineAt != null) {
      const remainingMs = deadlineAt - Date.now();
      clientOpts.timeoutMs = Math.max(1, Math.min(remainingMs, REVIEWER_PER_ATTEMPT_CAP_MS));
    }
    const client = new LLMClient(clientOpts);

    const { text, model, stopReason } = await client.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
      temperature,
      signal,
    });

    return {
      text,
      model: model || primary,
      usedFallback: !!model && model !== primary,
      stopReason: stopReason || null,
    };
  }
}

export { ClaudeReviewerService };
