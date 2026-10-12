---
title: AI tool apps → editable Dataverse prompts — staged plan
domain: architecture
kind: plan
status: draft
summary: "Move the prompts and models of the five live standalone AI tool apps (multi-perspective evaluator, literature analyzer, funding-gap analyzer, expense reporter, expertise finder) from bundled prompt modules and the Model Config section into Dataverse prompt rows that staff edit in /admin → Prompt Templates. Routes keep their own LLMClient calls and A7 wrapping and read prompt text, model and max tokens through a shared prompt-resolver seam (no Executor). One app per stage; owner decisions recorded 2026-10-12; written for a cheaper model to execute stage by stage."
canonical: false
owner: product-engineering
related:
  - docs/plans/LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md
  - docs/plans/data/DIRECT_LLM_ROUTE_PROFILES_2026-10-11.md
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/AI_DATA_FLOW_MATRIX.md
  - docs/SYSTEM_MODEL.md
  - docs/EXECUTOR_CONTRACT.md
---

# AI tool apps → editable Dataverse prompts — staged plan

Candidate **A** from `LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md`. The file name keeps
"executor convergence" for link stability; the plan no longer moves these apps onto the Executor
(owner decision 2026-10-12, §8). Status: **draft — decisions recorded, stages not started.** Tier 2
runtime work: a branch per stage, PR, owner promotion. Every stage also needs its prompt rows seeded in
Preview and Production by the owner-run seed script (a Dataverse write; `DATAVERSE_TARGET_INTERLOCK`
applies).

**Goal.** Staff can change any of these five apps' prompts **and** their model in `/admin` → Prompt
Templates without a redeploy, and the model is never set in two places. Usage is low (owner,
2026-10-12), so the plan favours the smallest change that delivers that, not Executor uniformity.

The per-route facts are in `docs/plans/data/DIRECT_LLM_ROUTE_PROFILES_2026-10-11.md` (gathered at
`b3135037c`); read it before any stage.

## 0. Executor instructions (read first)

- This is a **prompt-home and model-home migration**, not a prompt rewrite and not a call-seam
  change. Each route keeps its own `LLMClient` call, its A7 wrapping (`wrapUntrustedContent`, nonces,
  preamble), its parsing, progress frames, envelopes and status codes. What changes: the prompt
  **text**, the **model** and **max tokens** come from the current Dataverse row instead of the bundled
  builder and `getModelForApp`.
- Because the route still builds the A7 framing and passes already-wrapped content into the template,
  the composed prompt after a stage must be **byte-identical** to today's builder output for the same
  inputs and the same nonce. A parity test proves it before cutover.
- Cutover = merge the route commit after the rows are published. Rollback = `git revert` that commit
  (rows stay published and dormant; the bundled builder is still there).
- "STOP-AND-ASK" means stop, write what you found in §8, and wait.
- Worktree off `main`; `npm ci` first (lock is npm-10 compatible — never regenerate it).

## 1. Baseline (probed, not assumed)

Probed at `b3135037c` for the original Executor design; line citations are to that tree. Two facts
below are superseded: the expense-reporter `sendError` `ReferenceError` and the funding-gap page's
swallowed error frames were fixed on `main` in merge `a804f63bc` (2026-10-12), together with the
literature and evaluator routes' JSON-500-after-stream paths. §1.2 describes the Executor, which this
plan no longer uses; it stays as the record of why (§8, 2026-10-12).

### 1.1 The six routes

