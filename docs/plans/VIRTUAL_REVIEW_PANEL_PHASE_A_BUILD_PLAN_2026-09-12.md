---
title: Virtual Review Panel Phase A Build Plan (2026-09-12)
domain: virtual-review-panel
kind: plan
status: proposal
summary: "Phase A build plan for the request-scoped, admin-only Virtual Review Panel: an opt-in Executor provider seam (A0) so GPT seats run governed beside Claude seats, then the panel foundation with a per-seat attempt ledger. Records the owner's 2026-09-12 decisions D1–D8 and the Codex adversarial review revision."
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
| D6 | Cost posture | **No "typical cost" figure yet.** Run the panel on a small owner-chosen subset first and collect real actuals from the `review_panel_seat_attempts` ledger (A0.4; `api_usage_log` is a cross-check only), then decide. Same posture as the dossier's open figure. |
| D7 | Team-capacity question `[DECIDED 2026-09-12: option 1]` | The required human-form question `teamCapacity` asks about personnel, infrastructure, and budget, but D2 excludes budget and biosketches. **Decision: narrative only, enforced.** Seats emit `teamCapacity` as `{ status: 'not_assessable' }` with no answer text; the seat `validationSchema` rejects any answer text for that key; the chair prompt receives no `teamCapacity` content and the report prints the question as "Not assessed in Phase A (budget and team materials not provided)". Widening D2 remains a Phase B/C option. Raised by the Codex adversarial review 2026-09-12. |
| D8 | Provider scope `[DECIDED 2026-09-12 by revision]` | Prompt publishing stays Claude-only. Non-Anthropic dispatch happens only when the calling service explicitly allows that provider on the call, intersected with `VRP_ALLOWED_PROVIDERS`. No existing Executor prompt can be repointed at OpenAI by an admin edit. |
| D9 | Chair input `[DECIDED 2026-09-12: option b]` | The chair receives the N seat reviews **and** the proposal narrative, so it can arbitrate factual disagreements against the source. Consequences pinned for A.3/A.5: the chair prompt declares `proposal_narrative` as an untrusted A7 variable with the same 100k-char bound as the seats plus one `seat_reviews` JSON variable; the chair's context cap and `review-panel.chair` budget envelope are sized for narrative + N reviews (roughly 2× the reviews-only input); the chair's cost is a separate attempt row. |
| D10 | Default OpenAI seat model `[DECIDED 2026-09-12, provisional]` | Owner: **"GPT Sol"** (the owner expects to change this). The Codex CLI catalog names it `gpt-5.6-sol`; the **concrete OpenAI API model id is verified at seed time against OpenAI's published model list and docs**, never assumed from the CLI name. Its capability row (`instructionRole`, `supportsTemperature`, `maxOutputTokens`, retention class, `source`) and pricing row are written from those docs with `reviewedAt`; if the id cannot be verified, seeding stops and reports. |
| D11 | Blob store `[DECIDED 2026-09-12: dedicated]` | The panel gets its **own private Blob store** and token, following the one-store-per-app pattern (intake, uploads, export, dossier), not a prefix inside the dossier store. Variables: `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` and `REVIEW_PANEL_BLOB_STORE_ID`, provisioned by the owner the same way as `DOSSIER_BLOB_READ_WRITE_TOKEN` / `DOSSIER_BLOB_STORE_ID` (`docs/CREDENTIALS_RUNBOOK.md` § Private Blob store provisioning); both added to `lib/utils/tracked-secrets.js`. The storage helper is a parameterised copy of `cycle-dossier-storage.js`, and rollout preflight authenticates against the panel store. Retention policy is decided per store. |

## 2. What exists today `[VERIFIED 2026-09-12 via source]`

