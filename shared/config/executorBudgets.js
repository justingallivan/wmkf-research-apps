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
  // review-panel.seat and review-panel.chair use 'timeout' (output tokens stay
  // on the prompt row, like cycle-dossier.entry), not 'standing': the panel's
  // prompt rows (A.3) are not seeded in Phase A slice 1, and assertModelCeilings
  // would call fetchCurrentPrompt for any non-'timeout' kind, blocking budget
  // publication for every registered prompt (not just the panel's) before then.
  // For the OpenAI seat (gpt-5.6-sol, MODEL_CAPABILITIES `instructionRole:
  // 'developer'`), OpenAI's max_completion_tokens counts reasoning tokens
  // toward the same ceiling as the visible answer, so the eventual
  // review-panel.seat prompt row's wmkf_ai_maxtokens must be sized with
  // headroom beyond a Claude-only synthesis budget (see review-synthesis.generate
  // above) to leave room for reasoning before the final structured review; both
  // seat vendors share this one timeout envelope.
  'review-panel.seat': Object.freeze({
    kind: 'timeout',
    timeoutMsOverride: 200_000,
  }),
  'review-panel.chair': Object.freeze({
    kind: 'timeout',
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
  'review-panel.seat': Object.freeze({
    timeoutMsOverride: Object.freeze({ min: 60_000, max: 220_000 }),
  }),
  'review-panel.chair': Object.freeze({
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
    since: 'Phase A slice 1 (2026-09-12)',
    reason: 'Registered ahead of the seat prompt (A.3) so the envelope exists before the first governed run; cloned from cycle-dossier.entry\'s timeout-only shape. [ASSUMED] envelope, not yet exercised by a real run.',
  }),
  'review-panel.chair': Object.freeze({
    since: 'Phase A slice 1 (2026-09-12)',
    reason: 'Registered ahead of the chair prompt (A.3); cloned from cycle-dossier.entry\'s timeout-only shape. [ASSUMED] envelope, not yet exercised by a real run.',
  }),
});

export const EXECUTOR_BUDGET_PROMPT_NAMES = Object.freeze(
  Object.keys(EXECUTOR_BUDGET_DEFAULTS),
);

// Registry growth is additive: a durable revision published before a prompt
// name was registered is still authoritative for the names it carries, and the
// reader fills the missing names from these code defaults. Publication always
// writes the complete set. Removing or renaming a key is a schemaVersion bump.
