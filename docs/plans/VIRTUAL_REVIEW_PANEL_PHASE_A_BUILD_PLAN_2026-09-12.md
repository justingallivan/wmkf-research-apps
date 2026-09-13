---
title: Virtual Review Panel Phase A Build Plan (2026-09-12)
domain: virtual-review-panel
kind: plan
status: proposal
summary: "Phase A build plan for the request-scoped, admin-only Virtual Review Panel: an Executor provider seam (A0) so GPT seats run governed beside Claude seats, then the panel foundation on the Cycle Dossier scaffolding. Records the owner's 2026-09-12 decisions D1–D6."
cataloged: 2026-09-12
owner: product-engineering
last_verified: 2026-09-12
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_REVIVAL_SURVEY_2026-09-12.md
  - docs/VIRTUAL_REVIEW_PANEL.md
  - docs/CYCLE_DOSSIER_PILOT_DESIGN.md
  - docs/EXECUTOR_CONTRACT.md
  - lib/services/execute-prompt.js
  - lib/services/llm-client.js
  - lib/services/model-capabilities.js
  - lib/utils/model-pricing.js
  - lib/services/cycle-dossier-worker.js
---

# Virtual Review Panel Phase A Build Plan

> Plan, not built state. Claims about current code are `[VERIFIED 2026-09-12 via source]` unless
> labelled otherwise; everything under "Build" is `[PLANNED]`. Decisions are `[DECIDED 2026-09-12]`
> by the owner in Session 510. Nothing in this document authorises code; A0 must pass
> `/contract-reconcile` before implementation starts. VRP = Virtual Review Panel.

## 1. Decision record `[DECIDED 2026-09-12]`

| # | Decision | Outcome |
|---|---|---|
| D1 | Vendors | **Hybrid.** Reviewer seats are vendors, not personas. Launch with two seats, Claude and OpenAI (ChatGPT). Gemini and Perplexity are judged not up to the task today but the seat list must be able to grow to three or more. A Claude **chair** orchestrates; Opus is the starting chair model. Seats run on a governed Executor extended with a **provider seam** (survey option 2), not on the ungoverned `MultiLLMService`. |
| D1a | Model selection | Every seat model and the chair model are **selectable in the admin model panel** the same way Claude models are today, filtered by vendor. |
| D1b | Structured output | **Identical treatment for both vendors**: post-hoc `validationSchema` enforcement in the Executor, no API-native structured output for either seat in Phase A. Revisit later. |
| D2 | Inputs | **Proposal narrative only.** Materials text, the four AI memos, biosketches, budget, field primer and dossier entry are all out of Phase A. |
| D3 | Human reviews | Deferred (Phase C). Blind panel; the seat output schema stays in lockstep with the human review form so a later comparison lines up. |
| D4 | Publication | Deferred (Phase B). Private Blob editions only. |
| D5 | Old app | Unchanged. The upload-based page stays live until parity; no retirement work in Phase A. |
| D6 | Cost posture | **No "typical cost" figure yet.** Run the panel on a small owner-chosen subset first and collect real actuals from `api_usage_log`, then decide. Same posture as the dossier's open figure. |

## 2. What exists today `[VERIFIED 2026-09-12 via source]`

- **Executor is Anthropic-only by construction, not by allowlist.** `executePrompt` resolves the
  prompt row's `wmkf_ai_model` through `resolvePromptClaudeModel` → `resolveModelWithCapabilities`
  (`lib/services/execute-prompt.js:495-513`) and constructs `new LLMClient({ apiKey, model })` with
  `apiKey = process.env.CLAUDE_API_KEY` (`:550-586`); `LLMClient` posts to a hardcoded
  `https://api.anthropic.com/v1/messages` (`lib/services/llm-client.js:37`). The SSRF allowlist in
  `lib/utils/safe-fetch.js` already permits `api.openai.com` (`:43`, used by the old panel), so no
  allowlist change is needed.
- **No caller-supplied model.** The `executePrompt` option list (`execute-prompt.js:88-105`) has no
  `model`/`modelOverride`; the model comes only from the prompt row, falling back to
  `BASE_CONFIG.CLAUDE.DEFAULT_MODEL`. Admin per-seat selection therefore needs a new option (A0.3).
- **Capability registry already carries a vendor field.** Every `MODEL_CAPABILITIES` row has
  `provider: 'anthropic'` plus `supportsTemperature`, `supportsStructuredOutput`, `maxOutputTokens`,
  a retention class, `reviewedAt` and `source` (`lib/services/model-capabilities.js:17-40`). Pricing
  in `MODEL_PRICING` is **cents per million tokens** (`lib/utils/model-pricing.js:33-35`).
  `check:model-registry` requires a capability and pricing row for every concrete id reachable from
  config (`scripts/check-model-registry.js` header); its wording is Anthropic-named but its scan is
  structurally vendor-agnostic.
