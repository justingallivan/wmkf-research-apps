/**
 * PanelReviewService - DB CRUD + orchestration for Virtual Review Panel
 *
 * Manages the full review pipeline:
 *   Stage 0 (optional): Pre-review intelligence — extract claims, search databases, synthesize
 *   Stage 1 (optional): Claim verification — fan out to all LLMs
 *   Stage 2: Structured review — fan out to all LLMs with reviewer form
 *   Synthesis: Claude summarizes consensus, disagreements, questions
 *
 * Results are persisted to DB as they arrive for audit/replay.
 */

import { sql } from '@vercel/postgres';
import { createHash } from 'crypto';
import { MultiLLMService } from './multi-llm-service';
import { LiteratureSearchService } from './literature-search-service';
import { estimateCostCents } from '../utils/usage-logger';
import {
  createClaimExtractionPrompt,
  createSearchCollationPrompt,
  createIntelligenceSynthesisPrompt,
  assembleIntelligenceBlock,
  createClaimVerificationPrompt,
  createPerplexityClaimVerificationPrompt,
  createStructuredReviewPrompt,
  createDevilsAdvocatePrompt,
  createPanelSynthesisPrompt,
  parseJSONResponse,
} from '../../shared/config/prompts/virtual-review-panel';
import { getModelForApp } from '../../shared/config/baseConfig';
import { validateAiJson } from '../utils/ai-output-schema';
import { VRP_OUTPUT_SCHEMAS } from '../../shared/config/virtual-review-panel-output-schema';

const SYSTEM_PROMPT = 'You are a thoughtful scientific peer reviewer for the W. M. Keck Foundation, which funds high-risk, high-reward research. Evaluate both upside potential and genuine concerns with equal rigor. The Foundation embraces risk when the potential payoff justifies it. Respond only with valid JSON — no markdown, no commentary outside the JSON object.';

export class PanelReviewService {

  // ============================================
  // DB OPERATIONS
  // ============================================

  static async createPanelReview(userProfileId, { proposalTitle, proposalFilename, proposalText, config }) {
    const textHash = createHash('sha256').update(proposalText).digest('hex');
    const result = await sql`
      INSERT INTO panel_reviews (user_profile_id, proposal_title, proposal_filename, proposal_text_hash, config, status)
      VALUES (${userProfileId}, ${proposalTitle || 'Untitled Proposal'}, ${proposalFilename || null}, ${textHash}, ${JSON.stringify(config)}, 'pending')
      RETURNING id
    `;
    return result.rows[0].id;
  }

