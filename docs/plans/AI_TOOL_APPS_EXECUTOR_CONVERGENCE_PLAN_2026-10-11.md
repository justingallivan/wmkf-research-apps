---
title: AI tool apps → Executor convergence — staged plan
domain: architecture
kind: plan
status: draft
summary: "Move the five live standalone AI tool apps (multi-perspective evaluator, literature analyzer, funding-gap analyzer, expense reporter, expertise finder) from bundled prompt modules + direct LLMClient calls onto Dataverse prompt rows executed through execute-prompt.js, one app per stage, routes keep their progress streaming, multimodal calls resolve prompt text through the same rows; owner decisions listed up front; written for a cheaper model to execute stage by stage."
canonical: false
owner: product-engineering
related:
  - docs/plans/LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md
  - docs/EXECUTOR_CONTRACT.md
  - docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/AI_DATA_FLOW_MATRIX.md
  - docs/SYSTEM_MODEL.md
---

# AI tool apps → Executor convergence — staged plan

Candidate **A** from `LARGEST_UNPLANNED_REFACTOR_SCOPE_2026-10-11.md`. Source baseline `origin/main`
`b3135037c`. Status: **draft — not authorized.** **2026-10-12 owner decisions (§8) replace the
Executor approach with the prompt-resolver seam for every call; §§0–7 below still describe the original
Executor design and are pending a rewrite.** Tier 2 runtime work: branch per stage, PR, owner
promotion; every stage also needs Dataverse prompt rows seeded in Preview and Production by the
owner-run seed script (a Dataverse write; `DATAVERSE_TARGET_INTERLOCK` applies).

The detailed per-route facts this plan rests on were gathered by a fresh-context agent at
`b3135037c` and are committed as `docs/plans/data/DIRECT_LLM_ROUTE_PROFILES_2026-10-11.md` (read it before
any stage); they are reproduced here where load-bearing, and every `[VERIFIED]` cites file:line in that tree.

## 0. Executor instructions (read first)

- This is a **prompt-home and call-seam migration**, not a prompt rewrite. The composed prompt text
  a model receives after each stage must equal today's builder output for the same inputs **after
  nonce normalization**, except the framing changes §2 D9 names (builders mint random nonces and a
  nonce-bearing preamble; the Executor uses `deriveStableNonce` and a nonce-free preamble
  `[execute-prompt.js:597-610, ~:1318]`). A parity test that masks nonces proves it before cutover.
- Every stage ships behind nothing but the route diff: cutover = merge the route commit after the
  rows are published; rollback = `git revert` that commit (rows stay published, dormant). This is
  the `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md:204-209` pattern.
- Do not start Stage 1 until every §2 decision has an owner answer recorded in §8.
- "STOP-AND-ASK" means stop, write what you found in §8, and wait.
- Worktree off `main`; `npm ci` first (lock is npm-10 compatible — never regenerate it).

## 1. Baseline (probed, not assumed)

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

## 2. Owner decisions required before Stage 1 (proposals with defaults; none are made)