| Route → page | LLM calls / request | Multimodal | Streaming to page | Usage logging today | Tests importing route | A7 today |
|---|---|---|---|---|---|---|
| `evaluate-multi-perspective.js` → `multi-perspective-evaluator.js` | up to 6 per concept-page (1 if flagged ineligible `[:258-301]`; Stage 1 PDF, 2.5 summary, 3× perspectives in parallel, integrator), pages processed 2 at a time; route-owned retry loop + single fallback model `[:558-638, :67, :151-167]` | Stage 1 sends a PDF `document` block per page `[:660-668]` | Variant A: SSE-shaped frames over `text/plain`, `{progress,message,stage}`, terminal `{progress:100,results}`, **`res.status(500).json` after frames on error** `[:92-99, :189-216]` | manual `logUsage` on success only `[:590-597, :624-631]` | `multi-perspective-refusal.test.js` (module-mocks `llm-client`), `evaluate-multi-perspective-concurrency.test.js` | wrapping lives in the prompt module; preamble in every builder `[prompts/multi-perspective-evaluator.js:224-608]` |
| `analyze-literature.js` → `literature-analyzer.js` | N (one PDF per paper, sequential) + synthesis + optional comparison `[:70-153]` | Stage 1 PDF `document` block `[:226-232]` | Variant A `[:58-61, :170-196]` | `LLMClient appName:'literature-analyzer'` `[:222]` | **none** | module-level `[prompts/literature-analyzer.js:31,109,245]` |
| `analyze-funding-gap.js` → `funding-gap-analyzer.js` | 2 per file (extract JSON, analyze markdown), sequential `[:93-402]` | no | Variant B: real `text/event-stream`, terminal `{complete:true,results,metadata}`, error frame `{error,complete:true}`; **page swallows error frames** `[pages/funding-gap-analyzer.js:75-101]` | `appName:'funding-analysis'` (access key is `'funding-gap-analyzer'`) `[:41, :84-85]` | `tests/integration/funding-gap-payload-boundary.test.js` (module-mocks `llm-client`) | route `wrapUntrustedContent` + nonce to builder `[:120-130]` |
| `process-expenses.js` → `expense-reporter.js` | 1 per file | image receipts send an `image` block `[:229-245]`; PDFs go as text | Variant C: `{type:'progress'|'result'|'error'}` + `data: [DONE]`, `headersSent`-aware `[:171-196, :408-431]` — **latent bug:** `sendError` is declared inside the `try` at `:190` and called from the `catch` at `:429`, out of scope, so the after-headers error path throws `ReferenceError` today | `appName:'expense-reporter'` `[:201]` | `tests/integration/process-expenses-a7.test.js` (module-mocks `llm-client`) | route-inline prompt + `wrapUntrustedContent` (PDF) `[:41-121, :321-327]`; no `requireAcceptedLlmResponse`, so refusals go undetected today |
| `expertise-finder/match.js` → `expertise-finder.js` | 1 (+1 on **any** non-refusal error, with fallback model) `[:105-112]`; second consumer of the same prompt module: `lib/services/expertise-finder/batch-match-service.js` `[:28, :151-170]` | no | none — JSON via `requestEnvelope` `[pages/expertise-finder.js:197]` | manual `logUsage` success + error `[:168-176, :195-204]`; Postgres `expertise_matches` insert `[:148-165]` | **none** for the route; 3 page tests; `expertise-finder-a7.test.js` (builders — parity-relevant); `batch-match-service.test.js:19` and `expertise-finder-batch-match-route.test.js:25` module-mock `llm-client` | route `wrapUntrustedContent`; cacheable system block with preamble `[:93-99; prompts/expertise-finder.js:82]` |
| `cron/log-analysis.js` (cron) | 0 or 1 | no | none | `appName:'cron-log-analysis'`; hard-coded `claude-haiku-4-5-20251001`; skips `loadModelOverrides` `[:112-116]` | `notification-trust-model-pushup.test.js:273` | route-inline; nonce in `system` `[:117-127]` |

**None of the five app routes calls `LLMClient.stream()`** (`grep '\.stream(' → 0`); the streaming is
progress frames between unary `complete()` calls. Only the sunset `qa.js` streams tokens.

### 1.2 The Executor as it exists

