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

### Prepared in this working tree

- Added the opt-in Executor provider seam. `allowedProviders` defaults to `['anthropic']`, an
  unallowed provider fails before variable resolution, reviewed providers dispatch to their own
  client, and prompt snapshots remain the only per-call model source.
- Added the Chat Completions `OpenAIClient` with `safeFetch`, timeout/retry/abort behavior, reviewed
  instruction-role shaping, `max_completion_tokens`, refusal/finish-reason normalization, redacted
  errors, and complete/incomplete raw-usage tracking. It does not write `api_usage_log`.
- Added `usageComplete` to both `LLMClient` normalization paths and propagated provider, usage,
  model, and `paidCall` metadata across Executor success and failure paths.
- Added the reviewed/priced `gpt-5.6-sol` registry entry, provider-aware model validation and model
  registry checks, `OPENAI_API_KEY` secret tracking, and the fixed three-slot review-panel registry.
- Added provider-bound admin GET/PUT behavior and UI controls for `seat.claude`, `seat.openai`, and
  `chair`, while preserving the existing app model controls.
- Updated the Executor and credential contracts. Added discriminating tests for all eight contracts,
  including the A7 boundary through the actual OpenAI request shaper.

### Published OpenAI verification

- `[VERIFIED via OpenAI model docs]` The concrete model id is `gpt-5.6-sol`; Chat Completions is a
  supported endpoint; the context window is 1,050,000; max output is 128,000; default reasoning
  effort is `medium`; pricing is $4/M input and $20/M output:
  https://developers.openai.com/api/docs/models/gpt-5.6-sol
- `[VERIFIED via OpenAI Chat Completions reference]` Newer models use `developer` messages;
  `max_completion_tokens`, `message.refusal`, `prompt_tokens`, and `completion_tokens` are published
  request/response fields:
  https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- `[VERIFIED via OpenAI data-controls docs]` `/v1/chat/completions` is not used for training, has
  standard 30-day abuse-monitoring retention, and is Zero Data Retention eligible subject to the
  documented limitations: https://developers.openai.com/api/docs/guides/your-data
- `[UNVERIFIED]` OpenAI's published GPT-5.6 guidance does not state that `temperature` is compatible
  with Chat Completions at GPT-5.6 Sol's default `medium` reasoning effort. The capability is
  therefore conservatively disabled and the client omits the field. Promotion must not enable it
  until a model-specific OpenAI source verifies that exact combination.

### Verification completed sequentially

- `/start`: git state and required symlinks verified; every discovered `check:*` gate and its
  self-test passed sequentially. Branch base remained `4eaabc9347966f998cd192905c6e634c51412380`; no
  pull or branch switch occurred.
- Scoped Jest gate: 14/14 suites and 186/186 tests passed.
- `npm run check:types`: passed.
- `check:model-registry`: passed (43 configured values, 4 tier fallbacks, 14 capability entries),
  then its self-test passed 6/6.
- `check:model-override-warming`: passed (212 routes), then its self-test passed 17/17.
- `check:prompt-injection-tagging`: passed (29 migrated surfaces, 0 pending), then its self-test
  passed 18/18.
- `check:secret-scan`: passed (3,603 tracked text files), then its self-test passed.
- `check:doc-currency`: passed, then its self-test passed 13/13.
- `check:api-routes`: passed with the existing warnings for the three external-material token
  routes, then its self-test passed.
- Changed-file ESLint: passed with 0 errors and 10 pre-existing
  `react-hooks/set-state-in-effect` warnings in `pages/admin.js`.
- `npm run build`: passed. The existing pre-site-visit dynamic-filesystem Turbopack warning and Node
  `localStorage` experimental warnings remained; the migrations manifest did not change.
- `git diff --check`: passed.

### Commit and push status

- No commit could be created in this sandbox. `git add` was denied while Git tried to create
  `/Users/gallivan/Code/WMKF_Apps/.git/worktrees/WMKF_Apps-codex/index.lock`; that shared metadata is
  outside the writable worktree and the task expressly forbids touching the main checkout.
- `git push -u origin codex/executor-provider-seam` was attempted after verification and failed
  because the sandbox could not resolve `github.com`. The remote feature branch therefore has no
  Phase A0 commit from this working tree.
- A host-authorized promotion session must stage only the owned files, make small descriptive
  commits, rerun the relevant gates if staging changes content, and then run:
  `git push -u origin codex/executor-provider-seam`. Do not merge or deploy as part of that step.

### Promotion follow-ups outside the owned surface

- The whole-flow contract sweep found active durable descriptions that still call the Executor
  Anthropic-only. Reconcile `docs/SERVICE_AND_UTILITY_CATALOG.md`,
  `docs/APPLICATION_STATE_ATLAS.md`, `docs/AI_DATA_FLOW_MATRIX.md`, and
  `docs/agent-wiki/topics/prompt-executor.md` during promotion. The Phase A build plan's verified-state
  section must also be advanced from its pre-A0 snapshot. They were left untouched to respect this
  brief's owned-file boundary.
- `[UNVERIFIED]` Live Vercel environment presence of `OPENAI_API_KEY` was not probed or changed. The
  owner should run `! vercel env ls`; only if the key is absent in an intended environment, run
  `! vercel env add OPENAI_API_KEY preview` and/or
  `! vercel env add OPENAI_API_KEY production` through the normal secret-entry flow.
- No migration, live provider call, environment mutation, merge, or deployment was performed.