- **Admin model panel.** `pages/admin.js` (Models section around `:1118-1271`) → `/api/admin/models`
  stores `model_override:<appKey>:<modelType>` via `settings-service` (`pages/api/admin/models.js:202`);
  `VALID_MODEL_TYPES = ['model','visionModel','fallback']` (`:26`); the dropdown lists the live
  Anthropic `/v1/models` list validated by `validateReviewedClaudeModelValue`. `getModelForApp`
  reads override → `APP_MODELS` → default (`shared/config/baseConfig.js:283-286`). Routes that
  resolve a model must call `loadModelOverrides()` first (`check:model-override-warming`).
- **Old panel's OpenAI adapter** (`lib/services/multi-llm-service.js:310-340`, `_callOpenAI`):
  chat-completions with a bearer key, `max_completion_tokens`, passes `temperature` unconditionally
  (breaks on reasoning models), default `gpt-4o` (`:48`), own `logUsage` under
  `app_name='virtual-review-panel'` (`:160-192`). Its only importers are
  `lib/services/panel-review-service.js` (fan-out per provider via `getDefaultModel`, `:364`) and
  `pages/api/virtual-review-panel.js`.
- **Server-owned vendor allowlist exists**: `resolveAllowedProviders` in `lib/utils/vrp-providers.js`
  intersects `VRP_ALLOWED_PROVIDERS` with keyed providers and returns an empty set in production
  when unset (fail closed). The old route additionally requires `claude` in the set
  (`pages/api/virtual-review-panel.js:105-120`). `OPENAI_API_KEY` is a tracked secret in
  `docs/CREDENTIALS_RUNBOOK.md:83`.
- **Dossier scaffolding to clone**: `lib/services/cycle-dossier-{service,worker,generation,store,
  storage,documents,rollout}.js`, `pages/api/cycle-dossier/*`, `/api/cron/drain-cycle-dossiers`,
  migrations 045–046, `scripts/seed-cycle-dossier-prompts.js`, `snapshotConfiguration`
  (`cycle-dossier-generation.js:170`, pins prompt rows + budgets + pricing per run), the
  `cycle-dossier.entry` executor budget (`shared/config/executorBudgets.js:28`), A7 registry row
  `cycle-dossier-generation` (`scripts/check-prompt-injection-tagging.js:443`), three security-matrix
  rows (`docs/API_ROUTE_SECURITY_MATRIX.md:351-353`). The worker holds one global run lease admitting
  a pool of three entries, checkpoints each stage under the lease, and never auto-retries an ambiguous
  metered call (`cycle-dossier-worker.js:1-3`); `operatorStopSignal` (`:72`) and
  `describeEntryFailure` (`:188`) are the stop and failure-copy seams. Narrative resolver:
  `prepareRequestInput` → `getAiProposalNarrativeText` (identity-pinned, hashed, 100k-char bound;
  survey §2).
- **Migration numbering**: next migration is 047 → fresh-install block v49 (SESSION_PROMPT §Verify).

## 3. App identity `[PLANNED]`

- **New app key `review-panel`**, registry name "Review Panel", category `phase-ii`, admin-assigned,
  page `/review-panel`. Distinct from the live `virtual-review-panel` key so both coexist until D5.
  The key propagates to: `shared/config/appRegistry.js`, `requireAppAccess(req, res, 'review-panel')`
  on every route, `API_ROUTE_SECURITY_MATRIX.md` rows, the A7 registry id `review-panel-generation`,
  `api_usage_log.app_name = 'review-panel'` (so D6 actuals are separable from the old panel), and
  the executor-budget keys `review-panel.seat` / `review-panel.chair`.
- Rollout env vars mirror the dossier and are **readable config, not secrets**:
  `REVIEW_PANEL_ENABLED`, `REVIEW_PANEL_ROLLOUT_MODE` (`smoke`|`pilot`), `REVIEW_PANEL_REQUEST_ALLOWLIST`.
- Seat vendors are gated by the existing `VRP_ALLOWED_PROVIDERS` through `resolveAllowedProviders`,
  fed the vendors that have a key and a client on the new seam (not `MultiLLMService`). The chair is
  Claude unconditionally, so `claude` must be in the set, as the old route already requires.

## 4. Phase A0: Executor provider seam `[PLANNED]`

A0 is a shared-contract change touching every Executor consumer. It lands as its own PR, passes
`/contract-reconcile`, and is gated before any panel code depends on it. Behaviour for every existing
prompt row (all Anthropic) must be unchanged.

