/**
 * Server-owned Executor output budgets, keyed by prompt name.
 *
 * `executePrompt` takes `max_tokens` from the prompt row (`wmkf_ai_maxtokens`,
 * default 16 384) unless the caller passes `maxTokensOverride`. Those overrides
 * live in caller code, so the Admin "Prompt templates" panel could not show the
 * budget a prompt actually runs with — and Anthropic's per-model output ceilings
 * (and how adaptive thinking counts against them) change quietly. This registry
 * is the single source both sides import: the callers read their numbers from
 * here, and the panel renders the same object, so what is displayed is what is
 * used by construction.
 *
 * Dependency-free on purpose (imported by the client bundle and by services).
 * Keys must byte-match the prompt names the callers pass to `executePrompt`.
 * Adding or changing an entry is a reviewed commit; the caller tests pin the
 * literal values so a silent edit here fails loudly.
 *
 * Shapes:
 * - `standing`: `{ maxTokensOverride, timeoutMsOverride?, since, reason }` —
 *   applied on every invocation.
 * - `retry`: `{ floor, ceiling, since, reason }` — the first attempt uses the
 *   prompt row; a provider-confirmed `max_tokens` truncation is retried once at
 *   `min(max(first × 2, floor), ceiling)`.
 *
 * Contract: docs/EXECUTOR_CONTRACT.md (§ maxTokensOverride / timeoutMsOverride).
 */

export const EXECUTOR_BUDGETS = Object.freeze({
  'pre-site-visit.proposal-core.generate': Object.freeze({
    kind: 'standing',
    maxTokensOverride: 32_768,
    timeoutMsOverride: 240_000,
    since: 'S467 (2026-08-28)',
    reason: 'Eight governed sections over a full proposal; Sonnet 5 adaptive thinking exhausted the prompt row\'s 16 384 (production run f8bb1326).',
  }),
  'review-synthesis.generate': Object.freeze({
    kind: 'retry',
    floor: 16_000,
    ceiling: 32_000,
    since: 'S432',
    reason: 'One bounded recovery attempt after a provider-confirmed max_tokens truncation of the first synthesis pass.',
  }),
});

/** Registry entry for a prompt name, or null when the prompt uses its row budget only. */
export function lookupExecutorBudget(promptName) {
  return EXECUTOR_BUDGETS[String(promptName || '').trim()] || null;
}