`lib/services/execute-prompt.js` `[VERIFIED at b3135037c]`:
- Signature `executePrompt({ promptName, requestId=null, overrideVariables={}, runSource, forceOverwrite, actingUserSystemId, maxTokensOverride, timeoutMsOverride, deadlineMs, minimumEffectiveMaxTokensExclusive, semanticAttempt, retryOfRunId, assertSystemIncludes, promptSnapshot, requireNoPersistence, allowedProviders=['anthropic'], signal, auditRetention })` `[:93-112]`. `runSource` must be one of `PowerAutomate Auto | Vercel User | Vercel Test | Vercel Interactive | PowerAutomate Test | PowerAutomate Manual` `[:55-62]` — there is no cron value.
- Runs inside its own `withDalContext('execute-prompt')` `[:155]`; the route does not wrap it.
- The contract says token-streaming routes "stay outside the contract" `[EXECUTOR_CONTRACT.md:536]`; these routes are unary per call, so they are inside it.
- Transport is **string-only**: `system:[{type:'text', text, cache_control}]` + `messages:[{role:'user', content:<string>}]` `[:735-736]`; no content blocks, no `tools`, no images/documents `[:23-24]`.
- Model comes from the row's `wmkf_ai_model` via the capability registry, **not** `getModelForApp` `[:553-582]`; no fallback model; transport retries are `LLMClient` defaults.
- Variables: `override` kind reads `overrideVariables[name]`; a decl with `dataClass`+`maxChars` is capped, with `untrusted:true` it is `wrapUntrustedContent`-wrapped and a general-form preamble is prepended to `system` `[:387-421, :1285-1341, :606-610]`. `assertSystemIncludes` fails closed before the provider call `[:246-256]`.
- `parseMode:'raw'` returns `{ [outputs[0].name]: text }` and throws `claude_output_empty` under 20 chars; `json` mode throws `claude_output_invalid_json` / `claude_output_schema_invalid`; any non-`end_turn` stop throws `[:893-999]`.
- **Writes a `wmkf_ai_run` row on every call**, success or failure, even with `requestId=null` and `requireNoPersistence:true` `[:300, :334, :187-195]`. The inner `LLMClient` has no `appName`, so `api_usage_log` is the caller's job from `result.usage` + `result.meta.modelUsed` `[:651-657, :687-691]`.
- Precedent: `pages/api/process-peer-reviews.js` `[:280-291, :213-230]` with seed
  `scripts/seed-peer-review-summarizer-prompts.js` (row object fields `[:66-128]`, record mapping `[:204-217]`)
  and templates in `shared/config/prompts/peer-reviewer-dynamics.js:60-104`.
- Admin: `shared/components/admin/PromptTemplatesSection.js` edits and version-publishes rows and
  loads the reviewed model catalog (`/api/admin/models`) so a row's model is chosen there
  `[:81-102]`; today these five apps take their model from the admin **Model Config** section via
  `getModelForApp` `[baseConfig.js:27-59]`.

### 1.3 Gates and tests that this migration touches

- `scripts/check-prompt-injection-tagging.js` registry entries for each route (`evaluate-multi-perspective` inv 8 multimodal `[:177-195]`, `analyze-literature` inv 9, `analyze-funding-gap` inv 10, `process-expenses` inv 11, `expertise-finder` inv 13 incl. `batch-match-service.js` `[:231-238]`, `cron-log-analysis` inv 24). The peer-review entry shows the accepted way to register an Executor-handled prompt file `[:164-175]`.
- `check:model-override-warming`: routes that still call `getModelForApp` must keep `loadModelOverrides()` first; a route that stops calling the resolver is simply out of the gate's scope.
- `check:api-routes`: matrix rows exist for all six `[docs/API_ROUTE_SECURITY_MATRIX.md:180,181,193,223,227,311]`. Their side-effects column says "Writes `api_usage_log` (PG) via llm-client"; after migration it must also name the Dataverse `wmkf_ai_run` write and `wmkf_ai_prompt` read per call. The peer-review row `[:312]` was never updated for its own migration — Stage 1 fixes it alongside EF.
- Tests that module-mock `lib/services/llm-client` and assert on `complete()` call shapes must be re-pointed at `execute-prompt` in the stage that migrates their route: `tests/unit/multi-perspective-refusal.test.js:9`, `tests/integration/funding-gap-payload-boundary.test.js:77`, `tests/integration/process-expenses-a7.test.js:41`, `tests/unit/batch-match-service.test.js:19`, `tests/unit/expertise-finder-batch-match-route.test.js:25`.
- `tests/unit/utils/public-blob-fetch.test.js:73-97` greps route source for `fetchPublicBlob`/`readUploadedBlobBuffer` — unaffected as long as input handling stays in the route.