> **Snapshot note:** this section describes `main` before Phase A0. A0 is built on branch
> `codex/executor-provider-seam` (PR #280); once merged, the Executor dispatches by provider with
> an opt-in `allowedProviders` option, the registry gate is provider-keyed, and the admin slots exist.
> Re-verify this section against `main` before Phase A work starts.

- **Executor is Anthropic-only by construction, not by allowlist.** `executePrompt` resolves the
  prompt row's `wmkf_ai_model` through `resolvePromptClaudeModel` → `resolveModelWithCapabilities`
  (`lib/services/execute-prompt.js:495-513`) and constructs `new LLMClient({ apiKey, model })` with
  `apiKey = process.env.CLAUDE_API_KEY` (`:550-586`); `LLMClient` posts to a hardcoded
  `https://api.anthropic.com/v1/messages` (`lib/services/llm-client.js:37`). The SSRF allowlist in
  `lib/utils/safe-fetch.js` already permits `api.openai.com` (`:43`, used by the old panel), so no
  allowlist change is needed.
- **No caller-supplied model.** The `executePrompt` option list (`execute-prompt.js:88-105`) has no
  `model`/`modelOverride`; the model comes only from the prompt row, falling back to
  `BASE_CONFIG.CLAUDE.DEFAULT_MODEL`. Per-seat models are therefore supplied through per-seat `promptSnapshot`s (A0.3), not a new option.
- **Capability registry already carries a vendor field.** Every `MODEL_CAPABILITIES` row has
  `provider: 'anthropic'` plus `supportsTemperature`, `supportsStructuredOutput`, `maxOutputTokens`,
  a retention class, `reviewedAt` and `source` (`lib/services/model-capabilities.js:17-40`). Pricing
  in `MODEL_PRICING` is **cents per million tokens** (`lib/utils/model-pricing.js:33-35`).
  `check:model-registry` requires a capability and pricing row for every concrete id reachable from
  the static config files it scans (`scripts/check-model-registry.js` header). **It is Anthropic-only
  in code, not just in wording:** every `MODEL_CAPABILITIES` key must start with `claude-` (`:154`),
  configured values without that prefix are skipped rather than checked (`:196`), and tier fallbacks
  must be Claude ids (`:204`). An OpenAI capability row turns the gate red as written, and an OpenAI
  id chosen only through the admin panel (stored in Postgres) is outside its scan entirely.
- **Admin model panel.** `pages/admin.js` (Models section around `:1118-1271`) → `/api/admin/models`
  stores `model_override:<appKey>:<modelType>` via `settings-service` (`pages/api/admin/models.js:202`);
  `VALID_MODEL_TYPES = ['model','visionModel','fallback']` (`:28`); the dropdown lists the live
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
prompt row (all Anthropic) must be unchanged. Revised 2026-09-12 after the Codex adversarial review:
the caller-supplied `modelOverride` option is **dropped**; provider access is **opt-in per call**;
usage survives failures.

**A0.1 Vendor dispatch, opt-in per call.** `executePrompt` gains an `allowedProviders` option,
default `['anthropic']`. After `resolvePromptClaudeModel` (`execute-prompt.js:495-513`) the Executor
reads `capabilities.provider`; if it is not in `allowedProviders` the call fails before any variable
resolution or paid call (`provider_not_allowed`). `anthropic` → existing `LLMClient` path, unchanged.
`openai` → new `lib/services/openai-client.js`. Unknown model or unknown provider → the existing
unreviewed-model error (already fail-closed). The panel service computes its allowed set as
`resolveAllowedProviders` (`lib/utils/vrp-providers.js`) mapped `claude → anthropic`, so
`VRP_ALLOWED_PROVIDERS` governs the panel exactly as it governs the old app. **Prompt publishing is
not changed** (`prompts-publish-service.js:411` keeps `validateReviewedClaudeModelValue`), so a
row-fetched prompt can never carry an OpenAI model; OpenAI models reach the Executor only through a
caller-built `promptSnapshot` (A0.3).

**A0.2 OpenAI client.** Same public contract as `LLMClient.complete()` (`llm-client.js:127-160`,
`normalizeUnaryResponse` `:436-451`): returns `{ text, content, model, stopReason, stopDetails, refused,
usage: { inputTokens, outputTokens, cacheCreationTokens: 0, cacheReadTokens: 0 }, provider: 'openai',
providerFinishReason }`; accepts the Executor's `system` array-of-text-blocks and `messages`; external
`AbortSignal` honoured across attempts and backoff; per-attempt `timeoutMs`; 429/5xx retry with the
same backoff policy; bearer `OPENAI_API_KEY` read server-side; `safeFetch`; `max_completion_tokens`;
**temperature sent only when `supportsTemperature` is true** (mirrors `LLMClient._buildBody` `:225`).
**Instruction role is a reviewed capability**: each OpenAI capability row declares
`instructionRole: 'system' | 'developer'` and the client emits the Executor's system text under that
role, so the A7 preamble keeps top instruction priority on reasoning models `[VERIFY against OpenAI
docs at implementation; source URL recorded on the row]`. **Stop reasons are normalised in the
client**, because `parseClaudeOutput` (`execute-prompt.js:760-790`) accepts only `end_turn` and fails
closed on everything else: `stop → end_turn`, `length → max_tokens`, `content_filter → refusal`;
**a non-empty `message.refusal` field sets `refused: true` regardless of finish reason** so a refusal
delivered with `finish_reason=stop` cannot pass as a clean answer; any other finish reason passes
through unchanged and the Executor rejects it. The original finish reason is kept on the response for
audit. `MultiLLMService` is not modified; the old panel keeps its own path until D5.

**A0.3 Per-seat prompt snapshots replace a model override.** The Executor already lets a caller pass
a `promptSnapshot` that must pin a concrete model (`validatePromptSnapshot`, `execute-prompt.js:1187-1205`)
and records the model that ran on the `wmkf_ai_run` row (`:282`, `:976`). The panel therefore builds
**one snapshot per seat** from the single published `review-panel.seat` row, with `wmkf_ai_model`
set to that seat's resolved model, and stores every seat snapshot in its run config. One immutable
record per seat of prompt text, version, model, and provider; no second value to remember, no
precedence rule. **No Executor option is added for this.** The seat model must satisfy
`validatePromptSnapshot` (concrete, non-tier) and resolve to a reviewed capability row.

**A0.4 Usage survives failure; the attempt ledger is the cost authority.** Today a parse or schema
failure after a paid response throws with only `runId` attached (`execute-prompt.js:295-313`), so a
wrapper logs zero tokens for a paid call. A0 attaches `err.usage` (the same snake_case shape as the
success result), `err.modelUsed`, `err.provider`, and `err.usageComplete` to every error thrown after
a provider response was received, and `err.paidCall = true|false|null` (null = ambiguous: aborted
after dispatch with no response). **`usageComplete` is propagated unchanged end to end:** set by each
client from the raw provider fields (`normalizeUnaryResponse` gains it as an additive field beside
the zero-substituted tokens, `llm-client.js:436-448`), carried through `callClaude`'s reshape
(`execute-prompt.js:626-644`) into the success result's `usage`/`meta` (`:287-294`) and onto the
error, so the panel's finaliser never infers completeness from normalised tokens. Tests at the
Executor boundary: missing and malformed provider usage on success and on post-response failure both
yield `usageComplete: false`. The Executor still does not write `api_usage_log` (`:567-573`, driver-owned).
**`api_usage_log` cannot be the D6 source**: `logUsage` coerces absent tokens to zero and inserts
fire-and-forget with a swallowed catch (`lib/utils/usage-logger.js:60-92`), and the table has no
cost-known or attempt-correlation column (`scripts/setup-database.js:265-282`). The panel therefore
records usage **on its own `review_panel_seat_attempts` row, in an awaited write, before the attempt
is marked terminal** (A.5): `input_tokens`, `output_tokens`, `model`, `provider`, `cost_usd`, and
`cost_state ∈ {known, unknown}`. **`known` requires all of:** `paidCall === true`; the provider
response carried explicit usage (the Executor result or error carries `usageComplete: true`, which both clients set only when
the provider's input and output token fields were **present, finite, and non-negative** in the raw
response, because `normalizeUnaryResponse` otherwise substitutes zero, `llm-client.js:436-448`); and
`lookupPricing(model)` resolves. Anything else is `unknown`, including a well-formed response with
absent usage fields. Test fixtures: missing `usage`, malformed token fields, unpriced model.
**Central monitoring reads the ledger for the panel.** The daily spend alert
(`pages/api/cron/spend-check.js:65-88`) and admin stats (`pages/api/admin/stats.js:45-159`) sum
`api_usage_log`, which is populated fire-and-forget with swallowed failures
(`lib/utils/usage-logger.js:60-89`) and cannot represent an unknown. **The panel does not write
`api_usage_log` at all**, so no double counting and no silent omission is possible. Both consumers
gain a second query over `review_panel_seat_attempts` in the same window: `SUM(cost_usd) WHERE
cost_state = 'known'` is added to the dollar total, and `COUNT(*) WHERE cost_state = 'unknown'` is
reported beside it. `spend-check` raises its `spend_threshold`-class alert when the combined total
crosses the threshold **or** the unknown count is non-zero, with an explicit "N panel calls with
unknown cost" message. The admin Usage panel (`pages/admin.js:983-989`, `1039-1067`, fixed
`total_cost_cents`/`total_requests` fields) shows the panel's known spend and unknown count as two
additional fields. Tests: a ledger write followed by any downstream failure still yields correct
totals; an unknown attempt trips the alert with zero dollars. D6 actuals are computed from the ledger; the page and the
report **refuse to print a run total while any attempt in the run has `cost_state = 'unknown'`** and
show the unknown count instead. The dossier wrapper
(`cycle-dossier-generation.js` loggedExecute) can adopt `err.usage` later. Tests: invalid JSON, schema
failure, refusal, truncation, abort-after-dispatch, and a failing ledger write each leave the attempt
non-terminal or `unknown`, never a zero-cost `completed`.

