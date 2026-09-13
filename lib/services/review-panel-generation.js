/**
 * Virtual Review Panel Phase A generation stages.
 * docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §5 A.3/A.5/A.6, §8.
 *
 * This module owns no queue/lease/persistence beyond finalizing the attempt
 * ledger row for its own call (review-panel-store.js's finalizeAttempt). It
 * freezes a per-launch configuration snapshot (models, pricing, prompt rows,
 * question set) and runs one seat or the chair against a frozen input DTO.
 *
 * Provider vocabulary note: `lib/utils/vrp-providers.js` and
 * `MultiLLMService.getAvailableProviders()` speak the legacy interactive VRP's
 * vocabulary ('claude'/'openai'/'gemini'/'perplexity'); `MODEL_CAPABILITIES`
 * and the Executor speak 'anthropic'/'openai'. `PROVIDER_ALIASES` below is the
 * one translation point between the two vocabularies.
 */
import { getModelForApp } from '../../shared/config/baseConfig';
import { loadModelOverrides } from './model-override-loader';
import { fetchCurrentPrompt } from './prompt-store';
import { executePrompt } from './execute-prompt';
import { MultiLLMService } from './multi-llm-service';
import { resolveAllowedProviders } from '../utils/vrp-providers';
import { lookupModelCapabilities } from './model-capabilities';
import { lookupPricing } from '../utils/model-pricing';
import { getAuthoritativeQuestionSet, questionSetVersion } from '../external/review-question-fetcher';
import { REVIEW_PANEL_SEATS } from '../../shared/config/reviewPanelSeats';
import { REVIEW_PANEL_INPUT_KEYS } from './review-panel-input';
import { projectSeatQuestionSet, buildSeatValidationSchema, renderSeatQuestionsText, chairInput } from './review-panel-questions';
import { finalizeAttempt } from './review-panel-store';
import { getExecutorBudget } from './executor-budget-service';
import {
  EXECUTOR_BUDGET_DEFAULTS,
  EXECUTOR_BUDGET_LIMITS,
  REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP,
} from '../../shared/config/executorBudgets';
import { isGuid } from '../utils/guid';
import { canonicalJson } from '../utils/canonical-json';
import { resolveModel } from './model-resolver.js';
import * as seatDefinition from '../../shared/config/prompts/review-panel-seat.js';
import * as chairDefinition from '../../shared/config/prompts/review-panel-chair.js';

export const SEAT_PROMPT_NAME = 'review-panel.seat';
export const CHAIR_PROMPT_NAME = 'review-panel.chair';

// Legacy VRP vocabulary -> MODEL_CAPABILITIES/Executor vocabulary. Only the
// two providers the Executor actually has a transport for are ever relevant
// here (see computeAllowedProviders).
const PROVIDER_ALIASES = Object.freeze({ claude: 'anthropic', openai: 'openai' });

export class ReviewPanelGenerationError extends Error {
  constructor(message, code = 'review_panel_generation_invalid') {
    super(message);
    this.name = 'ReviewPanelGenerationError';
    this.code = code;
  }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function pricingRate(model) {
  const value = lookupPricing(model);
  return value ? { inputUsdPer1k: value.input / 100000, outputUsdPer1k: value.output / 100000 } : null;
}

/** cents from a usage record + a per-1k-token USD rate (same formula as cycle-dossier-generation.js's usageCostUsd, converted to integer cents). */
function usageCostCents(usage, rate) {
  if (!usage || !rate) return null;
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) return null;
  const writes = Number(usage.cache_creation_input_tokens || usage.cacheCreationTokens || 0);
  const hourWrites = Number(usage.cache_creation_input_tokens_1h || usage.cacheCreationTokens1h || 0);
  const reads = Number(usage.cache_read_input_tokens || usage.cacheReadTokens || 0);
  const usd = ((input + Math.max(0, writes - hourWrites) * 1.25 + hourWrites * 2 + reads * 0.1) * rate.inputUsdPer1k + output * rate.outputUsdPer1k) / 1000;
  if (!Number.isFinite(usd) || usd < 0) return null;
  return Math.round(usd * 100);
}