## 2. Owner decisions (recorded 2026-10-12 — details in §8)

| # | Decision | Answer |
|---|---|---|
| D1 | Scope | **All five live apps**: Expertise Finder (route + `batch-match-service.js`), funding-gap analyzer, expense reporter, literature analyzer, multi-perspective evaluator. Sunset pages/routes and `cron/log-analysis` stay out. |
| D2 | Multimodal calls | Moot — every call uses the seam, so PDF/image blocks stay in the route unchanged. |
| D3 | `wmkf_ai_run` volume | Moot — the seam writes no `wmkf_ai_run` rows. |
| D4 | Retry / fallback | **No fallback model.** Route retry loops keep retrying the same model; the code that switches to `getFallbackModelForApp` is removed. |
| D5 | Streaming protocol unification | **Dropped.** The error-reporting bugs it would have fixed were fixed directly (`a804f63bc`). |
| D6 | Shared tool-page shell | **Dropped.** |
| D7 | Prompt-home policy | **Adopted, narrowed:** staff editability is a sufficient reason to move a prompt into Dataverse, per prompt, not as a sweep; editability alone may use the seam instead of the Executor. Recorded in `docs/SYSTEM_MODEL.md` and `.claude-memory/project-system-model.md`. |
| D8 | Where the model is chosen | **On the prompt row** (`wmkf_ai_model`, edited in Prompt Templates). The five apps' entries leave `APP_MODELS` / the Model Config section, so there is never a second setting. Owner: a model not visible in `/admin` is too easy to lose track of. |
| D9 | Framing changes | Moot — the route keeps today's A7 framing, so the prompt is byte-identical. |
| D10 | Row parameters | Rows carry **model and max tokens**. **No temperature**: the current Anthropic generation removes it (Sonnet 5 / 5.5, Opus 4.7+, Fable reject it; Haiku 5.5 accepts only the default) — verified against the live Haiku 5.5 and Sonnet 5.5 migration guides 2026-10-12. `LLMClient` already omits it for models the registry marks unsupported (`llm-client.js:232`); only Haiku 4.5 (expense reporter today) still receives the code default. |

## 3. Pre-made design (executors do not relitigate)

1. **One shared resolver**, `lib/services/tool-prompt-resolver.js`, generalized from the S222
   Reviewer Finder seam (`lib/services/reviewer-prompt-resolver.js`), without the per-user override
   tier and without reviewer-specific templates:
   `resolveToolPrompt(promptName, bundledDefinition) → { systemPrompt, body, model, maxTokens, source, version }`.
   - Reads `fetchCurrentPrompt(promptName)` (`lib/services/prompt-store.js:41`) inside its own
     `withDalContext` (the store leaf does not wrap it).
   - **Transient / unreachable Dataverse error → the bundled definition** (same text, the definition's
     model and max tokens); `source: 'bundled'`. The tool still runs on a network blip.
   - **0 current rows (`PROMPT_NOT_FOUND`) or ≥2 (`PROMPT_DUPLICATE_CURRENT`) → fail loud**, the
     resolver's existing rule: a structural/admin error must not silently degrade.
   - **Model:** the row's `wmkf_ai_model` (tier key or concrete id) resolved exactly as the Executor
     does (`resolvePromptModel`, `execute-prompt.js:553-582`): warm `loadAvailableModels()`, then
     `resolveModelWithCapabilities`; an **unreviewed model fails loud** (it must be added to
     `model-capabilities.js` / `model-pricing.js` first). Extract that function to a shared module
     rather than copying it; the Executor imports it from there (pure extraction, same behavior).
   - **Max tokens:** `wmkf_ai_maxtokens`, falling back to the bundled definition's value.
   - Temperature is not read (D10).