  static async updatePanelReview(id, updates) {
    const fields = [];
    const values = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (key === 'panelSummary' || key === 'costBreakdown' || key === 'config') {
        fields.push(`${dbKey} = $${paramIdx++}`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${dbKey} = $${paramIdx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) return;
    values.push(id);

    await sql.query(
      `UPDATE panel_reviews SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      values
    );
  }

  static async createReviewItem(panelReviewId, provider, model, stage) {
    const result = await sql`
      INSERT INTO panel_review_items (panel_review_id, llm_provider, llm_model, stage, status, started_at)
      VALUES (${panelReviewId}, ${provider}, ${model}, ${stage}, 'in_progress', NOW())
      RETURNING id
    `;
    return result.rows[0].id;
  }

  static async updateReviewItem(id, updates) {
    const fields = [];
    const values = [];
    let paramIdx = 1;

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (key === 'parsedResponse') {
        fields.push(`${dbKey} = $${paramIdx++}`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${dbKey} = $${paramIdx++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) return;
    values.push(id);

    await sql.query(
      `UPDATE panel_review_items SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      values
    );
  }

  static async getPanelReview(id) {
    const review = await sql`SELECT * FROM panel_reviews WHERE id = ${id}`;
    if (review.rows.length === 0) return null;

    const items = await sql`
      SELECT * FROM panel_review_items WHERE panel_review_id = ${id} ORDER BY created_at
    `;

    return { ...review.rows[0], items: items.rows };
  }

  static async getPanelReviewHistory(userProfileId, limit = 20) {
    const result = await sql`
      SELECT id, proposal_title, proposal_filename, status, current_stage,
             total_cost_cents, cost_breakdown, started_at, completed_at, created_at
      FROM panel_reviews
      WHERE user_profile_id = ${userProfileId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.rows;
  }

  // ============================================
  // ORCHESTRATION
  // ============================================

  /**
   * Run the full panel review pipeline
   *
   * @param {number} panelReviewId - DB row ID
   * @param {string} proposalText - Full proposal text
   * @param {string[]} providers - LLM providers to use
   * @param {Object} options
   * @param {boolean} options.includeClaimVerification - Run Stage 1
   * @param {boolean} options.includeIntelligencePass - Run Stage 0
   * @param {Object} options.loggingContext - { userProfileId, appName }
   * @param {Function} options.sendEvent - SSE event sender
   * @returns {Promise<Object>} Final panel summary
   */
  static async runFullPanel(panelReviewId, proposalText, providers, options = {}) {
    const {
      includeClaimVerification = true,
      includeIntelligencePass = false,
      includeDevilsAdvocate = false,
      allowedProviders = providers,
      loggingContext = {},
      sendEvent = () => {},
    } = options;

    await this.updatePanelReview(panelReviewId, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });

    let intelligenceBlock = null;
    let claimVerificationResults = null;

    try {
      // Stage 0: Pre-Review Intelligence (optional)
      if (includeIntelligencePass) {
        sendEvent('stage_start', { stage: 'intelligence', message: 'Starting pre-review intelligence pass...' });
        await this.updatePanelReview(panelReviewId, { currentStage: 'intelligence' });

        intelligenceBlock = await this._runIntelligencePass(
          panelReviewId, proposalText, loggingContext, sendEvent, allowedProviders
        );

        sendEvent('stage_complete', {
          stage: 'intelligence',
          message: intelligenceBlock
            ? `Intelligence pass complete — found ${intelligenceBlock.mostRelevantPapers?.length || 0} relevant papers, ${intelligenceBlock.activeGroups?.length || 0} active groups`
            : 'Intelligence pass completed with partial results',
          intelligenceBlock,
        });
      }

      // Stage 1: Claim Verification (optional)
      if (includeClaimVerification) {
        sendEvent('stage_start', { stage: 'claim_verification', message: 'Starting claim verification...' });
        await this.updatePanelReview(panelReviewId, { currentStage: 'claim_verification' });

        claimVerificationResults = await this._runStage(
          panelReviewId, proposalText, providers, 'claim_verification', loggingContext, sendEvent,
          null, intelligenceBlock
        );

        const successCount = claimVerificationResults.filter(r => r.success).length;
        sendEvent('stage_complete', {
          stage: 'claim_verification',
          message: `Claim verification complete (${successCount}/${providers.length} succeeded)`,
          results: claimVerificationResults,
        });
      }

      // Stage 2: Structured Review
      sendEvent('stage_start', { stage: 'structured_review', message: 'Starting structured review...' });
      await this.updatePanelReview(panelReviewId, { currentStage: 'structured_review' });

      const structuredReviewResults = await this._runStage(
        panelReviewId, proposalText, providers, 'structured_review', loggingContext, sendEvent,
        claimVerificationResults, intelligenceBlock
      );

      const reviewSuccessCount = structuredReviewResults.filter(r => r.success).length;
      sendEvent('stage_complete', {
        stage: 'structured_review',
        message: `Structured review complete (${reviewSuccessCount}/${providers.length} succeeded)`,
        results: structuredReviewResults,
      });

      // Check minimum viable reviews (need at least 2)
      if (reviewSuccessCount < 2) {
        throw new Error(`Only ${reviewSuccessCount} review(s) succeeded — need at least 2 for synthesis`);
      }

      // Devil's Advocate (optional) — single adversarial review after structured reviews
      let devilsAdvocateResult = null;
      if (includeDevilsAdvocate) {
        sendEvent('stage_start', { stage: 'devils_advocate', message: 'Starting devil\'s advocate review...' });
        await this.updatePanelReview(panelReviewId, { currentStage: 'devils_advocate' });

        devilsAdvocateResult = await this._runDevilsAdvocate(
          panelReviewId, proposalText, providers, structuredReviewResults, intelligenceBlock, loggingContext, sendEvent
        );

        if (devilsAdvocateResult?.success) {
          sendEvent('stage_complete', {
            stage: 'devils_advocate',
            message: `Devil's advocate review complete (${devilsAdvocateResult.providerName})`,
            result: devilsAdvocateResult,
          });
        } else {
          sendEvent('stage_complete', {
            stage: 'devils_advocate',
            message: 'Devil\'s advocate review failed — proceeding without it',
          });
          devilsAdvocateResult = null;
        }
      }

      // Synthesis
      sendEvent('stage_start', { stage: 'synthesis', message: 'Synthesizing panel summary...' });
      await this.updatePanelReview(panelReviewId, { currentStage: 'synthesis' });

      const panelSummary = await this._runSynthesis(
        panelReviewId, structuredReviewResults, claimVerificationResults, devilsAdvocateResult, loggingContext, sendEvent
      );

      // Calculate costs
      const costBreakdown = await this._calculateCosts(panelReviewId);
      const totalCost = Object.values(costBreakdown).reduce((sum, c) => sum + c, 0);

      await this.updatePanelReview(panelReviewId, {
        status: 'completed',
        panelSummary,
        totalCostCents: totalCost,
        costBreakdown,
        completedAt: new Date().toISOString(),
      });

      sendEvent('complete', {
        panelSummary,
        costBreakdown,
        totalCostCents: totalCost,
        claimVerifications: claimVerificationResults,
        structuredReviews: structuredReviewResults,
        intelligenceBlock,
        devilsAdvocate: devilsAdvocateResult,
      });

      return { panelSummary, costBreakdown, totalCostCents: totalCost };

    } catch (error) {
      await this.updatePanelReview(panelReviewId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      });
      sendEvent('error', { message: error.message });
      throw error;
    }
  }

  // ============================================
  // INTERNAL STAGE RUNNERS
  // ============================================

  /**
   * A7 follow-up (step 2c): validate a parsed VRP stage output against its
   * declarative schema. On success returns the cleaned value — undeclared keys
   * dropped, types and lengths bounded (the anti-injection property). On a
   * validation failure it logs and returns `null` so the caller's existing
   * `if (!parsed)` path marks the provider/stage failed — the same posture as
   * an unparseable response.
   *
   * The `parseJSONResponse` `_truncated` marker is intentionally NOT carried
   * through: it is an undeclared key (so the schema drops it), nothing
   * downstream consumes it, and re-attaching it from `parsed._truncated` would
   * trust a key a prompt-injected model could itself supply.
   *
   * @param {*} parsed - output of `parseJSONResponse` (may be null).
   * @param {string} schemaKey - key into `VRP_OUTPUT_SCHEMAS`.
   * @param {string} label - log label.
   */
  static _validateStageOutput(parsed, schemaKey, label) {
    if (!parsed) return null;
    const schema = VRP_OUTPUT_SCHEMAS[schemaKey];
    // An unknown schemaKey is a programmer error (a typo would otherwise fail
    // open — consume unvalidated model output). Fail loud.
    if (!schema) {
      throw new Error(`_validateStageOutput: unknown schemaKey "${schemaKey}"`);
    }
    const r = validateAiJson(parsed, schema);
    if (!r.ok) {
      console.warn(`[PanelReview] ${label} failed schema validation: ${r.errors.join('; ')}`);
      return null;
    }
    return r.value;
  }

  static async _runStage(panelReviewId, proposalText, providers, stage, loggingContext, sendEvent, priorResults = null, intelligenceBlock = null) {
    const results = [];

    // Build prompts per provider
    const promptFn = (provider) => {
      if (stage === 'claim_verification') {
        const prompt = provider === 'perplexity'
          ? createPerplexityClaimVerificationPrompt(proposalText, intelligenceBlock)
          : createClaimVerificationPrompt(proposalText, intelligenceBlock);
        return { prompt, systemPrompt: SYSTEM_PROMPT };
      }

      // structured_review — optionally include claim verification context
      let cvContext = null;
      if (priorResults) {
        const providerCV = priorResults.find(r => r.provider === provider && r.success);
        if (providerCV) cvContext = providerCV.parsedResponse;
        // If this provider's CV failed, use any successful one
        if (!cvContext) {
          const anyCV = priorResults.find(r => r.success);
          if (anyCV) cvContext = anyCV.parsedResponse;
        }
      }

      return {
        prompt: createStructuredReviewPrompt(proposalText, cvContext, intelligenceBlock),
        systemPrompt: SYSTEM_PROMPT,
      };
    };

    // Fan out to all providers
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        const model = MultiLLMService.getDefaultModel(provider);
        const itemId = await this.createReviewItem(panelReviewId, provider, model, stage);

        sendEvent('provider_start', {
          stage,
          provider,
          providerName: MultiLLMService.getProviderName(provider),
          message: `${MultiLLMService.getProviderName(provider)} starting ${stage.replace('_', ' ')}...`,
        });

        // Heartbeat — send periodic progress events so the client knows the connection is alive
        const startTime = Date.now();
        const heartbeat = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          sendEvent('provider_heartbeat', {
            stage,
            provider,
            providerName: MultiLLMService.getProviderName(provider),
            elapsedSeconds: elapsed,
            message: `${MultiLLMService.getProviderName(provider)} working on ${stage.replace('_', ' ')}... (${elapsed}s)`,
          });
        }, 15000);

        try {
          const { prompt, systemPrompt } = promptFn(provider);

          const result = await MultiLLMService.call(provider, prompt, {
            systemPrompt,
            loggingContext,
          });

          clearInterval(heartbeat);

          const rawParsed = parseJSONResponse(result.text);
          // A7 step 2c: schema-validate the parsed output before it is
          // persisted, re-fed into a later stage, or surfaced to the client.
          const parsed = this._validateStageOutput(
            rawParsed,
            stage === 'claim_verification' ? 'claimVerification' : 'structuredReview',
            `${provider} ${stage}`,
          );
          const cost = estimateCostCents(result.model, result.inputTokens, result.outputTokens);

          if (!parsed) {
            console.warn(`[PanelReview] ${provider} returned unparseable or invalid response for ${stage}. ` +
              `Response length: ${result.text?.length || 0}, first 200 chars: ${result.text?.substring(0, 200)}`);
          }

          await this.updateReviewItem(itemId, {
            status: parsed ? 'completed' : 'failed',
            rawResponse: result.text,
            parsedResponse: parsed,
            errorMessage: parsed ? null : 'Response could not be parsed or failed schema validation',
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            estimatedCostCents: cost,
            latencyMs: result.latencyMs,
            completedAt: new Date().toISOString(),
          });

          if (!parsed) {
            sendEvent('provider_error', {
              stage,
              provider,
              providerName: MultiLLMService.getProviderName(provider),
              error: `Response could not be parsed or failed schema validation (${result.text?.length || 0} chars received)`,
            });

            return {
              provider,
              providerName: MultiLLMService.getProviderName(provider),
              success: false,
              error: 'Response could not be parsed or failed schema validation',
            };
          }

          sendEvent('provider_complete', {
            stage,
            provider,
            providerName: MultiLLMService.getProviderName(provider),
            model: result.model,
            parsedResponse: parsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents: cost,
            latencyMs: result.latencyMs,
            citations: result.citations || null,
          });

          return {
            provider,
            providerName: MultiLLMService.getProviderName(provider),
            model: result.model,
            success: true,
            parsedResponse: parsed,
            rawResponse: result.text,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents: cost,
            latencyMs: result.latencyMs,
            citations: result.citations || null,
          };

        } catch (error) {
          clearInterval(heartbeat);

          await this.updateReviewItem(itemId, {
            status: 'failed',
            errorMessage: error.message,
            completedAt: new Date().toISOString(),
          });

          sendEvent('provider_error', {
            stage,
            provider,
            providerName: MultiLLMService.getProviderName(provider),
            error: error.message,
          });

          return {
            provider,
            providerName: MultiLLMService.getProviderName(provider),
            success: false,
            error: error.message,
          };
        }
      })
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      }
    }

    return results;
  }

  /**
   * Devil's Advocate — single adversarial review from a rotating provider.
   * Picks a random provider from the panel to avoid systematic bias.
   */
  static async _runDevilsAdvocate(panelReviewId, proposalText, providers, structuredReviews, intelligenceBlock, loggingContext, sendEvent) {
    // Rotate provider: pick randomly from available providers
    const provider = providers[Math.floor(Math.random() * providers.length)];
    const model = MultiLLMService.getDefaultModel(provider);
    const itemId = await this.createReviewItem(panelReviewId, provider, model, 'devils_advocate');

    sendEvent('provider_start', {
      stage: 'devils_advocate',
      provider,
      providerName: MultiLLMService.getProviderName(provider),
      message: `${MultiLLMService.getProviderName(provider)} starting devil's advocate review...`,
    });

    const startTime = Date.now();
    const heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      sendEvent('provider_heartbeat', {
        stage: 'devils_advocate',
        provider,
        providerName: MultiLLMService.getProviderName(provider),
        elapsedSeconds: elapsed,
        message: `${MultiLLMService.getProviderName(provider)} working on devil's advocate... (${elapsed}s)`,
      });
    }, 15000);

    try {
      // Build a brief summary of structured reviews for DA context
      const reviewSummary = structuredReviews
        .filter(r => r.success)
        .map(r => `${r.providerName}: Overall=${r.parsedResponse?.overallRating}, Risk=${r.parsedResponse?.riskRating}, Impact=${r.parsedResponse?.impactRating}`)
        .join('\n');

      const prompt = createDevilsAdvocatePrompt(proposalText, reviewSummary, intelligenceBlock);

      const result = await MultiLLMService.call(provider, prompt, {
        systemPrompt: 'You are a skeptical senior scientist playing devil\'s advocate for a grant review panel. Your job is to find the strongest reasons NOT to fund this proposal. Be specific and evidence-based. Respond only with valid JSON — no markdown, no commentary outside the JSON object.',
        loggingContext,
      });

      clearInterval(heartbeat);

      // A7 step 2c: schema-validate before persist / re-feed into synthesis.
      const parsed = this._validateStageOutput(
        parseJSONResponse(result.text), 'devilsAdvocate', `${provider} devils_advocate`);
      const cost = estimateCostCents(result.model, result.inputTokens, result.outputTokens);

      await this.updateReviewItem(itemId, {
        status: parsed ? 'completed' : 'failed',
        rawResponse: result.text,
        parsedResponse: parsed,
        errorMessage: parsed ? null : 'Response could not be parsed or failed schema validation',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostCents: cost,
        latencyMs: result.latencyMs,
        completedAt: new Date().toISOString(),
      });

      if (!parsed) {
        sendEvent('provider_error', {
          stage: 'devils_advocate',
          provider,
          providerName: MultiLLMService.getProviderName(provider),
          error: 'Response could not be parsed or failed schema validation',
        });
        return { provider, providerName: MultiLLMService.getProviderName(provider), success: false };
      }

      sendEvent('provider_complete', {
        stage: 'devils_advocate',
        provider,
        providerName: MultiLLMService.getProviderName(provider),
        model: result.model,
        parsedResponse: parsed,
        costCents: cost,
        latencyMs: result.latencyMs,
      });

      return {
        provider,
        providerName: MultiLLMService.getProviderName(provider),
        model: result.model,
        success: true,
        parsedResponse: parsed,
        costCents: cost,
        latencyMs: result.latencyMs,
      };

    } catch (error) {
      clearInterval(heartbeat);

      await this.updateReviewItem(itemId, {
        status: 'failed',
        errorMessage: error.message,
        completedAt: new Date().toISOString(),
      });

      sendEvent('provider_error', {
        stage: 'devils_advocate',
        provider,
        providerName: MultiLLMService.getProviderName(provider),
        error: error.message,
      });

      return { provider, providerName: MultiLLMService.getProviderName(provider), success: false, error: error.message };
    }
  }

  static async _runSynthesis(panelReviewId, structuredReviews, claimVerifications, devilsAdvocate, loggingContext, sendEvent) {
    const successfulReviews = structuredReviews.filter(r => r.success);
    const successfulCVs = claimVerifications?.filter(r => r.success) || null;

    const synthesisPrompt = createPanelSynthesisPrompt(successfulReviews, successfulCVs, devilsAdvocate);
    const synthesisModel = getModelForApp('virtual-review-panel');

    const synthStartTime = Date.now();
    const synthHeartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - synthStartTime) / 1000);
      sendEvent('provider_heartbeat', {
        stage: 'synthesis',
        provider: 'claude',
        providerName: 'Claude',
        elapsedSeconds: elapsed,
        message: `Claude synthesizing panel summary... (${elapsed}s)`,
      });
    }, 15000);

    const result = await MultiLLMService.call('claude', synthesisPrompt, {
      systemPrompt: 'You are the chair of a grant review panel for the W. M. Keck Foundation, which deliberately funds high-risk, high-reward science. Your synthesis should fairly represent both enthusiasm and concern from reviewers. Respond only with valid JSON.',
      model: synthesisModel,
      maxTokens: 16384,
      loggingContext,
    });

    clearInterval(synthHeartbeat);

    // A7 step 2c: schema-validate the panel summary before it is persisted
    // and surfaced. `ratingMatrix` / `disagreements[].positions` are dynamic
    // reviewer-name-keyed maps validated via the `record` node.
    const parsed = this._validateStageOutput(
      parseJSONResponse(result.text), 'synthesis', 'panel synthesis');

    // Synthesis is the mandatory final stage (unlike the optional Stage 0/1
    // passes): an unparseable or schema-invalid panel summary must fail the
    // run loudly, not persist `panelSummary: null` under a 'completed' status.
    // The throw routes to runFullPanel's catch → status 'failed' + error event.
    if (!parsed) {
      throw new Error('Panel synthesis produced no parseable/valid summary');
    }

    sendEvent('synthesis_complete', {
      panelSummary: parsed,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    });

    return parsed;
  }

  /**
   * Stage 0: Pre-review intelligence pass
   *
   * 0a: Haiku extracts search queries from proposal
   * 0b: Real API searches (PubMed, arXiv, bioRxiv, ChemRxiv, Google Scholar) in parallel
   * 0c: Haiku collates raw search results into structured summary
   * 0d: Perplexity synthesizes + fills gaps with web search
   */
  static async _runIntelligencePass(panelReviewId, proposalText, loggingContext, sendEvent, allowedProviders = null) {
    const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
    const HAIKU_SYSTEM = 'You are a research intelligence analyst. Respond only with valid JSON — no markdown, no commentary outside the JSON object.';

    try {
      // Stage 0a: Extract search queries with Haiku
      sendEvent('progress', { message: 'Stage 0a: Extracting search queries from proposal...' });

      const extractionResult = await MultiLLMService.call('claude', createClaimExtractionPrompt(proposalText), {
        systemPrompt: HAIKU_SYSTEM,
        model: HAIKU_MODEL,
        maxTokens: 2048,
        loggingContext,
      });

      // A7 step 2c: schema-validate before re-feeding into Stages 0b–0d.
      const claimData = this._validateStageOutput(
        parseJSONResponse(extractionResult.text), 'claimExtraction', 'claim extraction');
      if (!claimData || !claimData.noveltySearchStrings) {
        console.warn('[PanelReview] Stage 0a: claim extraction failed or returned invalid data');
        sendEvent('progress', { message: 'Stage 0a: Claim extraction produced insufficient data, skipping intelligence pass' });
        return null;
      }

      sendEvent('progress', {
        message: `Stage 0a complete: ${claimData.noveltySearchStrings.length} novelty queries, ${claimData.techniqueSearchStrings?.length || 0} technique queries, ${claimData.piNames?.length || 0} PIs identified`,
        claimData,
      });

      // Stage 0b: Run real database searches in parallel
      sendEvent('progress', { message: 'Stage 0b: Searching academic databases (PubMed, arXiv, bioRxiv, ChemRxiv, OpenAlex)...' });

      const rawSearchResults = await LiteratureSearchService.searchAll(claimData);

      const totalResults = Object.values(rawSearchResults)
        .filter(Array.isArray)
        .reduce((sum, arr) => sum + arr.length, 0);

      sendEvent('progress', {
        message: `Stage 0b complete: ${totalResults} results across ${Object.keys(rawSearchResults).filter(k => Array.isArray(rawSearchResults[k]) && rawSearchResults[k].length > 0).length} databases`,
      });

      // Stage 0c: Haiku collates raw results
      sendEvent('progress', { message: 'Stage 0c: Collating search results...' });

      const collationResult = await MultiLLMService.call('claude', createSearchCollationPrompt(proposalText, claimData, rawSearchResults), {
        systemPrompt: HAIKU_SYSTEM,
        model: HAIKU_MODEL,
        maxTokens: 8192,
        loggingContext,
      });

      // A7 step 2c: schema-validate before re-feeding into Stage 0d / Stages 1–2.
      const collatedResults = this._validateStageOutput(
        parseJSONResponse(collationResult.text), 'searchCollation', 'search collation');
      if (!collatedResults) {
        console.warn('[PanelReview] Stage 0c: collation failed');
        sendEvent('progress', { message: 'Stage 0c: Collation failed, proceeding with partial intelligence' });
        return null;
      }

      sendEvent('progress', {
        message: `Stage 0c complete: ${collatedResults.mostRelevantPapers?.length || 0} relevant papers identified`,
      });

      // Stage 0d: Perplexity synthesis (only if Perplexity is configured AND allowed by VRP allowlist)
      let perplexitySynthesis = null;
      const perplexityEligible = allowedProviders
        ? allowedProviders.includes('perplexity')
        : MultiLLMService.getAvailableProviders().includes('perplexity');

      if (perplexityEligible) {
        sendEvent('progress', { message: 'Stage 0d: Perplexity synthesizing field landscape...' });

        try {
          const synthesisResult = await MultiLLMService.call('perplexity',
            createIntelligenceSynthesisPrompt(proposalText, claimData, collatedResults), {
              systemPrompt: 'You are a research intelligence analyst with web search capabilities. Respond only with valid JSON.',
              maxTokens: 8192,
              loggingContext,
            });

          // A7 step 2c: schema-validate before assembling the intelligence block.
          perplexitySynthesis = this._validateStageOutput(
            parseJSONResponse(synthesisResult.text), 'intelligenceSynthesis', 'intelligence synthesis');

          if (perplexitySynthesis) {
            sendEvent('progress', {
              message: `Stage 0d complete: ${perplexitySynthesis.activeGroups?.length || 0} active groups, ${perplexitySynthesis.competingApproaches?.length || 0} competing approaches identified`,
            });
          }
        } catch (err) {
          console.warn('[PanelReview] Stage 0d: Perplexity synthesis failed:', err.message);
          sendEvent('progress', { message: 'Stage 0d: Perplexity synthesis failed, proceeding with database results only' });
        }
      } else {
        sendEvent('progress', { message: 'Stage 0d: Perplexity not available, skipping web synthesis' });
      }

      // Assemble the intelligence block
      return assembleIntelligenceBlock(collatedResults, perplexitySynthesis);

    } catch (error) {
      console.error('[PanelReview] Intelligence pass failed:', error);
      sendEvent('progress', { message: `Intelligence pass failed: ${error.message}. Proceeding without pre-search intelligence.` });
      return null;
    }
  }

  static async _calculateCosts(panelReviewId) {
    const result = await sql`
      SELECT llm_provider, SUM(estimated_cost_cents) as total_cost
      FROM panel_review_items
      WHERE panel_review_id = ${panelReviewId} AND status = 'completed'
      GROUP BY llm_provider
    `;

    const breakdown = {};
    for (const row of result.rows) {
      breakdown[row.llm_provider] = parseFloat(row.total_cost) || 0;
    }

    // Add synthesis cost (logged under 'claude' but for synthesis step)
    // The synthesis call is already included in claude's total from usage logging
    return breakdown;
  }
}