**A0.1 Vendor dispatch.** `executePrompt` derives the vendor from the resolved model's capability row
(`capabilities.provider`). `provider === 'anthropic'` → existing `LLMClient` path, unchanged.
`provider === 'openai'` → new `lib/services/openai-client.js`. Unknown model or unknown provider →
the existing unreviewed-model error (already fail-closed). No prompt-row schema change: vendor is a
property of the model id, not a new Dataverse column.

**A0.2 OpenAI client.** Same public contract as `LLMClient.complete()`: normalized
`{ text, inputTokens, outputTokens, model, stopReason }`, external `AbortSignal` honoured across
attempts and backoff, per-attempt `timeoutMs`, 429/5xx retry with the same backoff policy, bearer
`OPENAI_API_KEY` read server-side, `safeFetch`, `max_completion_tokens`, **temperature sent only when
`supportsTemperature` is true**. Refusal/finish-reason mapping documented in the capability row.
Usage logged through the Executor's existing `api_usage_log` path (the client itself does not log).
`MultiLLMService` is not modified; the old panel keeps its own path until D5.

**A0.3 Caller-supplied model.** New `executePrompt` option `modelOverride` (concrete id or tier).
It goes through the same `resolveModelWithCapabilities` unknown-model gate as the prompt row's model,
is recorded on the `wmkf_ai_run` row and in the caller's config snapshot, and its precedence against
a `promptSnapshot` that pins a different model is decided in contract-reconcile (snapshot wins, or
the call fails). Without this option per-seat admin selection is impossible.

**A0.4 Registries.** Add OpenAI rows to `MODEL_CAPABILITIES` (`provider: 'openai'`,
`supportsStructuredOutput: false` for Phase A per D1b, `supportsTemperature` per model, retention
class) and `MODEL_PRICING`. **Every value is verified from OpenAI's published documentation with a
`source:` URL and `reviewedAt` at implementation time; none is guessed.** The default OpenAI seat
model is `[OWNER-SUPPLIED at seed time]`. `check:model-registry` and
`validateReviewedClaudeModelValue` are generalised to vendor-aware equivalents; the gate must cover
OpenAI ids reachable from seat config.

**A0.5 Admin model panel.** Let an app declare **named model slots** in a tracked registry
(`shared/config/reviewPanelSeats.js`: `{ key, vendor, label, enabled, defaultModel }` for
`seat.claude`, `seat.openai`, and `chair`) alongside the existing `model`/`visionModel`/`fallback`
types. `/api/admin/models` lists, for each slot, the reviewed models of that slot's vendor (Anthropic
from the live `/v1/models` list as today; OpenAI from the reviewed capability rows, optionally
cross-checked against OpenAI's `/v1/models`). Override key shape stays
`model_override:review-panel:<slotKey>`. Adding a third seat is a registry edit plus
capability/pricing rows, not a schema change.

**A0.6 Prompt-injection.** The Executor's `wrapUntrustedContent` + `buildUntrustedContentPreamble`
apply identically on the OpenAI path because wrapping happens before dispatch. The A7 registry row
`execute-prompt-executor` continues to cover it; A0 adds a unit test that the OpenAI path receives
the wrapped body and the preamble.

**A0 exit criteria:** all existing Executor unit tests unchanged and green; new tests for dispatch,
override precedence, temperature gating, abort propagation, and unknown-vendor fail-closed;
`check:model-registry`, `check:model-override-warming`, `check:prompt-injection-tagging`, `check:types`
green; `docs/EXECUTOR_CONTRACT.md` updated with `modelOverride` and the vendor rule.

## 5. Phase A: panel foundation `[PLANNED]`

**A.1 Registry, access, matrix.** App key per §3; `requireAppAccess` + service-level superuser actor
assertion on every entry (dossier pattern); rows for `/api/review-panel`, `/api/review-panel/download`,
`/api/cron/drain-review-panels` in the security matrix; `check:api-routes` and
`check:route-lifecycle-auth` green.

**A.2 Roster and rollout.** Reuse the dossier's server-scoped Research roster and selection model
(explicit include list, Include all / Exclude all). Rollout gates cloned from
`cycle-dossier-rollout.js`: enabled flag, mode, request allowlist, durable operator stop in
`review_panel_control`.

**A.3 Governed prompts.** `scripts/seed-review-panel-prompts.js` seeds two prompt rows:
- `review-panel.seat`: one reviewer prompt shared by every seat, run blind. Output
  `validationSchema` derived from `lib/external/review-form-schema.js` rather than duplicated, so
  D3 cannot drift. Seat identity is not in the prompt; the model differs per seat via `modelOverride`.
- `review-panel.chair`: synthesis over N seat reviews, reusing the existing synthesis shape
  (`ratingMatrix`, `consensus`, `disagreements`, `keyStrengths`, `keyConcerns`, `questionsForPI`,
  `resolvableVsFundamental`, `panelRecommendation`, `confidenceNote`). Claim verification and
  devil's advocate fields are absent in Phase A.