2. **Seed source of truth:** `shared/config/prompts/<app>-dynamics.js` exporting row definitions in
   the object shape of `scripts/seed-peer-review-summarizer-prompts.js:66-128` with `{{var}}`
   placeholders, `model` = the app's current `APP_MODELS` tier at seed time (D8), `maxTokens` = today's
   constant, no `temperature`. These definitions are also the resolver's bundled fallback. One
   generalized CLI `scripts/seed-tool-prompts.js --app <key> --dry-run|--execute`, create-only /
   `--force` version-preserving per `lib/services/prompt-seed.js:1-20`. The old builders stay
   importable as the parity oracle until Stage 6.
3. **Row naming** `<app-key>.<step>`: `expertise-finder.match`, `funding-gap.extract`,
   `funding-gap.analyze`, `expense-reporter.extract-document`, `expense-reporter.extract-image`,
   `literature-analyzer.extract-paper`, `literature-analyzer.synthesize`, `literature-analyzer.compare`,
   `multi-perspective.initial-analysis`, `multi-perspective.proposal-summary`,
   `multi-perspective.optimist`, `multi-perspective.skeptic`, `multi-perspective.neutral`,
   `multi-perspective.integrator`. The evaluator and literature analyzer use a separate vision model
   today (`visionModel`); under D8 each row carries its own model, so the PDF-reading rows simply hold
   whatever model staff choose.
4. **Builders with logic** (e.g. funding-gap analyze `usaSpendingData.disabled ? 'NOT QUERIED…' : wrapped`,
   `keywords.join`) are not `{{var}}` templates: the route pre-computes each branch into a variable;
   the parity test covers every branch.
5. **A7 stays in the route.** The route wraps untrusted content exactly as today and passes the
   wrapped string as a variable; the preamble the builder emits today is part of the template text.
   Guard against a bad `/admin` edit dropping it: before the provider call, the route asserts the
   composed prompt still contains the A7 preamble marker (`UNTRUSTED CONTENT RULES:`) whenever it
   passes wrapped content, and fails closed otherwise — the same protection the Executor's
   `assertSystemIncludes` gives (`docs/agent-wiki/topics/prompt-executor.md:69`).
6. **Usage logging unchanged:** `LLMClient`'s `appName` (or the route's manual `logUsage`) keeps
   today's strings, including `'funding-analysis'`; `modelUsed` is the resolved model.
7. **Model Config:** in the stage that migrates an app, remove its `APP_MODELS` entry
   (`shared/config/baseConfig.js:27-59`) and its label in `ModelConfigSection.js:15-32`, and delete its
   `getModelForApp` / `getFallbackModelForApp` calls. Before removing an entry, grep every consumer of
   that key (`expertise-finder` is also read by `batch-match-service.js:59-60`). A route that no longer
   calls the resolver drops out of `check:model-override-warming`'s scope; keep `loadModelOverrides()`
   only while a resolver call remains.
8. **Every route keeps:** method/auth/rate limit, input fetching and parsing, PDF/image content blocks,
   progress framing, envelopes and status codes, persistence (EF Postgres insert), lenient parsing and
   fallback result objects.
9. **Order:** EF (1 call, JSON, page tests) → funding-gap (2 calls, boundary test) → expenses (mixed
   modal) → literature (route tests exist since `a804f63bc`; add parity tests) → evaluator (largest;
   retry loop). One app per stage, one PR per stage.

## 4. Non-goals