**A0.5 Registries.** Add OpenAI rows to `MODEL_CAPABILITIES` (`provider: 'openai'`,
`instructionRole`, `refusalField: 'message.refusal'`, `supportsStructuredOutput: false` for Phase A
per D1b, `supportsTemperature` per model, retention class) and `MODEL_PRICING`. **Every value is
verified from OpenAI's published documentation with a `source:` URL and `reviewedAt` at
implementation time; none is guessed.** The default OpenAI seat model is `[OWNER-SUPPLIED at seed
time]`. `check:model-registry` must be generalised **before** the first OpenAI row lands: key
validation keyed on the row's `provider` instead of the `claude-` prefix (`:154`), non-Claude
configured values checked rather than skipped (`:196`), and the seat registry's `defaultModel`
values added to its scanned sources. `MODEL_PRICING` already carries stale OpenAI rows (`gpt-4o`,
`gpt-4o-mini`, `o3-mini`, `model-pricing.js:65-68`) used only by the old panel; leave them, add the
chosen seat model. `OPENAI_API_KEY` is in the credentials runbook but **not** in
`lib/utils/tracked-secrets.js` (0 hits, 2026-09-12); A0 adds it.

**A0.6 Admin model slots, vendor-bound.** A tracked seat registry (`shared/config/reviewPanelSeats.js`:
`{ key, vendor, label, enabled, defaultModel }` for `seat.claude`, `seat.openai`, `chair` with
`vendor: 'anthropic'`) is consulted by `/api/admin/models`. GET lists, per slot, only reviewed models
whose capability row `provider` equals the slot vendor (Anthropic from the live `/v1/models` list as
today; OpenAI from capability rows). **PUT validates server-side that the submitted model's provider
equals the slot's vendor** and that capability and pricing rows exist; the existing `allowNonClaude`
escape in `model-review-validation.js` (returns `kind: 'non_claude'` with no registry check) is not
used. A direct request binding an OpenAI model to the chair is rejected with 400. Override key shape
stays `model_override:review-panel:<slotKey>`; `getModelForApp` already keys overrides by
`${appKey}:${type}` with no type allowlist (`shared/config/baseConfig.js:309`). The GET app list is
driven by `APP_MODELS` today, so `review-panel` gets an `APP_MODELS` entry or the GET consults the
slot registry. Adding a third seat is a registry edit plus capability/pricing rows.

