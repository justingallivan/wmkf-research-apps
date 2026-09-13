/**
 * Executor-budget durable contract and bounded code fallback.
 *
 * Live values are published as append-only Dataverse `wmkf_appsystemsettings`
 * rows by `lib/services/executor-budget-service.js`. These defaults preserve
 * the last known-safe behavior when no revision exists or the settings store
 * is temporarily unavailable; they are not the normal mutable source of truth.
 */

export const EXECUTOR_BUDGET_SCHEMA_VERSION = 1;
export const EXECUTOR_BUDGET_SETTING_PREFIX = 'executor.budgets.v';

// `lib/services/review-panel-generation.js`'s `snapshotPrompt` refuses any
// review-panel.seat/chair prompt ROW whose wmkf_ai_maxtokens exceeds this
// value (a fixed, reviewed ceiling on the seeded row itself, independent of
// the Executor budget below). Mirrored here — not re-derived — so the two
// standing budgets' LIMITS.maxTokensOverride.max below can reference the same
// number instead of drifting from it. Raising it requires relaxing that
// row-level check first.
export const REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP = 16_000;

export const EXECUTOR_BUDGET_DEFAULTS = Object.freeze({
  'pre-site-visit.proposal-core.generate': Object.freeze({
    kind: 'standing',
    maxTokensOverride: 32_768,
    timeoutMsOverride: 240_000,
  }),
  'review-synthesis.generate': Object.freeze({
    kind: 'retry',
    floor: 16_000,
    ceiling: 32_000,
  }),
  'field-primer.generate': Object.freeze({
    kind: 'timeout',
    timeoutMsOverride: 240_000,
  }),
  'cycle-dossier.entry': Object.freeze({
    kind: 'timeout',
    timeoutMsOverride: 200_000,
  }),
  // review-panel.seat and review-panel.chair are 'standing' (owner decision,
  // 2026-09-13): the seat/chair output ceiling must not be hard-coded in the
  // prompt row or seed, because it will need changing as models evolve and
  // adaptive thinking is counted inside this same output budget. The panel's
  // prompt rows (A.3/A.7) are seeded, so assertModelCeilings' fetchCurrentPrompt
  // read (which any non-'timeout' kind now takes) is safe.
  // Both seat vendors — the Claude seat and the OpenAI seat (gpt-5.6-sol,
  // MODEL_CAPABILITIES `instructionRole: 'developer'`) — share this ONE
  // standing override: OpenAI's max_completion_tokens counts reasoning tokens
  // toward the same ceiling as the visible answer, so this budget must leave
  // headroom for reasoning before the final structured review, same as
  // Claude's adaptive thinking does. The runtime resolver
  // (execute-prompt.js's resolveMaxTokensForCall) still caps the effective
  // call to whichever model is actually resolved for a given seat/run.
  'review-panel.seat': Object.freeze({
    kind: 'standing',
    maxTokensOverride: 16_000,
    timeoutMsOverride: 200_000,
  }),
  'review-panel.chair': Object.freeze({
    kind: 'standing',
    maxTokensOverride: 12_000,
    timeoutMsOverride: 200_000,
  }),
});

// Safety bounds remain code-owned. Admin publications may tune values only
// inside these reviewed envelopes; model-specific output ceilings are checked
// separately against the concrete model resolved for each prompt.
export const EXECUTOR_BUDGET_LIMITS = Object.freeze({
  'pre-site-visit.proposal-core.generate': Object.freeze({
    maxTokensOverride: Object.freeze({ min: 4_096, max: 128_000 }),
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 240_000 }),
  }),
  'review-synthesis.generate': Object.freeze({
    floor: Object.freeze({ min: 4_096, max: 128_000 }),
    ceiling: Object.freeze({ min: 4_096, max: 128_000 }),
  }),
  'field-primer.generate': Object.freeze({
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 240_000 }),
  }),
  // Ceiling = the worker's 280 s lease minus its 60 s checkpoint reserve; the
  // Executor deadline (lease − 60 s) still aborts the call independently.
  'cycle-dossier.entry': Object.freeze({
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 220_000 }),
  }),
  // [ASSUMED] Mirrors cycle-dossier.entry's envelope; the review panel worker's
  // lease length (A.6) is not yet built in this slice, so the 280s-lease-minus-
  // checkpoint-reserve rationale behind cycle-dossier.entry's ceiling has not
  // been independently re-derived for the panel's own worker.
  // maxTokensOverride's max is the lower of REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP
  // (snapshotPrompt's row-level ceiling) and each resolved model's own
  // maxOutputTokens (checked separately, per publication, by assertModelCeilings).
  'review-panel.seat': Object.freeze({
    maxTokensOverride: Object.freeze({ min: 4_000, max: REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP }),
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 220_000 }),
  }),
  'review-panel.chair': Object.freeze({
    maxTokensOverride: Object.freeze({ min: 4_000, max: REVIEW_PANEL_PROMPT_ROW_MAX_TOKENS_CAP }),
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 220_000 }),
  }),
});

export const EXECUTOR_BUDGET_DESCRIPTIONS = Object.freeze({
  'pre-site-visit.proposal-core.generate': Object.freeze({
    since: 'budget S467, timeout S466 (2026-08-28)',
    reason: 'Eight governed sections over a full proposal; Sonnet 5 adaptive thinking exhausted the prompt row\'s 16,384-token budget in production.',
  }),
  'review-synthesis.generate': Object.freeze({
    since: '2026-07-27 (commit 0afea876)',
    reason: 'One bounded recovery attempt after a provider-confirmed max_tokens truncation of the first synthesis pass.',
  }),
  'field-primer.generate': Object.freeze({
    since: 'S493 (2026-09-07)',
    reason: 'One structured primer over a full proposal narrative; the shared 120s transport timeout expired in production on Request 1002852. Output tokens stay on the prompt row.',
  }),
  'cycle-dossier.entry': Object.freeze({
    since: 'S509 (2026-09-12)',
    reason: 'One five-section briefing over the frozen narrative plus retrieved evidence; the 85s code default expired in production on Request 1002874 (first pilot-mode run). Output tokens stay on the prompt row; the research-plan stage keeps the short default.',
  }),
  'review-panel.seat': Object.freeze({
    since: '2026-09-13 (owner decision: admin-tunable ceiling, not hard-coded in the prompt row/seed)',
    reason: 'One structured review per seat, shared by both seat vendors. Adaptive thinking (Claude) and reasoning tokens (the OpenAI seat\'s max_completion_tokens) are both counted inside this same output budget, so it must be raisable as models evolve without a code change.',
  }),
  'review-panel.chair': Object.freeze({
    since: '2026-09-13 (owner decision: admin-tunable ceiling, not hard-coded in the prompt row/seed)',
    reason: 'One synthesis over every seat\'s structured review. Adaptive thinking is counted inside this same output budget, so it must be raisable as models evolve without a code change.',
  }),
});

export const EXECUTOR_BUDGET_PROMPT_NAMES = Object.freeze(
  Object.keys(EXECUTOR_BUDGET_DEFAULTS),
);

// Registry growth is additive: a durable revision published before a prompt
// name was registered is still authoritative for the names it carries, and the
// reader fills the missing names from these code defaults. Publication always
// writes the complete set. Removing or renaming a key is a schemaVersion bump.