| # | Decision | Proposed default | Why it is the owner's |
|---|---|---|---|
| D1 | **Scope.** Five live apps. Sunset pages (`batch-*`, `phase-*-writeup`) and their routes excluded. `cron/log-analysis` excluded (no cron `runSource`, ops-only, hard-coded model). | As stated | Removes four routes and ~1,700 lines from scope; the owner may instead want the sunset pages retired first (separate work). |
| D2 | **Multimodal calls** (3 sites: MPE Stage 1, literature Stage 1, expenses image). (a) Resolve the prompt **text** from the same Dataverse row via `prompt-store.fetchCurrentPrompt` + `interpolate` and keep the `LLMClient` call in the route (the S222 "Path A seam": resolver `lib/services/reviewer-prompt-resolver.js` — `fetchCurrentPrompt` inside its own `withDalContext`, transient-error fallback to the bundled template, fail-loud on 0/>1 current rows — plus composer `lib/services/reviewer-prompt-composer.js:135,149` for `interpolate`); or (b) amend the Executor contract with an `attachments` input (content blocks) — a canonical-doc change plus PA-conformance implications. | **(a)** | (b) changes a canonical contract that PA is meant to mirror (`EXECUTOR_CONTRACT.md:45-64`). |
| D3 | **Audit-row volume.** The evaluator will write up to 5 `wmkf_ai_run` rows per concept page (Stage 1 stays on the seam). Accept, with `rawOutputRetention:'hash'` in each tool row's output schema? | Accept, `hash` | Dataverse row volume and retention are owner concerns (`AI_DATA_FLOW_MATRIX.md:133-141` finding P2). |
| D4 | **Retry/fallback semantics change.** Under the Executor: no fallback model; transport retries = `LLMClient` defaults (3). Today MPE runs its own 3-retry loop with `maxRetries:0` and one fallback model `[:558-638]`; EF falls back on any non-refusal error `[:105-112]`. | Accept the Executor semantics | This is the one deliberate behavior change in the plan; it must be chosen, not assumed. |
| D5 | **Streaming protocol unification** (Stage 7): one SSE contract (`text/event-stream`; events `progress`, `result`, `error`; terminal event always sent; never `res.status(500).json` after frames) and `shared/utils/sse-stream.js` on all four pages. Fixes the swallowed-error bug in `funding-gap-analyzer.js:75-101` and the 500-after-stream paths. | Yes, after Stages 2–6 | Client-visible behavior change; also what makes the shared shell (D6) possible. |
| D6 | **Shared tool-page shell** (Stage 8): one `ToolPageShell` (upload → run → progress → results slot) replacing the per-page copies. | **Omitted** unless D5 ships and the owner asks | Largest UI change; value is consistency, not function. |
| D7 | **Prompt-home policy — this plan proposes changing it.** Recorded policy is that prompt migration to Dataverse is *demand-driven* (a prompt moves when it becomes shared, especially to a PA caller) `[.claude-memory/project-system-model.md:37]`, and that Executor scope follows the automation contract, not "every app that calls an LLM" `[.claude-memory/feedback-cycle-vs-executor-scope.md]`. These five apps are Vercel-only; their trigger would be staff editability alone, which `SYSTEM_MODEL.md:375` lists as the unresolved fork. The owner must explicitly adopt editability as a sufficient trigger, or this plan stops at Stage 0. | Owner rules; no default | It reverses a recorded policy framing. |
| D8 | **Where staff choose the model.** After migration a tool's model is the row's `wmkf_ai_model` (edited in Prompt Templates), no longer the Model Config section's per-app tier. Accept, and record the seed-time model as the current `getModelForApp` resolution? | Accept | Staff-facing admin change. |
| D9 | **Accepted framing changes** (not byte-identical; same category the peer-review plan accepted `[:193-202]`): the A7 preamble moves from the top of the user prompt into `system` when the Executor wraps an `untrusted` variable and becomes the **nonce-free** general form; sentinel nonces become `deriveStableNonce` values instead of per-call random ones; EF's cacheable `system` becomes the row's system template. | Accept | Prompt framing is a product decision. |

## 3. Pre-made design (executors do not relitigate once §2 is answered)

1. **Row naming:** `<app-key>.<stage>` — `expertise-finder.match`, `funding-gap.extract`,
   `funding-gap.analyze`, `expense-reporter.extract-document`, `expense-reporter.extract-image`,
   `literature-analyzer.extract-paper`, `literature-analyzer.synthesize`, `literature-analyzer.compare`,
   `multi-perspective.initial-analysis`, `multi-perspective.proposal-summary`,
   `multi-perspective.optimist`, `multi-perspective.skeptic`, `multi-perspective.neutral`,
   `multi-perspective.integrator`. Rows used only via the seam (D2a) are still rows, so staff edit
   every prompt in one place.