**A0.7 Prompt-injection.** `wrapUntrustedContent` + `buildUntrustedContentPreamble` run before dispatch
(`execute-prompt.js:184-200`, then `callClaude` at `:236`) so both vendors receive identical wrapped
payloads. A0 tests, for the OpenAI path: the preamble is emitted under the capability row's
`instructionRole`; the wrapped body reaches the user message; an injected "ignore previous
instructions" fixture inside the wrapped block does not change the output-schema shape.

**A0 exit criteria:** all existing Executor unit tests unchanged and green; new tests for
`allowedProviders` default-deny, dispatch, temperature gating, instruction role, refusal-field
detection, stop-reason mapping, abort propagation, error-attached usage, unknown-vendor fail-closed;
slot PUT vendor mismatch rejected; `check:model-registry`, `check:model-override-warming`,
`check:prompt-injection-tagging`, `check:secret-scan`, `check:types` green; `docs/EXECUTOR_CONTRACT.md`
updated with `allowedProviders`, the vendor rule, and error-attached usage.

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
- `review-panel.seat`: one reviewer prompt shared by every seat, run blind. Its output
  `validationSchema` is **derived at configuration-snapshot time from the live question set**:
  `getAuthoritativeQuestionSet()` (`lib/external/review-question-fetcher.js:220`, the write-boundary
  resolver) plus `questionSetVersion(fields)` (`:255`). The static `review-form-schema.js` is only the
  seed for `wmkf_reviewquestion`, which is the staff-editable system of record (Atlas
  `docs/atlas/dataverse-wmkf-reviewquestion.md`). The seat schema is an **explicit projection** of
  that set to answer questions only, using the same predicate the human submission uses
  (`type ∈ {picklist, multiselect, richtext}`, `lib/external/build-review-submission.js:184-191`);
  the identity `string` field `affiliation` (`review-form-schema.js:35-44`) is excluded, and a test
  with an active `affiliation` fixture asserts it reaches neither the prompt nor the output schema.
  The run config stores the projected set and `questionSetVersion` of the full set; launch fails if
  the set cannot be fetched. **`teamCapacity` (D7):** the projection marks it `not_assessable`; the
  schema for that key accepts only `{ status: 'not_assessable' }` and rejects answer text; the chair
  input omits it; the **report prints the fixed line** from D7 (one contract, tested in A.7). Seat identity is not in the prompt; the model differs per seat via
  the per-seat snapshot (A0.3).