/** Fail closed on any DTO carrying a key outside the frozen review-panel input allowlist — defends the "narrative-derived variables only" invariant even if a caller ever spreads an unexpected object in. */
function assertInputDtoShape(input) {
  const keys = Object.keys(input || {});
  const extra = keys.filter((k) => !REVIEW_PANEL_INPUT_KEYS.includes(k));
  if (extra.length) {
    throw new ReviewPanelGenerationError(`Review panel input carries unexpected key(s): ${extra.join(', ')}`, 'review_panel_input_key_not_allowed');
  }
  if (!input?.narrative?.text) throw new ReviewPanelGenerationError('Review panel input requires a frozen narrative', 'review_panel_input_missing_narrative');
}

/** Compute the Executor-vocabulary allowed-provider set: VRP_ALLOWED_PROVIDERS ∩ configured-and-keyed providers ∩ {claude, openai} (the only providers the Executor has a transport for), translated to anthropic/openai. */
export function computeAllowedProviders() {
  const available = MultiLLMService.getAvailableProviders();
  const vrpAllowed = resolveAllowedProviders(available);
  return vrpAllowed
    .filter((provider) => provider === 'claude' || provider === 'openai')
    .map((provider) => PROVIDER_ALIASES[provider]);
}

function withValidationSchema(promptRow, validationSchema) {
  let schema;
  try { schema = JSON.parse(promptRow.wmkf_ai_promptoutputschema || '{}'); }
  catch { throw new ReviewPanelGenerationError(`Prompt ${promptRow.wmkf_ai_promptname} has an invalid output schema`, 'review_panel_prompt_invalid'); }
  return { ...promptRow, wmkf_ai_promptoutputschema: JSON.stringify({ ...schema, validationSchema }) };
}

/**
 * Validate the seeded prompt row against its canonical static definition
 * (shared/config/prompts/review-panel-{seat,chair}.js) BEFORE anything else
 * touches it — clone of cycle-dossier-generation.js's snapshotPrompt. This is
 * what makes the A7 registry row load-bearing: without it, an admin edit that
 * drops `untrusted: true` (or the row simply not existing yet) would surface
 * as a confusing per-attempt executePrompt error instead of failing the
 * launch outright.
 */
function snapshotPrompt(row, expectedName, definition) {
  if (!row || row.wmkf_ai_promptname !== expectedName) {
    throw new ReviewPanelGenerationError(`Missing valid published prompt row for ${expectedName}`, 'review_panel_prompt_missing');
  }
  if (!isGuid(row.wmkf_ai_promptid)) {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} is missing a valid id`, 'review_panel_prompt_invalid');
  }
  if (!Number.isInteger(Number(row.wmkf_promptversion)) || Number(row.wmkf_promptversion) < 1) {
    throw new ReviewPanelGenerationError(`Invalid prompt version for ${expectedName}`, 'review_panel_prompt_invalid');
  }
  // The prompt editor's model dropdown may submit either a concrete model id
  // or a tier key (e.g. "opus") — shared/components/admin/PromptTemplatesSection.js
  // offers both as options for any prompt that isn't native-json-schema, and
  // publishing stores whichever value the admin picked verbatim. Resolve a
  // tier key through the SAME resolver getModelForApp uses (model-resolver.js,
  // warmed by loadModelOverrides() in snapshotConfiguration) before applying
  // D8's concrete-id regex, so a reviewed tier selection doesn't fail closed
  // just because it hasn't been resolved yet. Fails closed exactly as before
  // if the (possibly resolved) value still isn't a concrete claude-* id.
  const resolvedModel = resolveModel(row.wmkf_ai_model) || row.wmkf_ai_model;
  if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(String(resolvedModel || ''))) {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} must pin a concrete Claude model id at seed time (D8) — got "${row.wmkf_ai_model}"`, 'review_panel_prompt_invalid');
  }
  if (typeof row.wmkf_ai_systemprompt !== 'string' || typeof row.wmkf_ai_promptbody !== 'string') {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} has no prompt text`, 'review_panel_prompt_invalid');
  }
  // This row-level cap is independent of (and tighter than or equal to) the
  // admin-tunable Executor standing budget resolved below (resolveBudget) —
  // the standing override is what the Executor actually sends as max_tokens
  // (execute-prompt.js's resolveMaxTokensForCall prefers it over this row
  // value), but the seeded row itself must still declare a sane number.
  if (!Number.isInteger(Number(row.wmkf_ai_maxtokens)) || Number(row.wmkf_ai_maxtokens) < 1 || Number(row.wmkf_ai_maxtokens) > REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP) {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} requires a token limit from 1 to ${REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP}`, 'review_panel_prompt_invalid');
  }
  let variables, schema;
  try {
    variables = JSON.parse(row.wmkf_ai_promptvariables);
    schema = JSON.parse(row.wmkf_ai_promptoutputschema);
  } catch { throw new ReviewPanelGenerationError(`Invalid JSON contract for ${expectedName}`, 'review_panel_prompt_invalid'); }
  // Structural (key-order/whitespace independent) comparison — a re-save that
  // rebuilds the same contract with keys in a different order must not trip
  // this drift check; every security-relevant field (untrusted/dataClass/
  // maxChars/source/placement/required/names, schema parseMode/outputs) is
  // still required to be byte-for-byte equal in VALUE, just not in key order.
  if (canonicalJson(variables) !== canonicalJson(definition.VARIABLES)
      || canonicalJson(schema) !== canonicalJson(definition.OUTPUT_SCHEMA)) {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} must retain its seeded variable and output contracts`, 'review_panel_prompt_invalid');
  }
  const declared = new Set(variables.variables.map((v) => v.name));
  const placeholders = [...`${row.wmkf_ai_systemprompt}\n${row.wmkf_ai_promptbody}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  if (placeholders.some((name) => !declared.has(name)) || [...declared].some((name) => !placeholders.includes(name))) {
    throw new ReviewPanelGenerationError(`Prompt ${expectedName} must include exactly its declared input names`, 'review_panel_prompt_invalid');
  }
  return { ...clone(row), wmkf_ai_model: resolvedModel };
}

