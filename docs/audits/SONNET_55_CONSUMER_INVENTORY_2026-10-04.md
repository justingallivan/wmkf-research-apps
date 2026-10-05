---
title: Sonnet 5.5 admission — complete LLM consumer inventory
domain: ai-runtime
kind: report
status: active
summary: "Read-only inventory of every runtime LLM consumer ahead of Sonnet 5.5 registry admission. Amended 2026-10-05: both sonnet-tier blockers are closed and the presentation summary prompt is a new Executor-covered sonnet consumer; only the owner-authorized §4 replay remains before admission."
canonical: false
owner: product-engineering
related:
  - docs/audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md
  - docs/audits/LLM_REFUSAL_HARDENING_2026-10-03.md
  - docs/MODEL_CHANGE_STRATEGY.md
  - lib/services/model-resolver.js
  - lib/utils/llm-response.js
---

# Sonnet 5.5 admission — complete LLM consumer inventory (2026-10-04)

Session 573, read-only. No runtime file was changed. This closes the prerequisite
named in `docs/audits/OPEN_ITEMS_FOLLOWUP_2026-10-03.md` ("the prerequisite is the
affected-consumer inventory, not only fixes to two routes") and in
`docs/audits/LLM_REFUSAL_HARDENING_2026-10-03.md` ("covers the listed callers, not
every LLM consumer in the repository").

## Why admission is a fleet move

[VERIFIED via source] `resolveTierSync` in `lib/services/model-resolver.js` filters
the live `/v1/models` list to ids that `isReviewedModel` accepts and returns the
newest. Review (a capability entry plus a pricing entry) is the only admission
mechanism. Adding `claude-sonnet-5-5` to `lib/services/model-capabilities.js` and
`lib/utils/model-pricing.js` therefore moves every `sonnet`-tier key in
`shared/config/baseConfig.js` `APP_MODELS` (and `CLAUDE.DEFAULT_MODEL`, which is
`sonnet` unless `CLAUDE_MODEL` is set) to Sonnet 5.5 on the next model-list load.
There is no supported way to admit the model for one prompt row only.

## Vendor contract facts used below

[VERIFIED via https://platform.claude.com/docs/en/models/sonnet-5-5/overview and
`.../whats-new-sonnet-5-5`, fetched 2026-10-04] Released 2026-09-28. $2 / $10 per
MTok, cache read $0.20 (standard 0.1× multiplier, so no `cacheReadMultiplier`
override). 1M context, 128K output. Adaptive thinking on by default; `thinking:
{type: "disabled"}` returns 400 (`between_tools` is the lowest setting). Forced
`tool_choice` `any`/`tool` returns 400. Non-default `temperature`/`top_p`/`top_k`
returns 400. Default effort `high`. Refusals arrive as HTTP 200 with
`stop_reason: "refusal"` and a `stop_details.category` in `cyber`, `bio`,
`frontier_llm`, `reasoning_extraction`, `general_harms`. Zero-data-retention
eligibility is not stated on either page (record `zeroDataRetentionEligible: null`
like the sibling entries).

[VERIFIED via grep of `lib/`, `pages/`, `shared/`] No runtime file sends
`thinking: {type: "disabled"}`, `tool_choice`, or `toolChoice`. The temperature gate
already runs through `resolveModelWithCapabilities(...).capabilities.supportsTemperature`
in `lib/services/llm-client.js` and `lib/services/multi-llm-service.js`.

## Denominator

| Population | Count | Method |
|---|---|---|
| Modules that construct `LLMClient` / `createLLMClient` (runtime, non-test) | 20 files, 27 construction sites | grep `new LLMClient(` / `createLLMClient(` |
| `complete()` / `stream()` call sites on those clients | 32 (29 direct plus 3 through the Explorer `callClaudeBatch` wrapper) | grep `.complete(` / `.stream(` / `callClaudeBatch(` |
| Call sites guarded by `requireAcceptedLlmResponse` (`lib/utils/llm-response.js`) | 22 sites in 13 files | grep |
| Call sites covered by another terminal refusal policy | 4 (Executor, reviewer-finder, Explorer chat stream, Explorer `callClaudeBatch` via its guarded callers) | read |
| Unguarded call sites | 6 sites in 5 files | remainder, each read |
| Direct `/v1/messages` callers outside `LLMClient` | `lib/services/multi-llm-service.js` (3 consumers), `lib/utils/health-checker.js` (probe). `lib/services/anthropic-admin.js`, `pages/api/cron/pricing-canary.js`, `lib/services/model-resolver.js` call only `/v1/models` or admin endpoints [VERIFIED via grep `v1/`] | grep `api.anthropic.com` / `@anthropic-ai/sdk` |
| Scripts importing the client (`scripts/run-reviewer-holistic-m1.mjs`, `scripts/audit-system-prompt-sizes.js`, `scripts/compare-phase-i-v1-v2.js`) | owner-run, not runtime | excluded |

## Covered call sites (no action)

Guarded by `requireAcceptedLlmResponse` (all `sonnet`-tier unless noted):
`pages/api/process.js`, `pages/api/process-phase-i.js`,
`pages/api/process-phase-i-writeup.js`, `pages/api/refine.js`, `pages/api/qa.js`
(stream), `pages/api/analyze-literature.js`, `pages/api/analyze-funding-gap.js`,
`pages/api/evaluate-multi-perspective.js` (primary and fallback),
`pages/api/expertise-finder/match.js`,
`lib/services/expertise-finder/batch-match-service.js`,
`lib/services/grant-reporting/extract-service.js`,
`lib/services/phase-i-dynamics/summarize-service.js`,
`lib/services/dynamics-explorer/tools/batch-processing.js` (haiku default).

Other terminal policies, each read this session:
- Executor: `lib/services/execute-prompt.js` rejects `refused || stopReason === 'refusal'`
  with `claude_output_refused` before persistence. Covers every prompt-row consumer,
  including the alignment prompt and the review-panel seats/chair via
  `lib/services/review-panel-generation.js` `runSeat` / `runChair`.
- Reviewer-finder: `lib/services/claude-reviewer-service.js` returns `refused` from its
  `complete()` wrapper and its caller records `status: 'analysis_refused'`.
  Primary is the concrete `claude-opus-4-8`; **fallback is the `sonnet` tier**, so the
  runbook §4 replay applies (see "Next gate").
- Explorer: `lib/services/dynamics-explorer/model-call.js` has two sites. The chat
  loop's `stream()` call treats refusal as terminal (PR #423); the `callClaudeBatch`
  `complete()` call is covered by the three `requireAcceptedLlmResponse` guards in
  `tools/batch-processing.js`. Default model is the `haiku` tier.

## Unguarded call sites inside the admission blast radius (blockers)

Both read a refusal as ordinary text. A refusal is HTTP 200 and can carry partial
text, so an empty-text check is not refusal handling (same point the Oct 3 audit
made about generic parse failure).

1. **`lib/services/integrity-service.js`** — `claude.complete(...)` destructures
   `{ text }` only. Empty text throws `'Invalid response from Claude API'` or returns
   an `Unable to analyze search results` string; nonempty refusal text is returned
   as the analysis. Model: `getModelForApp('integrity-screener')`. The key is **not**
   in `APP_MODELS`, so source resolves to `CLAUDE.DEFAULT_MODEL` = `sonnet`
   [VERIFIED via `shared/config/baseConfig.js` `_getModelForAppRaw` step 4].
   Effective production model is [ASSUMED sonnet]: a DB override or
   `CLAUDE_MODEL_INTEGRITY_SCREENER` takes precedence and cannot be read from this
   session; the catch block logs "Haiku analysis error", which suggests Haiku was
   intended. **Owner: confirm the effective model in Admin › Models.** If it is
   Haiku, this site leaves the blast radius and joins the Haiku list below.
2. **`lib/services/panel-review-service.js` `_runSynthesis`** — legacy interactive
   Virtual Review Panel. `MultiLLMService.call('claude', ..., { model:
   getModelForApp('virtual-review-panel') })` (`sonnet` tier) and the result's
   `.text` goes straight to `parseJSONResponse`. `MultiLLMService._callClaude` sets
   `refused`/`stopDetails` on its result but the service never reads them. A
   refusal becomes "Panel synthesis produced no parseable/valid summary" at best,
   or parses if the refusal text happens to be JSON. The fan-out stage at
   `MultiLLMService.getDefaultModel('claude')` uses the concrete
   `claude-sonnet-4-20250514` and is **outside** this admission's blast radius
   (separate finding below).

## Separate finding: first-block text extraction in the multi-LLM path

`lib/services/multi-llm-service.js` `_callClaude` returns
`text: data.content?.[0]?.text || ''`. The `summarizeContentBlocks` comment in
`lib/services/llm-client.js` records that thinking-default-on models return a
leading `thinking` block with empty text under the default `display: "omitted"`.
If that holds for Sonnet 5 synthesis calls today, VRP synthesis text extraction is
already fragile on Sonnet 5 and stays so on 5.5. **Verify before admission**, not a
confirmed bug: if VRP synthesis works in production today, either adaptive thinking
skipped the block or an override pins a different model. The fix (join all `text`
blocks, as `normalizeUnaryResponse` does) is independent of admission.

## Unguarded call sites outside the blast radius (Haiku tier — no action now)

Relevant only to a future Haiku admission. Listed so the enumeration is complete.
- `lib/services/reviewer-exclusion-parser.js` — `reviewer-exclusion` → `haiku`;
  `temperature: 0` (gated by capabilities); JSON parse of `text`.
- `pages/api/process-expenses.js` (two sites) — `expense-reporter` → `haiku`; JSON
  parse of `text`.
- `lib/services/contact-enrichment/search-tiers.js` — `contact-enrichment` → `haiku`;
  also declares `web_search_20250305`. If this key ever moves to a 4.6+ model the
  tool version needs the `_20260209` variant check (`pages/api/qa.js` already uses it).
- `pages/api/cron/log-analysis.js` — concrete `claude-haiku-4-5-20251001`; refusal
  degrades to "No analysis returned".
- `lib/utils/health-checker.js` — concrete Haiku liveness probe; response text unused.

## Amendment — 2026-10-05 (Session 577)

The sections above are the 2026-10-04 snapshot, and their counts are as of that date.
Changes on `main` since then:

1. **Integrity Screener blocker closed** [VERIFIED via `lib/services/integrity-service.js`
   and `shared/config/baseConfig.js` on `main`; commit `fbf196810`, 2026-10-04].
   `integrity-screener` is now in `APP_MODELS` as `{ model: 'haiku', fallback: 'sonnet' }`.
   The `complete()` call is wrapped in `requireAcceptedLlmResponse`. The `sonnet` fallback
   is an `LLMClient` 529-overload swap only, never a refusal retry, so it stays inside the
   blast radius but is guarded.
2. **Virtual Review Panel blocker closed** [VERIFIED via `ls` and grep on `main`; commits
   `d276790da`, merge `9240042f0`, 2026-10-04]. `lib/services/panel-review-service.js` no
   longer exists and the `virtual-review-panel` key is retired. The only remaining runtime
   import of `MultiLLMService` is `lib/services/review-panel-generation.js`, which calls
   `getAvailableProviders()` only. `_callClaude` therefore has no runtime caller, and the
   first-block text extraction finding no longer gates admission. Fix or delete it if
   `MultiLLMService.call` ever regains a caller.
3. **New sonnet consumer: `meeting-transcript.presentation-summary`** [VERIFIED via
   `scripts/seed-meeting-presentation-summary-prompt.js` on `feature/presentation-summary`,
   PR #440, not yet merged; Production prompt row seeded 2026-10-05]. The row sets
   `wmkf_ai_model: 'sonnet'` and `wmkf_ai_temperature: 0.2`. It runs through the Executor, so
   `claude_output_refused` in `lib/services/execute-prompt.js` covers refusals. The temperature
   is safe on Sonnet 5.5: `lib/services/llm-client.js` sends `temperature` only when
   `capabilities.supportsTemperature === true`, and the planned 5.5 entry sets it `false`. The
   Executor has no fallback model, so a 5.5 regression on this prompt surfaces as a failed
   Summarize rather than a silent swap.

## Decision state

- Owner decision 2026-10-04: inventory first; no registry change in this pass.
- 2026-10-05: blockers (1) and (2) from the 2026-10-04 list are closed (see the amendment).
  Admission remains **blocked** only on the runbook §4 replay below, which spends provider
  credits and needs explicit owner authorization.

## Next gate after fixes

`docs/MODEL_CHANGE_STRATEGY.md` §4 step 5: replay at least one previously
problematic proposal through `scripts/validate-reviewer-analyze.mjs` because
reviewer-finder's fallback is the `sonnet` tier. That spends provider credits and
needs explicit owner authorization; it was not run this session. Then mirror commit
`bbf6457a8` (Opus 5.5): capability entry (`thinkingMode: 'adaptive_always_on'`,
`supportsTemperature: false`, `supportsEffort: true`, `defaultEffort: 'high'`,
`maxInputTokens: 1_000_000`, `maxOutputTokens: 128_000`, `refusalSemantics:
'http_200_stop_reason_refusal'`, `requiresRefusalHandling: true`, source
`https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5`),
pricing entry `{ input: 200, output: 1000 }`, resolver and pricing tests, global
`LAST_CAPABILITY_REVIEWED_AT` unchanged so other unreviewed ids keep alerting.