Prompt wording changes; model-tier changes at seed time; renaming app keys or `appName` strings; the
Executor; `wmkf_ai_run` audit rows; PA execution; streaming-protocol unification; a shared page shell;
retiring sunset pages; adding Sonnet 5.5 / Haiku 5.5 to the model registry (separate change);
Dynamics Explorer, reviewer-finder, grant-reporting, integrity-screener.

## 5. Verification protocol

**Pre-stage re-probe** (log the output in §8):
```bash
grep -rn "getModelForApp('<key>'\|getFallbackModelForApp('<key>'" lib pages shared   # consumers of the key
grep -rln "tool-prompt-resolver" pages/api lib/services                                 # grows by one route
node scripts/seed-tool-prompts.js --app <key> --dry-run                                 # rows that would be written
```

**Prerequisite tests per stage** (exist and pass before the route diff):
1. `tests/unit/tool-prompt-parity/<app>.test.js` — fixture inputs with a fixed nonce → old builder
   output; the same inputs → `interpolate(definition.systemPrompt/body, vars)` → **byte-equal**, for
   every builder branch.
2. Route test with `tool-prompt-resolver` mocked: the route calls `LLMClient` with the resolved model
   and max tokens, today's message shape (including PDF/image blocks), and today's `appName`; envelope
   and status codes unchanged for success, refusal, invalid output, provider error; a resolver
   `PROMPT_NOT_FOUND` surfaces as today's processing error; a template missing the A7 marker fails
   closed (§3.5).
3. Streaming routes: a frame-sequence characterization test (ordered `data:` keys) captured before and
   asserted unchanged after.
4. Resolver unit tests (Stage 0): row hit, transient error → bundled, 0 and ≥2 rows → throw,
   unreviewed model → throw, tier key resolves to a concrete id, missing max tokens → bundled value.

**Green gate (every stage):**
```bash
npx jest --testPathPatterns '<app>|tool-prompt|prompt-store|model-resolver' --silent
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:model-override-warming && npm run check:model-override-warming:self-test
npm run check:model-registry && npm run check:model-registry:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:doc-currency && npm run check:doc-symbol-refs
npm run lint && npm run check:types && npm run build
npx jest --silent   # full suite before the PR
```

**Live verification (owner-run, per stage, Preview then Production):** seed rows (`--execute`);
`/admin` → Prompt Templates shows the rows with their model; `/admin` → Model Config no longer lists the
app; run the tool once with a sample file and compare the output shape with a pre-cutover run; change
the row's model in Prompt Templates, publish, run again, and confirm `api_usage_log` records the new
model. A failed live check → `git revert` the route commit; rows stay.

## 6. Stages

### Stage 0 — Shared pieces (no route changes)
1. Extract `resolvePromptModel` from `execute-prompt.js` to a shared module; the Executor imports it
   (pure extraction; existing Executor tests pass unchanged).
2. Write `lib/services/tool-prompt-resolver.js` + tests (§5.4).
3. Write `scripts/seed-tool-prompts.js` (manifest-driven, `--dry-run` default) + a unit test against a
   fixture manifest; no live execution.
4. Write the parity-test helper (`tests/helpers/prompt-parity.js`).
5. Prompt-injection gate: decide with a fresh-context reviewer how a seam-backed `-dynamics.js` prompt
   file is registered (precedent: `reviewer-finder-analyze`, `check-prompt-injection-tagging.js:256-271`,
   lists both the bundled and the `-dynamics.js` file). Record the pattern in §8 before Stage 1.
6. Fresh-context review of this document against the tree (P0, §7). Fix, log, then Stage 1.

### Stage 1 — Pilot: Expertise Finder (`expertise-finder/match.js` + `batch-match-service.js`)
- Row `expertise-finder.match`: system = today's cacheable system template with `{{roster_block}}`;
  body = user template with `{{proposal_text}}` (route-wrapped) and `{{additional_notes}}`; max tokens
  4096; model = today's `APP_MODELS['expertise-finder']` tier.