/**
 * Resolve + clamp the Executor standing budget (timeout AND output tokens) for
 * one review-panel prompt (mirrors cycle-dossier-generation.js's
 * resolveEntryTimeoutMs, generalized to both prompt names and both fields).
 * Falls back to the reviewed code default on any read failure, same as the
 * timeout-only fields it replaces.
 */
async function resolveBudget(promptName) {
  const defaults = EXECUTOR_BUDGET_DEFAULTS[promptName];
  const limits = EXECUTOR_BUDGET_LIMITS[promptName];
  let requestedTimeoutMs = defaults.timeoutMsOverride;
  let requestedMaxTokens = defaults.maxTokensOverride;
  try {
    const budget = await getExecutorBudget(promptName);
    if (Number.isInteger(budget?.timeoutMsOverride) && budget.timeoutMsOverride > 0) requestedTimeoutMs = budget.timeoutMsOverride;
    if (Number.isInteger(budget?.maxTokensOverride) && budget.maxTokensOverride > 0) requestedMaxTokens = budget.maxTokensOverride;
  } catch (error) {
    console.error(`[review-panel] executor budget read failed for ${promptName}; using the registry default:`, error?.message);
  }
  const { min: timeoutMin, max: timeoutMax } = limits.timeoutMsOverride;
  const { min: tokensMin, max: tokensMax } = limits.maxTokensOverride;
  return {
    timeoutMsOverride: Math.min(timeoutMax, Math.max(timeoutMin, requestedTimeoutMs)),
    maxTokensOverride: Math.min(tokensMax, Math.max(tokensMin, requestedMaxTokens)),
  };
}

/**
 * Pin the per-launch configuration: resolved model + pricing + prompt
 * snapshot per configured seat (and the chair), the authoritative question
 * set projection, and the Executor-vocabulary allowed-provider set. Fails
 * closed (throws) on any unreviewed model, missing pricing, a disallowed
 * provider, a non-Anthropic chair model, or a question-set fetch failure.
 */