- `review-panel.chair`: synthesis over N seat reviews, reusing the existing synthesis shape
  (`ratingMatrix`, `consensus`, `disagreements`, `keyStrengths`, `keyConcerns`, `questionsForPI`,
  `resolvableVsFundamental`, `panelRecommendation`, `confidenceNote`). Claim verification and
  devil's advocate fields are absent in Phase A.
The old `createStructuredReviewPrompt` / `createPanelSynthesisPrompt` text
(`shared/config/prompts/virtual-review-panel.js:382,515`) is the starting draft.

**A.4 Input.** A **dedicated** `prepareReviewPanelInput` in the panel's own service, not the dossier's
`prepareRequestInput`, which bundles the four `priorAiContext` memos (`cycle-dossier-generation.js:108-113`)
that D2 excludes. The panel DTO has an exact key allowlist (`requestId`, `requestNumber`, `narrative`
text + hash + source path, `institution`, `title`), reuses only `getAiProposalNarrativeText`, and has a
test proving memo fields cannot reach the snapshot, the prompt variables, or Blob storage. Proposal
text is declared as an untrusted variable; the A7 registry gains row `review-panel-generation`.

**A.5 Run contract and seat-attempt ledger.** Tables `review_panels`, `review_panel_runs`,
`review_panel_entries`, `review_panel_seat_attempts`, `review_panel_control` in migration 047
(block v49), with per-request revision numbers from day one. The run config snapshot pins, per seat,
the prompt snapshot (A0.3), provider, model, pricing, and the question-set version (A.3), so an admin
change mid-run cannot shift anything. **Per seat, not per entry:** each paid call is a row in
`review_panel_seat_attempts` with `(entry_id, seat_key, attempt_no)` unique, states
`pending → dispatched → completed | failed | unknown_outcome`, the lease token that dispatched it,
`dispatched_at`, an immutable `dispatch_token`, and the usage columns from A0.4. The dossier's single
`paidInFlight` flag per entry (`cycle-dossier-worker.js:121-147`) is insufficient for parallel seats.
**Two separate fences.** (1) Run-state changes (entry status, winner selection, chair dispatch,
retry creation) require the **current run lease**, exactly as the dossier worker fences its mutations
(`cycle-dossier-worker.js:94-100`). (2) Attempt finalisation is a single **compare-and-set on the attempt's
own `dispatch_token` that also requires `dispatch_expires_at > now()`** (the attempt records the
run-lease expiry in force when it was dispatched): in one transaction: `SELECT … FOR UPDATE` on
the attempt row first, then the expiry decision on **`clock_timestamp()`**, not `now()`, because
`now()` is frozen at transaction start and the cloned store runs awaited work inside open
transactions (`cycle-dossier-store.js:28-38`), so a finaliser that began before expiry could
otherwise pass the check after it. Then `UPDATE … SET state = completed|failed, result, usage WHERE
id = $1 AND dispatch_token = $2 AND state = 'dispatched' AND dispatch_expires_at > clock_timestamp()`.
If that CAS matches zero rows the finaliser runs the **late path** under the same row lock: `UPDATE … SET state =
CASE WHEN state = 'dispatched' THEN 'unknown_outcome' ELSE state END, late_result_json, late_usage
WHERE id = $1 AND dispatch_token = $2`, so a finaliser that arrives after its lease expired, whether
before or after the reaper, can only land metadata and never `completed`. The reaper (current-lease
holder) moves `dispatched` attempts with `dispatch_expires_at <= now()` to `unknown_outcome`; they
are **never retried automatically**. The two updates are the only writers of attempt state. Winner selection is explicit: under the
current lease, the entry picks the single `completed` attempt per seat with the highest `attempt_no`
and records `winner_attempt_id` on the entry; only winners feed the chair. Seats run with
`Promise.allSettled`; the entry completes only when every configured seat has a winner, then the chair
runs as its own attempt row. Tests: finaliser-after-expiry-before-reaper lands `unknown_outcome` + late usage, never
`completed`; reaper-then-finaliser leaves `unknown_outcome` and appends usage; **a finaliser
transaction that begins before expiry and reaches the UPDATE after expiry lands `unknown_outcome`**;
finaliser within lease completes; old worker after a manual replacement attempt does not displace the winner;
chair never dispatches twice for one entry. **Partial-seat policy:** any failed
seat fails the entry; "Retry failed entries" creates new attempts only for seats without a `completed`
attempt and re-runs the chair. Each call uses `promptSnapshot`, `requireNoPersistence`, `deadlineMs`,
`signal` (operator stop), and `allowedProviders`. Usage is logged per attempt from the result or from
`err.usage` (A0.4) **before** the attempt row is marked terminal. Executor budgets `review-panel.seat`
and `review-panel.chair` registered in `executorBudgets.js` with admin-tunable envelopes.