2. **Seed source of truth:** `shared/config/prompts/<app>-dynamics.js` exporting row definitions in
   the exact object shape of `scripts/seed-peer-review-summarizer-prompts.js:66-128`
   (`promptName, systemPrompt, body, model, temperature, maxTokens, variables:{variables:[…]}, outputSchema:{outputs, parseMode, validationSchema?, rawOutputRetention}, notes`),
   templated with `{{var}}` placeholders; one generalized seed CLI `scripts/seed-tool-prompts.js --app <key> --dry-run|--execute` with the same create-only / `--force` version-preserving rules as
   `lib/services/prompt-seed.js:1-20`. The legacy builders stay importable as the rollback path and as the parity oracle (peer-review precedent).
3. **Parse modes:** use `parseMode:'raw'` and keep each route's existing lenient parsing where today's
   route degrades to a fallback object on bad JSON (MPE stages, literature, expenses). Use
   `parseMode:'json'` + `validationSchema` only where today's route already throws/errors on invalid
   output (EF match → 502; funding-gap extraction → throw). This preserves failure behavior.
   Note: raw mode still **adds** Executor terminal-state throws (`claude_output_empty` under 20 chars,
   `claude_output_truncated`, `claude_output_incomplete`, `claude_output_refused` `[:893-958]`) where today
   only `requireAcceptedLlmResponse` rejects refusals `[lib/utils/llm-response.js:9]` — and expenses rejects
   nothing. Each route maps these to its existing error envelope; the mapping is listed per stage and is
   the second deliberate behavior change after D4.
4. **A7:** route-level `wrapUntrustedContent` calls move into row variable declarations
   (`untrusted:true`, `dataClass`, `maxChars` equal to today's constants: `PROPOSAL_TEXT`/100 000 for
   EF and funding-gap, `STAFF_PROVIDED_CONTEXT`/60 000 for expenses PDF, `EXTERNAL_API_TEXT`/120 000 for
   funding-gap API blocks, the MP_* caps for evaluator stages). Where a route must keep a route-built
   preamble (seam calls), pass it via a `{{a7_preamble}}` variable and enforce with
   `assertSystemIncludes` exactly as `process-peer-reviews.js:280-289` does.
5. **Usage logging:** extract `logPeerReviewUsage` (`process-peer-reviews.js:213-230`) into
   `lib/services/executor-usage.js` `logExecutorUsage(result, { appName, userProfileId, status, latencyMs })`;
   every migrated route calls it with today's `appName` string (keep `'funding-analysis'` for funding-gap — no key renames in this plan).
6. **`runSource`:** `'Vercel Interactive'` for all five apps (same as peer-review).
7. **Routes keep:** method/auth/rate-limit/`loadModelOverrides` (while any resolver call remains),
   input fetching and parsing, progress framing, response envelopes and status codes, persistence
   (EF Postgres insert). Routes lose: prompt builders, `new LLMClient`, `wrapUntrustedContent` for
   Executor-handled variables, manual usage math.
8. **Builders with logic** (e.g. funding-gap analyze: `usaSpendingData.disabled ? 'NOT QUERIED…' : wrapped`,
   `keywords.join` `[prompts/funding-gap-analyzer.js:124]`) are not expressible as `{{var}}` templates; the
   route pre-computes each branch into a variable and the parity test covers both branch values.
9. **Seam-call semantics (D2a):** resolve with `fetchCurrentPrompt` inside `withDalContext`; on a transient
   Dataverse error fall back to the bundled builder; on 0 or >1 current rows fail loud — the resolver's
   rules `[reviewer-prompt-resolver.js:1-21]`. No per-user override tier for these apps.
10. **Every override variable declares `dataClass`/`maxChars`**, including non-untrusted ones such as EF's
   `roster_block`: `writeRunRow` stores undeclared override values unredacted up to 4,000 chars in
   `wmkf_ai_promptoverride` `[execute-prompt.js:1135-1141]`.