- Both callers resolve through `resolveToolPrompt`; delete the fallback-model retry (`match.js:105-112`,
  `batch-match-service.js:151-170`) per D4; keep the cacheable system block shape.
- Remove `expertise-finder` from `APP_MODELS` and `ModelConfigSection.js`.
- Prerequisites: route test for `match.js` (none today); parity test for `buildCacheableSystemPrompt` /
  `buildUserPrompt`; re-point `batch-match-service.test.js` and `expertise-finder-batch-match-route.test.js`.
- Docs: matrix rows (side effects: `wmkf_ai_prompt` read per call).
- **P1 retrospective:** fresh-context review of the pilot diff against §3; amend §3 before Stage 2.

### Stage 2 — Funding-gap analyzer
- Rows `funding-gap.extract` and `funding-gap.analyze`; the NSF/NIH/USAspending blocks stay wrapped by
  the route or builder exactly as today and enter as variables; builder branches pre-computed (§3.4).
- Re-point `tests/integration/funding-gap-payload-boundary.test.js`. Keep `appName:'funding-analysis'`.
  Remove `funding-analysis` from `APP_MODELS` / Model Config.

### Stage 3 — Expense reporter
- Rows `expense-reporter.extract-document` and `expense-reporter.extract-image` (the route-inline
  `createExpenseExtractionPrompt` becomes the seed source; its two branches become the two rows). The
  image block is unchanged. Re-point `tests/integration/process-expenses-a7.test.js` (keep its
  after-headers error test). Remove `expense-reporter` from Model Config.

### Stage 4 — Literature analyzer
- Rows `literature-analyzer.extract-paper` (PDF block unchanged), `.synthesize`, `.compare`; lenient
  parsing and fallback objects unchanged. Parity tests for the three builders first. Remove
  `literature-analyzer` (including its `visionModel`) from Model Config.

### Stage 5 — Multi-perspective evaluator
- Rows: `multi-perspective.initial-analysis` (PDF block unchanged) and the five text rows. Keep
  `callClaudeWithRetry`'s same-model retries; delete its fallback-model switch (D4). Re-point
  `multi-perspective-refusal.test.js`. Remove `multi-perspective-evaluator` from Model Config.

### Stage 6 — Close-out
- `grep -rn "getModelForApp('\(multi-perspective-evaluator\|literature-analyzer\|funding-analysis\|expense-reporter\|expertise-finder\)'" lib pages shared` → nothing.
- Retire the old builders now that the rows' bundled definitions are the fallback (after confirming
  no other importer; the prompt-injection gate registrations move with them).
- Docs: `AI_DATA_FLOW_MATRIX.md` rows; `PROMPT_STORAGE_DESIGN.md` "Current implementation boundary";
  `docs/agent-wiki/topics/prompt-executor.md` (the seam is now shared); `API_ROUTE_SECURITY_MATRIX.md`;
  `DEVELOPMENT_LOG.md`. Run `check:doc-currency`, `check:fact-consistency`, `check:doc-symbol-refs`.

## 7. Self-checking method (interval rule)

- **Planning checkpoints:** P0 — fresh-context verification of §1/§3 against the tree before Stage 0
  ends; P1 — pilot retrospective after Stage 1. Both recorded in §8 with agent type, SHA, verdict and
  each mismatch's disposition.
- **Per-stage review:** after each stage's PR opens, a fresh-context agent (this plan + the stage diff +
  parity output) answers: (a) parity is byte-equal for every branch; (b) envelope/status/frames
  unchanged; (c) the route takes model and max tokens only from the resolver; (d) the app is gone from
  Model Config and no consumer of its key remains; (e) A7 marker guard present; (f) nothing outside the
  stage's file list changed. Any failure blocks the next stage. Codex adversarial review is the
  repo-standard alternative (never a metered product — CLAUDE.md rule 12).
