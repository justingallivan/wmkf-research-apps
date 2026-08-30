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
});

export const EXECUTOR_BUDGET_PROMPT_NAMES = Object.freeze(
  Object.keys(EXECUTOR_BUDGET_DEFAULTS),
);