11. **Order of apps:** EF (1 call, JSON, has page tests) → funding-gap (2 calls, SSE B, has a
   boundary test) → expenses (1 call, mixed modal) → literature (no tests today — write them first) →
   MPE (largest; last). Each app is one stage and one PR.

## 4. Non-goals

Prompt wording changes; model-tier changes; renaming app keys; retiring sunset pages; the Executor
streaming variant; PA execution of these prompts; changing `FileUploaderSimple`/upload handler;
Dynamics Explorer, reviewer-finder, grant-reporting, integrity-screener (other code paths).

## 5. Verification protocol

**Pre-stage re-probe** (log the output):
```bash
grep -rl "llm-client" pages/api | sort                 # shrinks by one route per stage
grep -rl "execute-prompt" pages/api | sort             # grows by one
grep -c "fetchCurrentPrompt\|executePrompt" pages/api/<route>.js
node scripts/seed-tool-prompts.js --app <key> --dry-run  # prints the rows that would be written
```

**Prerequisite tests per stage** (must exist and pass BEFORE the route diff):
1. `tests/unit/tool-prompt-parity/<app>.test.js` — for each builder, fixture inputs → builder output
   string; the same inputs → `interpolate(row.systemPrompt/body, vars)` (and for Executor calls, the
   composed system/body via the same interpolation) → assert equality modulo the D9 framing moves
   (assert the moved preamble is present in `system` and absent from `body`).
