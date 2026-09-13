---
title: Executor Provider Seam — Codex Brief (2026-09-12)
domain: virtual-review-panel
kind: plan
status: active
summary: "Codex build brief for Phase A0 of the Virtual Review Panel plan: opt-in provider dispatch in the Executor, an OpenAI client with normalised stop reasons and usageComplete, error-attached usage, vendor-aware model validation and registry gate, vendor-bound admin model slots. Owned-file boundary, contracts, gates, handoff."
cataloged: 2026-09-12
owner: product-engineering
last_verified: 2026-09-12
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/EXECUTOR_CONTRACT.md
  - lib/services/execute-prompt.js
  - lib/services/llm-client.js
---

# Executor Provider Seam — Codex Brief (2026-09-12)

## Where you are

You are in `../WMKF_Apps-codex` on branch `codex/executor-provider-seam`, cut from `origin/main`.
Run `/start`, read `CLAUDE.md`, then read **all of**
`docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md` (§1 decisions, §2 verified state,
§4 Phase A0, §9 review history). **Stay on this branch and directory.** Another agent works in the
main checkout; do not check out other branches, pull `main` into this branch, or push to `main`.
Commit to this branch with descriptive messages and `git push -u origin codex/executor-provider-seam`
(pushing a feature branch does not deploy). Claude reviews read-only and merges on the owner's go.

## Goal

Build **Phase A0 only** (plan §4): the Executor can run a governed prompt against OpenAI when, and
only when, the caller explicitly allows that provider. Every existing Executor prompt (all Anthropic)
behaves exactly as before. Phase A (tables, worker, page) is **not** in this brief.

## Owned file surface (the safety boundary)

You may edit:
- `lib/services/execute-prompt.js` — `allowedProviders` option, dispatch, error-attached usage,
  `usageComplete` on result and error (§4 A0.1, A0.4)
- `lib/services/llm-client.js` — **additive only**: `usageComplete` on `normalizeUnaryResponse` /
  `normalizeStreamResponse`; no behaviour change for existing callers (27 callers)
- `lib/services/openai-client.js` — **new** (A0.2)
- `lib/services/model-capabilities.js`, `lib/utils/model-pricing.js` — OpenAI rows (A0.5)
- `lib/services/model-review-validation.js` — vendor-aware validation (A0.6); keep the existing
  export name working for current callers
- `scripts/check-model-registry.js` — provider-keyed validation (A0.5)
- `pages/api/admin/models.js` and `pages/admin.js` — named slots, vendor-filtered lists,
  vendor-checked PUT (A0.6)
- `shared/config/reviewPanelSeats.js` — **new** seat/slot registry (A0.6)
- `shared/config/baseConfig.js` — **only** an `APP_MODELS['review-panel']` entry if the GET needs it
- `lib/utils/tracked-secrets.js` — add `OPENAI_API_KEY` (A0.5)
- `docs/EXECUTOR_CONTRACT.md` — `allowedProviders`, vendor rule, error-attached usage, `usageComplete`
- `docs/CREDENTIALS_RUNBOOK.md` — `OPENAI_API_KEY` row: add "Executor provider seam (opt-in)" consumer
- tests: `tests/unit/execute-prompt-*.test.js` (new files welcome), `tests/unit/llm-client.test.js`
  (additive), `tests/unit/openai-client.test.js` (new), `tests/unit/model-review-validation.test.js`,
  `tests/unit/model-resolver.test.js`, `tests/unit/admin-models.test.js`, `tests/unit/model-pricing.test.js`
- this brief (handoff section)

Do **not** touch `lib/services/multi-llm-service.js`, `lib/services/panel-review-service.js`,
`pages/api/virtual-review-panel.js`, `lib/services/admin/prompts-publish-service.js` (publishing stays
Claude-only by leaving it alone), `lib/services/cycle-dossier*`, `lib/utils/usage-logger.js`,
`pages/api/cron/*`, `pages/api/admin/stats.js`, any migration, or `scripts/setup-database.js`.
If A0 needs a change outside this surface, stop and write it in the handoff instead of making it.

## Contracts that must hold (plan §4 is authoritative; these are the checks)

1. **Default deny.** `executePrompt` without `allowedProviders` behaves byte-for-byte as today for
   Anthropic rows. A prompt whose resolved model has `capabilities.provider === 'openai'` fails with
   `provider_not_allowed` **before variable resolution** unless `allowedProviders` includes `openai`.
   Unknown model or unknown provider keeps the existing unreviewed-model error.