export async function snapshotConfiguration({ seats = REVIEW_PANEL_SEATS.filter((s) => s.enabled) } = {}) {
  await loadModelOverrides();
  const [seatRow, chairRow, fullQuestionSet, seatBudget, chairBudget] = await Promise.all([
    fetchCurrentPrompt(SEAT_PROMPT_NAME),
    fetchCurrentPrompt(CHAIR_PROMPT_NAME),
    getAuthoritativeQuestionSet(),
    resolveBudget(SEAT_PROMPT_NAME),
    resolveBudget(CHAIR_PROMPT_NAME),
  ]);
  const validatedSeatRow = snapshotPrompt(seatRow, SEAT_PROMPT_NAME, seatDefinition);
  const validatedChairRow = snapshotPrompt(chairRow, CHAIR_PROMPT_NAME, chairDefinition);
  const allowedProviders = computeAllowedProviders();
  const projectedQuestionSet = projectSeatQuestionSet(fullQuestionSet);
  const validationSchema = buildSeatValidationSchema(projectedQuestionSet);
  const reviewQuestionsText = renderSeatQuestionsText(projectedQuestionSet);

  const chairSeat = seats.find((s) => s.key === 'chair');
  const reviewerSeats = seats.filter((s) => s.key !== 'chair');
  if (!reviewerSeats.length) throw new ReviewPanelGenerationError('No reviewer seats are configured', 'review_panel_no_seats');
  if (!chairSeat) throw new ReviewPanelGenerationError('No chair seat is configured', 'review_panel_no_chair');

  const seatConfigs = {};
  for (const seat of reviewerSeats) {
    const model = getModelForApp('review-panel', seat.key);
    // Keyed on MODEL_CAPABILITIES[model].provider (plan §8), never a
    // vendor-name regex — a seat's admin-selected model can only ever be
    // reclassified by editing the reviewed capability registry.
    const capabilities = lookupModelCapabilities(model);
    if (!capabilities) throw new ReviewPanelGenerationError(`Seat "${seat.key}" model "${model}" is not in the reviewed capability registry`, 'review_panel_model_unreviewed');
    const provider = capabilities.provider;
    // A seat's fixed vendor identity (shared/config/reviewPanelSeats.js) may
    // never change, even via a model override: an override may only pick a
    // DIFFERENT reviewed model within the SAME vendor.
    if (provider !== seat.vendor) {
      throw new ReviewPanelGenerationError(`Seat "${seat.key}" is fixed to vendor "${seat.vendor}" but its resolved model "${model}" is registered as "${provider}"`, 'review_panel_seat_vendor_mismatch');
    }
    const pricing = pricingRate(model);
    if (!pricing) throw new ReviewPanelGenerationError(`Seat "${seat.key}" model "${model}" has no reviewed pricing`, 'review_panel_model_unpriced');
    if (!allowedProviders.includes(provider)) throw new ReviewPanelGenerationError(`Seat "${seat.key}" provider "${provider}" is not in the allowed provider set`, 'review_panel_provider_not_allowed');
    seatConfigs[seat.key] = {
      seatKey: seat.key, provider, model, pricing, reviewQuestionsText,
      budget: { timeoutMsOverride: seatBudget.timeoutMsOverride, maxTokensOverride: seatBudget.maxTokensOverride },
      promptSnapshot: withValidationSchema({ ...validatedSeatRow, wmkf_ai_model: model }, validationSchema),
    };
  }

  const chairModel = getModelForApp('review-panel', chairSeat.key);
  const chairCapabilities = lookupModelCapabilities(chairModel);
  if (!chairCapabilities || chairCapabilities.provider !== chairSeat.vendor) {
    const vendorLabel = chairSeat.vendor === 'anthropic' ? 'Anthropic' : chairSeat.vendor;
    throw new ReviewPanelGenerationError(`Chair model "${chairModel}" must be a reviewed ${vendorLabel} model (D8: publishing stays Claude-only)`, 'review_panel_chair_provider_invalid');
  }
  const chairPricing = pricingRate(chairModel);
  if (!chairPricing) throw new ReviewPanelGenerationError(`Chair model "${chairModel}" has no reviewed pricing`, 'review_panel_model_unpriced');
  if (!allowedProviders.includes('anthropic')) throw new ReviewPanelGenerationError('Provider "anthropic" is not in the allowed provider set', 'review_panel_provider_not_allowed');
  const chairConfig = {
    seatKey: chairSeat.key, provider: 'anthropic', model: chairModel, pricing: chairPricing,
    budget: { timeoutMsOverride: chairBudget.timeoutMsOverride, maxTokensOverride: chairBudget.maxTokensOverride }, projectedQuestionSet,
    promptSnapshot: { ...validatedChairRow, wmkf_ai_model: chairModel },
  };

  return freezeDeep({
    schema: 'review-panel-config/v1',
    capturedAt: new Date().toISOString(),
    allowedProviders: clone(allowedProviders),
    projectedQuestionSet: clone(projectedQuestionSet),
    questionSetVersion: questionSetVersion(fullQuestionSet),
    seats: clone(seatConfigs),
    chair: clone(chairConfig),
  });
}

/**
 * Run one reviewer seat. Always finalizes the attempt (success or failure)
 * BEFORE returning/throwing — the caller (the worker) performs no run-state
 * change until this resolves, so the ledger write always precedes it.
 */