The old `createStructuredReviewPrompt` / `createPanelSynthesisPrompt` text
(`shared/config/prompts/virtual-review-panel.js:382,515`) is the starting draft.

**A.4 Input.** `prepareRequestInput` narrative only (D2). Proposal text is declared as an untrusted
variable; the A7 registry gains row `review-panel-generation`.

**A.5 Run contract.** Tables `review_panels`, `review_panel_runs`, `review_panel_entries`,
`review_panel_seat_reviews`, `review_panel_control` in migration 047 (block v49), with per-request
revision numbers from day one. Per entry: seats run in parallel, each a separate `executePrompt` with
`promptSnapshot`, `requireNoPersistence`, `deadlineMs`, `signal` (operator stop), `modelOverride`
from the pinned snapshot; then the chair. **The snapshot pins resolved seat models and vendors per
run** so an admin change mid-run cannot shift models. **Partial-seat policy:** a failed seat fails the
entry; each seat is its own checkpoint so "Retry failed entries" re-pays only the failed seat and
the chair. The chair never runs on fewer seats than configured. Executor budgets `review-panel.seat`
and `review-panel.chair` registered in `executorBudgets.js` with admin-tunable envelopes.

**A.6 Worker and cron.** Clone `cycle-dossier-worker.js`: single global lease, per-minute drain cron
under strict `CRON_SECRET`, stop re-read before every paid call, `describeEntryFailure`-style plain
copy. Cron entry in `vercel.json` only when the owner enables it (dossier precedent).

**A.7 Editions.** Private Blob DOCX + PDF per entry with SHA-256/size/path refs, structural DOCX
verification, download route with `Cache-Control: private, no-store` and `X-Frame-Options: SAMEORIGIN`
for the PDF preview. Report sections: rating matrix, panel summary, per-seat reviews (labelled by
vendor and pinned model), cost breakdown from actuals. No SharePoint (D4).

**A.8 Page.** `/review-panel` on the dossier page skeleton with its hardened affordances: inline error
beside Launch, Progress tab default while unsettled, per-row Word/PDF links, Include all / Exclude
all, "Retry failed entries", reservation bound only (no typical figure, D6). Seat and chair models
are shown read-only on the page and changed in the admin model panel.

**A.9 Docs and gates.** Atlas page for the new tables; `docs/VIRTUAL_REVIEW_PANEL.md` gains a
"successor" pointer; wiki topic page; `CREDENTIALS_RUNBOOK.md` rows for the three rollout vars;
`check:atlas`, `check:api-routes`, `check:prompt-injection-tagging`, `check:status-enum-parity`,
`check:model-override-warming`, `check:types` green.

## 6. Smoke and data collection (D6)

1. Owner picks a **small subset** (two to four D26 requests) and sets `REVIEW_PANEL_ROLLOUT_MODE=smoke`
   with that allowlist via `! vercel env add …` lines supplied by the agent.
2. One run; record per seat and chair: wall time, input/output tokens, cost from `api_usage_log`
   (`app_name='review-panel'`), validation failures, and the reservation bound the page showed.
3. Owner reads the reports against the human review synthesis for those requests (informal; the
   formal comparison is D3 / Phase C).
4. Decide the typical-cost figure and whether to widen the allowlist.

## 7. Sequencing and release tier

| Slice | Branch | Tier | Gate before merge |
|---|---|---|---|
| A0 Executor seam + registries + admin slots | `feature/executor-provider-seam` | Tier 2 (shared runtime) | `/contract-reconcile`, full Executor tests, model-registry, override-warming, A7 gate |
| A.1–A.5 tables, prompts, service | `feature/review-panel-foundation` | Tier 2 | atlas, api-routes, route-lifecycle-auth, unit tests, migration applied to preview |
| A.6–A.8 worker, editions, page | same branch | Tier 2 | rehearsal scripts cloned from `scripts/rehearse-cycle-dossier-*.mjs`; Playwright smoke |
| §6 smoke | production, `smoke` mode | operator | owner-run env commands; actuals reviewed |

Phase B (claim verification via the dossier research stage, devil's advocate, SharePoint publication)
and Phase C (panel-vs-human comparison, history views, third seat) follow the survey §5 unchanged.

## 8. Open items carried into implementation

- Snapshot-vs-override precedence when both are set (A0.3): resolve in contract-reconcile.
- Chair input size: N full seat reviews plus narrative may be large for the chair; decide whether
  the chair receives the narrative or only the reviews.
- OpenAI reasoning models: `max_completion_tokens` includes reasoning tokens; the capability row and
  budget envelope must reflect that.
- Whether `getModelForApp` slot semantics or a separate settings prefix is cleaner for named slots.
- Old-page parity definition for D5 (not before Phase B).