2. **No new model option.** Do not add `modelOverride` or any caller-supplied model. Per-seat models
   arrive through `promptSnapshot` (plan A0.3); `validatePromptSnapshot` is unchanged.
3. **OpenAI client contract** (plan A0.2): same shape as `LLMClient.complete()`; `system` array
   flattened to one message under the capability row's `instructionRole`; temperature only when
   `supportsTemperature`; `max_completion_tokens`; stop mapping `stop→end_turn`, `length→max_tokens`,
   `content_filter→refusal`; a non-empty `message.refusal` sets `refused: true` regardless of finish
   reason; unmapped finish reasons pass through unchanged (the Executor rejects them);
   `providerFinishReason` kept; `usage.cacheCreationTokens = cacheReadTokens = 0`; `usageComplete`
   true only when raw `usage.prompt_tokens` and `usage.completion_tokens` are present, finite,
   non-negative. `OPENAI_API_KEY` read server-side; `safeFetch` (host already allowlisted).
4. **Usage survives failure** (plan A0.4): every error thrown after a provider response carries
   `err.usage` (snake_case, same as the success result), `err.modelUsed`, `err.provider`,
   `err.usageComplete`, `err.paidCall` (`true` response received, `false` failed before dispatch,
   `null` aborted after dispatch with no response). Success result carries `usageComplete` and
   `meta.provider`. The Executor still does not write `api_usage_log`.
5. **Registries** (plan A0.5, D10): OpenAI capability rows carry `provider: 'openai'`,
   `instructionRole`, `refusalField: 'message.refusal'`, `supportsStructuredOutput: false`,
   `supportsTemperature`, `maxOutputTokens`, retention fields, `reviewedAt`, `source` URL. **Every
   value comes from OpenAI's published docs; the concrete id for "GPT Sol" is verified against
   OpenAI's model list. If you cannot verify the id or a value, stop and record it in the handoff —
   never guess.** `check:model-registry` validates keys by `provider`, checks non-Claude configured
   values, and scans `reviewPanelSeats.js` defaults. Leave the stale `gpt-4o`/`o3-mini` pricing rows.
6. **Vendor-bound slots** (plan A0.6): `reviewPanelSeats.js` exports `{ key, vendor, label, enabled,
   defaultModel }` for `seat.claude`, `seat.openai`, `chair` (vendor `anthropic`). GET lists per slot
   only reviewed models whose `provider` equals the slot vendor. PUT rejects (400) a model whose
   provider differs from the slot vendor or lacks capability/pricing rows. Do **not** route this
   through the existing `allowNonClaude` escape. Existing `model`/`visionModel`/`fallback` behaviour
   for other apps is unchanged.
7. **A7 unchanged** (plan A0.7): wrapping happens before dispatch; test that the OpenAI path emits the
   preamble under `instructionRole` and the wrapped body in the user message, and that an injected
   "ignore previous instructions" fixture inside the wrapped block does not alter the output schema.
8. **Discriminating tests.** For each contract above, the test must fail if the guard is removed:
   default-deny with an OpenAI row and no `allowedProviders`; dispatch by provider; temperature
   gating both ways; instruction role both values; refusal via `message.refusal` with
   `finish_reason=stop`; each stop mapping; abort propagation; error-attached usage on invalid JSON,
   schema failure, refusal, truncation; `usageComplete` false on missing/malformed raw usage on both
   success and failure paths; slot PUT vendor mismatch; registry gate red on a `provider`-less row.

## Gates you own (run each gate and its `:self-test` sequentially, never in parallel)

`npx jest tests/unit/execute-prompt tests/unit/llm-client tests/unit/openai-client tests/unit/model
tests/unit/admin-models tests/unit/pricing-canary` · `npm run check:types` ·
`npm run check:model-registry && npm run check:model-registry:self-test` ·
`npm run check:model-override-warming && npm run check:model-override-warming:self-test` ·
`npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test` ·
`npm run check:secret-scan && npm run check:secret-scan:self-test` · `npm run check:doc-currency` ·
`npm run check:api-routes` · changed-file ESLint · `npm run build`.

## Out of scope

Phase A tables, worker, cron, page, seat/chair prompts, spend-check and admin-stats ledger queries,
the dossier's `loggedExecute`, `MultiLLMService`, prompt publishing, any migration, any Vercel env
change (hand the owner `! vercel env …` lines in the handoff if one is needed).

## Handoff (Codex writes this)

_(empty — Codex records: what landed, commits, gates run with results, anything outside the owned
surface that Claude must do at promotion, and any value it could not verify.)_