export async function runSeat(input, seatConfig, { attemptId, dispatchToken, deadlineMs = null, signal = null, execute = executePrompt } = {}) {
  assertInputDtoShape(input);
  const overrideVariables = { proposal_narrative: input.narrative.text, review_questions: seatConfig.reviewQuestionsText };
  let result;
  try {
    result = await execute({
      promptName: SEAT_PROMPT_NAME,
      promptSnapshot: seatConfig.promptSnapshot,
      requestId: input.requestId,
      overrideVariables,
      runSource: 'Vercel Interactive',
      forceOverwrite: true,
      requireNoPersistence: true,
      deadlineMs,
      signal,
      allowedProviders: [seatConfig.provider],
      timeoutMsOverride: seatConfig.budget?.timeoutMsOverride ?? null,
      maxTokensOverride: seatConfig.budget?.maxTokensOverride ?? null,
    });
  } catch (err) {
    // executePrompt's err.paidCall is true only when a provider response was
    // actually received (a possible charge); null/false means no response
    // was ever confirmed. Require BOTH usageComplete and paidCall===true
    // before trusting the usage numbers enough to record a known cost — an
    // ambiguous paidCall (null) must cost_state='unknown', not 'known'.
    const usageComplete = err?.usageComplete === true && err?.paidCall === true;
    const costCents = usageComplete ? usageCostCents(err.usage, seatConfig.pricing) : null;
    await finalizeAttempt(attemptId, dispatchToken, {
      state: 'failed', usage: err?.usage || null,
      costCents, costState: costCents != null ? 'known' : 'unknown',
      errorText: String(err?.message || err || 'Unknown error').slice(0, 2000),
    });
    throw err;
  }
  const usageComplete = result?.usageComplete === true;
  const costCents = usageComplete ? usageCostCents(result.usage, seatConfig.pricing) : null;
  return finalizeAttempt(attemptId, dispatchToken, {
    state: 'completed', result: result.parsed, usage: result.usage,
    costCents, costState: costCents != null ? 'known' : 'unknown',
  });
}

// Picklist/multiselect seat answers are validated as their raw enum-value
// STRING form (e.g. "2") — meaningless to the chair on their own. Re-attach
// each option's label from the same projected question set the seat saw, so
// the chair reads "2 (High risk)" instead of an opaque code.
function humanizeSeatReviews(seatReviews, projectedQuestionSet) {
  const byKey = new Map((projectedQuestionSet || []).map((f) => [f.key, f]));
  const labelFor = (field, value) => {
    const opt = (field.options || []).find((o) => String(o.value) === String(value));
    return opt ? `${value} (${opt.label ?? value})` : value;
  };
  const out = {};
  for (const [seatKey, review] of Object.entries(seatReviews || {})) {
    const humanized = {};
    for (const [key, value] of Object.entries(review || {})) {
      const field = byKey.get(key);
      if (field?.type === 'picklist') humanized[key] = labelFor(field, value);
      else if (field?.type === 'multiselect' && Array.isArray(value)) humanized[key] = value.map((v) => labelFor(field, v));
      else humanized[key] = value;
    }
    out[seatKey] = humanized;
  }
  return out;
}

/** Run the chair. Input is the narrative plus each winning seat's structured review with teamCapacity omitted (D9) and picklist/multiselect codes re-labeled. `seatWinnerReviews` is `{ seatKey: parsedReviewObject }`. */
export async function runChair(input, seatWinnerReviews, chairConfig, { attemptId, dispatchToken, deadlineMs = null, signal = null, execute = executePrompt } = {}) {
  assertInputDtoShape(input);
  const seatReviewsText = JSON.stringify(chairInput(humanizeSeatReviews(seatWinnerReviews, chairConfig.projectedQuestionSet)));
  const overrideVariables = {
    proposal_narrative: input.narrative.text,
    seat_reviews: seatReviewsText,
  };
  let result;
  try {
    // wrapUntrustedContent's buildBoundedTextPayload (lib/utils/ai-payload-
    // boundary.js) silently truncates any text over its declared maxChars —
    // no error, just a cut JSON string reaching the model. Check the actual
    // length against the chair's own declared cap BEFORE calling execute, so
    // an oversized seat_reviews payload fails this attempt outright instead
    // of ever being silently truncated.
    if (seatReviewsText.length > chairDefinition.SEAT_REVIEWS_MAX_CHARS) {
      throw new ReviewPanelGenerationError(
        `Chair input (seat reviews, ${seatReviewsText.length} chars) exceeds the declared size cap (${chairDefinition.SEAT_REVIEWS_MAX_CHARS} chars); refusing to synthesize over data that would be silently truncated`,
        'review_panel_chair_input_too_large',
      );
    }
    result = await execute({
      promptName: CHAIR_PROMPT_NAME,
      promptSnapshot: chairConfig.promptSnapshot,
      requestId: input.requestId,
      overrideVariables,
      runSource: 'Vercel Interactive',
      forceOverwrite: true,
      requireNoPersistence: true,
      deadlineMs,
      signal,
      allowedProviders: [chairConfig.provider],
      timeoutMsOverride: chairConfig.budget?.timeoutMsOverride ?? null,
      maxTokensOverride: chairConfig.budget?.maxTokensOverride ?? null,
    });
  } catch (err) {
    // See runSeat's identical catch block: require BOTH usageComplete and
    // paidCall===true before trusting a known cost on the error path.
    const usageComplete = err?.usageComplete === true && err?.paidCall === true;
    const costCents = usageComplete ? usageCostCents(err.usage, chairConfig.pricing) : null;
    await finalizeAttempt(attemptId, dispatchToken, {
      state: 'failed', usage: err?.usage || null,
      costCents, costState: costCents != null ? 'known' : 'unknown',
      errorText: String(err?.message || err || 'Unknown error').slice(0, 2000),
    });
    throw err;
  }
  const usageComplete = result?.usageComplete === true;
  const costCents = usageComplete ? usageCostCents(result.usage, chairConfig.pricing) : null;
  return finalizeAttempt(attemptId, dispatchToken, {
    state: 'completed', result: result.parsed, usage: result.usage,
    costCents, costState: costCents != null ? 'known' : 'unknown',
  });
}