- **Live-check rule:** no stage is done until the owner's Preview + Production live check (§5) is
  logged (`feedback-briefs-are-snapshots-not-ship-state`).
- **Scope guard:** if a stage grows a new state model, receipt, or authority gate, stop and present it
  as a choice (`feedback-latency-plan-scope-accretion-postmortem`).

## 8. Decision and Stage Log (append-only)

- 2026-10-11: Plan drafted at `b3135037c`. Inputs: fresh-context route profiles (6 routes, Executor,
  precedent, cross-route commonality). Owner decisions D1–D9: **open**.
- 2026-10-11: **Planning checkpoint — fresh-context verifier (Explore agent, read-only, no history)**:
  ~60 claims checked; folded in: byte-identity premise weakened to nonce-normalized equality (D9
  widened); D7 rewritten — recorded memory policy is demand-driven migration, so this plan *proposes*
  a policy change rather than applying one; raw-mode terminal throws named as a second behavior
  change; EF 500-vs-502 mapping; seam semantics pinned to the resolver's fallback rules; builders with
  conditionals; undeclared override variables are stored unredacted (roster_block); expense reporter
  `sendError` `ReferenceError` recorded as a latent bug; five (not three) `llm-client` module-mock tests;
  matrix side-effects column; several line citations. Verdict after corrections: ready for owner review;
  **Stage 0 cannot start without D7**.
- 2026-10-12: **Owner decisions (review with Claude, Session 598).**
  - **D7 — adopted, narrowed:** staff editability is a sufficient trigger for moving a prompt into
    Dataverse (alongside cross-surface sharing). Migration stays per-prompt, not a blanket sweep.
    Context: the owner reports most of the five apps are rarely used; the value is editing prompts
    and models without a redeploy.
  - **Approach changed — no Executor.** Every call (not only the three multimodal ones) uses the
    prompt-resolver seam that Reviewer Finder has used since S222 (`lib/services/reviewer-prompt-resolver.js`):
    prompt text read from the current Dataverse row, transient Dataverse error → bundled template,
    0 / >1 current rows → fail loud; the route keeps its own `LLMClient` call and its A7 wrapping.
    The resolver is reviewer-finder-specific today, so a generalized helper is new work.
  - **D8 — model lives on the row:** the app reads its model from the same row as its prompt, so the
    model stays visible and editable in `/admin` → Prompt Templates; these apps leave the Model Config
    section so there is never a second setting. Owner: a model that is not visible in `/admin` is too
    easy to lose track of.
  - **D4 — no fallback model** (vision model = the row's model). Today's transport retries are not
    changed by this decision.
  - **D3 moot** (no `wmkf_ai_run` rows: the seam does not use the Executor). **D2 moot** (every call
    uses the seam). **D9 largely moot** (route-built A7 framing is unchanged).
  - **Still open:** D1 scope and order (which apps first), D5 streaming unification, D6 page shell,
    whether the row's `maxTokens`/`temperature` are honored like the model (proposed: yes, so no
    row field is silently ignored). The two latent bugs (expense-reporter `sendError`, funding-gap page
    swallowing error frames) are to be fixed separately, independent of this plan.
- 2026-10-12: **Owner answers to the remaining questions; body rewritten (Session 598).** D1: all five
  apps. D10 (new): rows carry model and max tokens, no temperature — the owner asked for the
  temperature claim to be checked against Anthropic's documentation; the live Haiku 5.5 and Sonnet 5.5
  migration guides and the bundled Claude API reference confirm it is removed or default-only on the
  current generation. D5/D6 dropped: the owner chose to fix the error-reporting bugs directly — merged
  `a804f63bc` (expense `sendError` scope; funding-gap page swallowing error frames; literature and
  evaluator routes now end a failed stream with `event:'error'` and their pages report it; Codex
  adversarial review: approve, no findings). §§0, 2–7 rewritten for the seam design; §1 kept as the
  `b3135037c` baseline with a supersession note. Next: Stage 0.