2. Route test with `execute-prompt` module-mocked, asserting: `promptName`, every `overrideVariables`
   key, `runSource`, `assertSystemIncludes` when used; response envelope and status codes unchanged
   for success, refusal (`claude_output_refused` → today's refusal status), invalid output, provider
   error. For literature and EF match (no route tests today) write the "before" test against the
   `llm-client` mock first, then port it.
3. For routes with progress streaming: a frame-sequence characterization test (ordered list of
   `data:` payload keys) captured before and asserted unchanged after (until Stage 7 changes it on purpose).

**Green gate (every stage):**
```bash
npx jest --testPathPatterns '<app>|execute-prompt|prompt-parity|prompt-store' --silent
npm run check:prompt-injection-tagging && npm run check:prompt-injection-tagging:self-test
npm run check:model-override-warming && npm run check:model-override-warming:self-test
npm run check:api-routes && npm run check:api-routes:self-test
npm run check:doc-currency && npm run check:doc-symbol-refs
npm run lint && npm run check:types && npm run build
npm test   # full suite at the end of each stage, before the PR
```

**Live verification (owner-run, per stage, Preview then Production):** seed rows (`--execute`),
`/admin` → Prompt Templates shows the new rows; run the tool once with a sample file; confirm a
`wmkf_ai_run` row per call with the expected prompt name and version; confirm one `api_usage_log` row
per call with today's `app_name`; compare the output shape with a pre-cutover run of the same file.
A failed live check → `git revert` the route commit; rows stay.

## 6. Stages

### Stage 0 — Decisions, baseline, harness (no production code)
1. Owner answers D1–D9; record in §8.
2. Owner-run read-only usage ranking: `SELECT app_name, count(*) FROM api_usage_log WHERE created_at > now() - interval '180 days' GROUP BY 1` (Production Postgres, owner executes; agent never reads Production). Re-cut D1 if an app is unused.
3. Write `lib/services/executor-usage.js` + test; switch `process-peer-reviews.js` to it (same bytes logged) — this is the only Stage 0 runtime change and is itself a pure extraction.
4. Write `scripts/seed-tool-prompts.js` (manifest-driven; `--dry-run` default) + unit test against a fixture manifest; no live execution.
5. Write the parity-harness helper (`tests/helpers/prompt-parity.js`) used by every stage.
6. Fresh-context planning review of this document (§7). Fix, log, then Stage 1.

### Stage 1 — Pilot: Expertise Finder (`expertise-finder/match.js` + `batch-match-service.js`)
- Prerequisites: route test for `match.js` (does not exist); parity test for `buildCacheableSystemPrompt` / `buildUserPrompt`.
- Row `expertise-finder.match`: system = today's cacheable system template with `{{roster_block}}`; body = user template with `{{proposal_text}}` (`untrusted:true`, `PROPOSAL_TEXT`, 100 000) and `{{additional_notes}}`; `parseMode:'json'`, `validationSchema: EXPERTISE_MATCH_SCHEMA`; error mapping: `claude_output_invalid_json` → today's 500 + `rawResponse` `[match.js:124-129]`, `claude_output_schema_invalid` → 502 `[:136-138]`; `roster_block` declared with a cap (§3.10); `maxTokens 4096`, `temperature 0.2`, model = current resolution of `getModelForApp('expertise-finder')` at seed time (D8).
- Route: replace `callClaude` with `executePrompt`; keep roster query, hash, Postgres insert, `logExecutorUsage` with `appName:'expertise-finder'`, `modelUsed = result.meta.modelUsed`; fallback behavior per D4. `batch-match-service.js` uses the same row via the same call shape.
- Re-point `batch-match-service.test.js:19` and `expertise-finder-batch-match-route.test.js:25`; update matrix rows `:227` and `:312` (side effects).
- Registry: `check-prompt-injection-tagging.js` entry inv 13 gains the `-dynamics.js` prompt file with the Executor-handled comment (pattern `[:164-175]`).
- **P1 retrospective:** fresh-context review of the pilot diff against §3; amend §3 before Stage 2 (Route→Service plan precedent).

### Stage 2 — Funding-gap analyzer
- Rows `funding-gap.extract` (`json` + `FUNDING_EXTRACTION_SCHEMA`; today throws) and `funding-gap.analyze` (`raw`); variables `proposal_text` (untrusted, 100 000) and `nsf_block`/`nih_block`/`usa_block` (untrusted, `EXTERNAL_API_TEXT`, 120 000 — today wrapped inside the builder `[prompts/funding-gap-analyzer.js:85-107]`), `search_years`, `pi`, `institution`, `keywords`.
- Route keeps Variant B framing exactly (frame test from §5.3). Re-point `tests/integration/funding-gap-payload-boundary.test.js` to assert the boundary marker through `overrideVariables`/row caps instead of the `llm-client` mock. Keep `appName:'funding-analysis'`.
- `createBatchFundingSummaryPrompt` has no caller in `pages/` or `lib/` (only the `shared/config/index.js:51` re-export and its A7 test): leave it; do not delete (rollback-path rule).

### Stage 3 — Expense reporter
- Row `expense-reporter.extract-document` (Executor; `raw`; route keeps its warn-and-fallback `validateAiJson` path for the PDF branch `[:336-364]`; the image branch's equivalent is `[:255-283]`); row `expense-reporter.extract-image` (seam, D2a: text from the row, `LLMClient.complete` with the image block unchanged `[:229-245]`).
- Route-inline `createExpenseExtractionPrompt` `[:41-121]` becomes the seed source; its two branches become the two rows. Variant C framing unchanged, including the `sendError` `ReferenceError` at `:429` — **do not fix it in this stage** (no-behavior-change rule); it is fixed by construction in Stage 7, or as a separate one-line bug fix if D5 is declined (owner call, record in §8). Executor refusal/terminal throws → `{type:'error'}` frame (new behavior; today refusals pass through unparsed). Re-point `tests/integration/process-expenses-a7.test.js`.

### Stage 4 — Literature analyzer
- Prerequisites first: route test (none today) and parity tests for the three builders.
- Rows `literature-analyzer.extract-paper` (seam; PDF `document` block stays `[:226-232]`), `literature-analyzer.synthesize` and `literature-analyzer.compare` (Executor, `raw`; route keeps lenient parse + fallback objects `[:283-286, :318-321]`); `papers_block` untrusted `STAFF_PROVIDED_CONTEXT` 120 000 (today's `LITERATURE_SUMMARIES_MAX_CHARS`). Variant A framing unchanged; `CONCURRENCY_LIMIT` stays unused (no behavior change).

### Stage 5 — Multi-perspective evaluator
- Rows: `multi-perspective.initial-analysis` (seam; PDF block), five Executor rows (`proposal-summary`, `optimist`, `skeptic`, `neutral`, `integrator`; `raw`; route keeps `validateStage` and fallback objects `[:44-56, :493-499]`); caps per `MP_CONCEPT_MAX_CHARS`/`MP_LITERATURE_MAX_CHARS`/`MP_PERSPECTIVE_MAX_CHARS` as untrusted variables.
- `callClaudeWithRetry` `[:558-638]` is removed per D4; `processWithConcurrency` export and its test stay. Re-point `multi-perspective-refusal.test.js` (its exact-call-count assertions change meaning under Executor retries — rewrite them as `executePrompt` call counts). Variant A framing unchanged.

### Stage 6 — Close-out of the migration proper
- `grep -rl "llm-client" pages/api` returns only the sunset routes and `cron/log-analysis.js` (D1).
- Docs: `AI_DATA_FLOW_MATRIX.md` rows for the five routes (controls column: Executor caps);
  `PROMPT_STORAGE_DESIGN.md` "Current implementation boundary" lists the new rows; `SYSTEM_MODEL.md:375` fork
  disposition per D7; `API_ROUTE_SECURITY_MATRIX.md` notes; `docs/agent-wiki/topics/prompt-executor.md`;
  `DEVELOPMENT_LOG.md` entry. Run `check:doc-currency`, `check:fact-consistency`, `check:doc-symbol-refs`.

### Stage 7 — Conditional (D5): one streaming contract + `sse-stream.js`
- Prerequisite: frame-sequence tests for all four routes (from §5.3) plus page tests that assert
  progress text, result rendering, and **error surfacing** for each page (none exist for the four
  streaming pages today).
- Server: `text/event-stream`; events `progress {message, percent?, stage?}`, `result {…today's results object…}`, `error {message}`; always a terminal event; errors after headers go as `error` frames, never `res.status(500).json`. Client: `parseSseStream` from `shared/utils/sse-stream.js` replacing the four hand-rolled reader loops (`multi-perspective-evaluator.js:679-721`, `literature-analyzer.js:403-445`, `funding-gap-analyzer.js:56-101`, `expense-reporter.js:77-107`). One route+page pair per commit; the funding-gap page's swallowed-error bug is fixed by construction.

### Stage 8 — Conditional (D6): shared tool-page shell
Only after Stage 7. One page per commit onto `shared/components/ToolPageShell.js` (upload via
`FileUploaderSimple`, run button, progress, `ErrorAlert`, results slot). Measured against the page
tests from Stage 7; no visual redesign (Impeccable review is a separate ask).

## 7. Self-checking method (interval rule)

- **Planning checkpoints:** P0 — fresh-context verification of §1 against the tree before Stage 0
  ends; P1 — pilot retrospective after Stage 1 (amend §3). Both recorded in §8 with agent type, SHA,
  verdict, and each mismatch's disposition.
- **Per-stage review:** after each stage's PR is opened, a fresh-context agent (reads only this plan
  + the stage diff + the parity test output) answers: (a) parity test proves byte-equality modulo D9;
  (b) route envelope/status/frames unchanged (tests); (c) no `new LLMClient` remains in the migrated
  route except D2a seam calls; (d) registry/matrix/docs updated; (e) nothing outside the stage's
  file list changed. Any failure blocks the next stage. Codex adversarial review is the
  repo-standard alternative (never a metered product — CLAUDE.md rule 12).
- **Live-check rule:** no stage is "done" until the owner's Preview + Production live check (§5) is
  logged. A plan is not a deployment (`feedback-briefs-are-snapshots-not-ship-state`).
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