// [ASSUMED] Conservative reservation bound (D6). Unlike cycle-dossier's
// estimateGenerationCost, this does not scan the actual seeded prompt
// template for placeholder byte counts; it bounds input tokens by a fixed
// narrative ceiling and output tokens by each prompt row's configured
// wmkf_ai_maxtokens. (The rows ARE now pinned to their static
// shared/config/prompts/review-panel-{seat,chair}.js definitions by
// snapshotPrompt/snapshotConfiguration above — this function only avoids the
// dossier's byte-accurate template scan, not prompt-row validation.)
const NARRATIVE_INPUT_CEILING_TOKENS = 30000; // ~100k-char MAX narrative / ~3.3 chars-per-token, rounded up generously
const RESERVATION_MAX_ATTEMPTS = 5; // mirrors cycle-dossier-generation.js's maxAttempts assumption (LLMClient retries)

export function estimateReservationCost(config, entryCount = 1) {
  const seats = Object.values(config?.seats || {});
  const chair = config?.chair;
  if (!seats.length || !chair || seats.some((s) => !s.pricing) || !chair.pricing) {
    return { lowUsd: null, highUsd: null, entryCount, reason: 'model pricing is unavailable' };
  }
  // The standing Executor budget (budget.maxTokensOverride) is what
  // resolveMaxTokensForCall actually sends as max_tokens when present (it
  // wins over the prompt row's wmkf_ai_maxtokens); fall back to the row value
  // only if a seat/chair somehow carries no budget object (e.g. an older
  // frozen snapshot).
  const outputCeiling = (entry) => Number(entry.budget?.maxTokensOverride ?? entry.promptSnapshot?.wmkf_ai_maxtokens ?? 0);
  const seatCost = (seat) => {
    const outTokens = outputCeiling(seat) / 1000;
    const inTokens = NARRATIVE_INPUT_CEILING_TOKENS / 1000;
    return inTokens * seat.pricing.inputUsdPer1k + outTokens * seat.pricing.outputUsdPer1k;
  };
  const chairOutTokens = outputCeiling(chair) / 1000;
  // Chair input includes the narrative plus every seat's structured review.
  // Each seat's review is bounded by that SAME seat's own configured output
  // ceiling (the actual output-token ceiling used for seatCost above), not a
  // separate guessed constant.
  const chairInTokens = (NARRATIVE_INPUT_CEILING_TOKENS
    + seats.reduce((sum, seat) => sum + outputCeiling(seat), 0)) / 1000;
  const chairCost = chairInTokens * chair.pricing.inputUsdPer1k + chairOutTokens * chair.pricing.outputUsdPer1k;
  const perEntry = seats.reduce((sum, seat) => sum + seatCost(seat), 0) + chairCost;
  return {
    lowUsd: Number((perEntry * entryCount).toFixed(6)),
    highUsd: Number((perEntry * entryCount * RESERVATION_MAX_ATTEMPTS).toFixed(6)),
    entryCount,
  };
}