**A.6 Worker and cron.** Clone `cycle-dossier-worker.js`: single global lease, per-minute drain cron
under strict `CRON_SECRET`, stop re-read before every paid call, `describeEntryFailure`-style plain
copy. Cron entry in `vercel.json` only when the owner enables it (dossier precedent).

**A.7 Editions.** Private Blob DOCX + PDF per entry in the **dedicated panel store (D11)** with SHA-256/size/path refs, structural DOCX
verification, download route with `Cache-Control: private, no-store` and `X-Frame-Options: SAMEORIGIN`
for the PDF preview. Report sections: rating matrix, panel summary, per-seat reviews (labelled by
vendor and pinned model) with `teamCapacity` rendered as the fixed D7 line "Not assessed in Phase A
(budget and team materials not provided)", cost breakdown from the attempt ledger (withheld while any
attempt is `unknown`, A0.4). No SharePoint (D4).

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
2. One run; record per seat and chair from the `review_panel_seat_attempts` ledger: wall time,
   input/output tokens, `cost_usd`, `cost_state`, validation failures, and the reservation bound the
   page showed. `api_usage_log` (`app_name='review-panel'`) is a cross-check only.
3. Owner reads the reports against the human review synthesis for those requests (informal; the
   formal comparison is D3 / Phase C).
4. Decide the typical-cost figure and whether to widen the allowlist.

## 7. Sequencing and release tier

Tier 2 per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §4: A0 is a cross-layer refactor of
shared runtime; Phase A adds migrations, background work, and paid provider calls. Requirements:
isolated branch, characterization coverage before change, preview deployment, staff rehearsal,
recorded rollback, explicit owner merge decision.

| Slice | Branch | Tier | Gate before merge |
|---|---|---|---|
| A0 Executor seam (opt-in providers, OpenAI client, error-attached usage) + registries + vendor-bound slots | `feature/executor-provider-seam` | Tier 2 (shared runtime) | `/contract-reconcile`, full Executor tests, model-registry, override-warming, A7 gate |
| A.1–A.5 tables, prompts, service | `feature/review-panel-foundation` | Tier 2 | atlas, api-routes, route-lifecycle-auth, unit tests, migration applied to preview |
| A.6–A.8 worker, editions, page | same branch | Tier 2 | rehearsal scripts cloned from `scripts/rehearse-cycle-dossier-*.mjs`; Playwright smoke |
| §6 smoke | production, `smoke` mode | operator | owner-run env commands; actuals reviewed |

Phase B (claim verification via the dossier research stage, devil's advocate, SharePoint publication)
and Phase C (panel-vs-human comparison, history views, third seat) follow the survey §5 unchanged.

## 8. Open items carried into implementation

- D9 and D10 decided 2026-09-12; see §1.
- OpenAI reasoning models: `max_completion_tokens` includes reasoning tokens; the capability row and
  budget envelope must reflect that. Verify `instructionRole` per model family from OpenAI's docs.
- Old-page parity definition for D5 (not before Phase B).
- The dossier's `snapshotPrompt` rejects any model not matching `^claude-…` (`cycle-dossier-generation.js`);
  the panel's snapshot builder keys on the capability row's `provider` instead.
- **Key-collision check before A.1:** `review-panel` is a substring of the live `virtual-review-panel`.
  Confirm `check:api-routes`, `check:route-lifecycle-auth`, and the A7 registry match app keys and
  route paths exactly (not by prefix or `includes`) before the new key lands. Verified 2026-09-12 that
  no `pages/api/review-panel*` file and no `'review-panel'` registry, matrix, or A7 entry exists yet.
- Whether the dossier adopts `err.usage` logging (A0.4) in the same PR or a follow-up.

## 9. Review history

- 2026-09-12 Claude `/contract-reconcile` (Mode A): READY WITH NAMED CHANGES; folded in (`d7480241`).
- 2026-09-12 Codex adversarial review against `8d168ed4`: **no-ship** on seven findings (provider scope,
  usage lost on failure, stale schema authority, per-seat ambiguity, input DTO leak, OpenAI instruction
  and refusal semantics, override-vs-snapshot). All seven addressed in this revision: D8, A0.1, A0.2,
  A0.3 (override dropped), A0.4, A0.6, A.3, A.4, A.5, D7 raised to the owner.
- 2026-09-12 Codex adversarial review round 2 against `d7480241`: **no-ship** on four findings
  (affiliation imported by the live-set derivation; unknown cost invisible in `api_usage_log`;
  `teamCapacity` unenforced; late completion vs lease fence). Addressed: A.3 projection + affiliation
  test; A0.4 ledger-authoritative cost with `cost_state` and awaited writes, totals withheld while any
  attempt is unknown; D7 decided option 1 (owner) and enforced in A.3; A.5 two-fence contract with
  `dispatch_token` CAS and explicit winners.
- 2026-09-12 Codex adversarial review round 3 against `ee692aa8`: **no-ship** on four findings (late
  CAS could still win before the reaper; unknown spend invisible to spend-check/admin stats; usage
  object presence is not a safe known-cost predicate; D7 report contract contradicted A.3).
  Addressed: A.5 CAS requires an unexpired dispatch lease with a metadata-only late path, both
  orderings tested; A0.4 `usageComplete` predicate plus spend-check unknown-count alert and admin
  stats unknown count; D6 row and §6 name the ledger; D7/A.3/A.7 agree the report prints the fixed
  "Not assessed" line while the chair omits the key.
- 2026-09-12 Codex adversarial review round 4 against `4e98ce02`: **no-ship** on three technical
  findings (known panel spend could vanish if the duplicate `logUsage` insert failed; `usageComplete`
  not propagated through the Executor; `now()` is transaction-stable so a straddling finaliser could
  complete) plus one owner-decision finding. Addressed: A0.4 panel spend read from the ledger by
  spend-check and admin stats, panel never writes `api_usage_log`; `usageComplete` on the Executor
  result and error; A.5 row lock + `clock_timestamp()` with a straddle test. Raised to the owner as
  D9 (chair input) and D10 (default OpenAI model).
- 2026-09-12 owner decided D9 (b: chair sees reviews + narrative) and D10 (GPT Sol, provisional).
  No owner decision remains open. A0 handed to Codex via
  `docs/plans/EXECUTOR_PROVIDER_SEAM_CODEX_BRIEF_2026-09-12.md`; Claude reviews.
- 2026-09-12 owner decided D11: dedicated private Blob store for the panel.
