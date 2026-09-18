---
agent_wiki: topic
status: active
last_verified: 2026-09-18
stale_after_days: 90
owner: ai-platform
source_files:
  - lib/services/llm-client.js
  - lib/services/execute-prompt.js
  - lib/services/executor-budget-service.js
  - lib/services/reviewer-prompt-resolver.js
  - lib/services/reviewer-prompt-composer.js
  - lib/services/prompt-store.js
canonical_docs:
  - docs/EXECUTOR_CONTRACT.md
  - docs/SERVICE_AND_UTILITY_CATALOG.md
  - docs/APPLICATION_STATE_ATLAS.md
watch_paths:
  - lib/services/llm-client.js
  - lib/services/execute-prompt.js
  - lib/services/executor-budget-service.js
  - lib/services/*prompt*.js
  - shared/config/prompts/**
  - docs/EXECUTOR_CONTRACT.md
update_triggers:
  - prompt storage or composition changes
  - shared Executor contract changes
  - provider/model routing changes
---

# Prompt & Executor

Use this page for prompt storage, runtime prompt resolution/composition, shared
Executor behavior, LLM provider calls, PDF/document processing tiers, and the
reviewer-finder prompt migration.

## Ground Rules

- Use `lib/services/llm-client.js` for provider calls. The Executor alone may reach OpenAI, through `lib/services/openai-client.js`, and only when the caller passes `allowedProviders` including `openai`; prompt publishing stays Claude-only (VRP Phase A0, 2026-09-12; see `docs/EXECUTOR_CONTRACT.md` § Provider dispatch).
- Use `lib/services/execute-prompt.js` for shared Executor behavior.
- Prompt claims must trace resolver, composer, runtime caller, fallback behavior, and tests.
- **requestId trust-boundary chokepoint:** `executePrompt` interpolates `requestId` into a raw
  Dataverse key predicate via `grantRequestAdapter.getById/updateById` → `akoya_requests(${id})`.
  It rejects a non-GUID `requestId` up front (`isGuid`), so a route forwarding a client id without
  its own guard (the `summarize-v2` class) cannot reach the selector. `check:trust-boundary-guid`
  treats `executePrompt({ requestId })` as an object-arg sink, so route-edge validation is still
  required and enforced in CI; this is defense-in-depth, not a replacement.
- **Route-owned A7 when passing pre-wrapped text (S344):** `applyVariableBoundaries` only
  wraps + emits a nonce for a variable declared `untrusted:true` + `dataClass`/`maxChars`, and
  `composeMessages` only injects the `buildUntrustedContentPreamble` when `untrustedNonces>0`.
  So if a route pre-wraps untrusted content itself (e.g. `process-peer-reviews.js` keeps N
  per-review nonces) and passes it as a plain override, the Executor adds NO preamble — the
  route MUST supply the preamble as its own variable interpolated into the row (peer-review
  puts it in the system prompt via `{{a7_preamble}}`), and that variable must be seeded
  `required:true`/no-default so an omission fails closed. That alone is NOT enough — the row
  system prompt (`{{a7_preamble}}`) is staff-editable, so a bad /admin edit could drop the
  placeholder and send content with no preamble while a route-local check still passes. Pass
  `executePrompt({ assertSystemIncludes: [<nonces>] })`: the Executor throws AFTER composing and
  BEFORE the Claude call if the composed system prompt is missing any required substring, tying
  the guarantee to the real prompt, not caller inputs (S344, Codex-flagged). See
  `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`.
- **Model-aware request building (S286):** `llm-client._buildBody` OMITS the `temperature`
  param for models that reject it (Opus 4.8 — the API 400s with "`temperature` is
  deprecated for this model"); `modelSupportsTemperature()` gates it. When adding an
  app on a reasoning-tier model, confirm whether `temperature` is accepted.
- **Response completeness + structured output (2026-07-27):** the Executor
  preserves `LLMClient`'s joined text and stop metadata, then requires
  `stopReason=end_turn` before raw/JSON parsing or persistence. A syntactically
  valid `max_tokens` prefix is still rejected. Native Anthropic JSON schema is
  explicit per prompt (`generationMode:native-json-schema`), requires a declared
  `jsonSchema`, and fails closed unless the resolved concrete model has
  `supportsStructuredOutput:true`. Local `validationSchema` remains the
  post-parse write boundary. The Executor does not semantically retry; review
  synthesis is the current caller-owned exception, re-invoking once only for
  typed `claude_output_truncated`, with a separate AI-run audit attempt.
- **Server-owned output budgets (Production-deployed S469, 2026-08-30; revision v1
  published 2026-09-07, S493):** `lib/services/executor-budget-service.js` resolves the
  latest append-only Dataverse `wmkf_appsystemsettings` revision named
  `executor.budgets.vNNNNNN`. The Pre-Site caller reads its standing token /
  timeout pair; review synthesis reads its retry floor/ceiling only after a
  typed truncation; the Workbench field primer (`field-primer.generate`, S493)
  reads a timeout-only budget (default 240s) before claiming its generation
  lease, after the shared 120s transport timeout expired in Production on
  Request 1002852, and passes the Executor an absolute `deadlineMs` (lease
  deadline minus its grounding reserve) that `callClaude` re-checks immediately
  before the provider call and carries as an abort across every retry and
  backoff. `executePrompt` also accepts a server-owned `signal` (`AbortSignal`,
  S509) combined with the deadline via `AbortSignal.any`; the Cycle Dossier
  worker passes an operator-stop poll so a stop during 429/529 backoff aborts
  the call, and the caller's abort reason propagates unwrapped. Older two-key revisions still parse; missing registered names fill
  from code defaults. `executor.budgets.v000001` (owner-directed 2026-09-07) pins the reviewed
  defaults for all three prompts; the Admin editor blocks a no-op republish, so an identical
  document must go through `PUT /api/admin/executor-budgets`.
  **[PRODUCTION-VERIFIED 2026-09-07]** merge `ebcad0ab`,
  Ready deployment `dpl_748H9dcgzp3Yc6R7YgqNBvswAMBy`; the owner-run signed-in
  regeneration of Request 1002852 (the request whose 120s failure prompted this)
  returned 200 in roughly 100 seconds, rendered and persisted the primer, and
  logged no new `/api/field-primer/generate` error event; the run took roughly 100 seconds, so
  the old 120s limit was failing at the margin. `/api/admin/executor-budgets` is superuser-only and
  publishes one complete immutable revision with expected-version,
  payload-bound UUID idempotency, resolved-model ceiling checks, and post-create
  verification of the exact created row. Settings reads page to completion;
  create races reread current state, and replay responses return current state
  plus the matching publication receipt. Governed prompt-model publication also
  checks the current durable budget before writing, including seed/recovery
  writers; the final Executor seam caps server-owned overrides to the resolved
  model ceiling to close cross-publication races. Review synthesis also supplies
  the first attempt's budget as a strict lower bound, so a capped retry aborts
  before the provider call unless its effective budget is larger.
  `shared/config/executorBudgets.js` now owns only the closed
  schema, code safety bounds, descriptions, and S466/S467 outage fallback
  (32 768 / 240 s and 16 000–32 000). Runtime request bodies never carry
  budget authority. A malformed row is skipped with an Admin-visible warning
  while its numeric revision remains reserved; the next publication uses the
  highest reserved revision rather than reusing a key, and idempotency still
  scans every parseable row. Unknown future schemas block the older publisher.
  Conflicting Admin drafts are retained but cannot publish until explicitly
  field-level reapplied or reset. Admin reads fail closed on backend failure;
  runtime reads use the highest valid revision, or the bounded fallback when
  settings are absent/unavailable or no valid revision remains. The owner
  verified the Production Admin read surface in that safe no-revision/fallback
  state; publishing revision 1 remains an explicit later action.

## Hazard: thinking-default models spend `max_tokens` on reasoning

**Pattern (2026-09-18, Initial Assessment rehearsal, run `7d8b647c-abb3-f111-aaac-000d3a361c1f`):**
`stop_reason=max_tokens`, `output_tokens` equal to the prompt row's `wmkf_ai_maxtokens`,
and the retained answer text is EMPTY (hash of `""`). Nothing was dropped by us: the
budget was consumed before the first `text` block existed.

**Why.** Claude Opus 5, Sonnet 5, and the Fable/Mythos family run adaptive thinking
when the request omits `thinking` (registry `thinkingMode: adaptive_default_on` /
`adaptive_always_on`). Anthropic: thinking tokens "count toward `max_tokens`, a hard
limit on total output", and under the default `display: "omitted"` the response
"can begin with one or more `thinking` blocks ... returned with an empty `thinking`
field". The Executor never sends `thinking` or `effort` (`llm-client.js` `_buildBody`),
so a prompt row budget sized for answer text alone (IA: 2,200 for ~400 words) can be
spent entirely on reasoning. Opus 4.6–4.8 run WITHOUT thinking when it is omitted,
which is why a tier alias advancing from `opus`→4.8 to `opus`→5 changes token
behaviour with no prompt edit. Both tiers (`opus`, `sonnet`) now resolve to
thinking-default models; reverting the alias alone is not a fix.

**Why it was invisible.** The prompt row stores a tier alias, not a concrete id;
admin publish clones `wmkf_ai_maxtokens` from the prior version and exposes no budget
input; standing budgets (`EXECUTOR_BUDGET_DEFAULTS`) cover only listed prompts
(`initial-assessment.generate` was added in the same PR: standing 12,000 / 120 s,
limits 4,096–32,000, threaded through the IA facade via `getExecutorBudget`). A
model-only republish therefore never re-reviews the budget. Adaptive thinking may skip
trivial tasks, so several live prompts run below 4,096 and still succeed (read-only
audit 2026-09-18: 8 current prompts, e.g. `cycle-dossier.research-plan` on Opus 5 at
3,000 passed 5/5). A blanket pre-call floor would break them, so the guard is advisory.

**What the code does now — [DEPLOYED TO PRODUCTION 2026-09-18 via PR #314, merge `0b240f0a`, GitHub deployment 6534604317 success; IA generation itself not yet re-rehearsed]:**
- `llm-client.js` normalizers return `blocks` (content-free `{type, chars}` census) and
  `thinkingTokens` (`usage.output_tokens_details.thinking_tokens`, null when absent).
- `execute-prompt.js` `thinkingBudgetAdvisory()` flags a thinking-default model below
  `THINKING_BUDGET_FLOOR_TOKENS` (4,096). It never blocks; it lands in `wmkf_ai_notes`
  as `thinkingBudget=below_floor(4096)` on success AND failure, next to
  `blocks=thinking:0,text:0` and `thinkingTokens=N`.
- A `max_tokens` stop with zero text keeps code `claude_output_truncated` (callers'
  bounded escalation retry depends on it) but sets `truncatedBeforeText=true` and a
  message naming the cause and remediation. The failure `wmkf_ai_rawoutput` envelope
  carries `blocks`, `thinkingTokens`, and `budgetAdvisory`.

**Triage checklist when you see `claude_output_truncated`:**
1. Read `wmkf_ai_notes`: `truncatedBeforeText=true` + `blocks=thinking:...` with no
   `text:` entry = reasoning ate the budget. Partial text = ordinary length overrun.
2. Check the resolved model's `thinkingMode` (`lib/services/model-capabilities.js`)
   and the row's `wmkf_ai_maxtokens`. Below 4,096 on a thinking-default model is the
   known-bad shape.
3. Fix = raise the budget (standing budget via `/admin` Executor Budgets when the prompt
   is registered in `EXECUTOR_BUDGET_DEFAULTS`; register it and thread `getExecutorBudget`
   through the caller when it is not) or lower effort. Do not retry the same budget;
   `claimExisting` reclaims a Failed IA row and pays again.
4. If the prompt is a producer with a pinned `promptVersion` contract
   (`INITIAL_ASSESSMENT_CONTRACT`), ship the contract bump with the republish; the
   producer refuses a mismatch AFTER the paid call (`initial_assessment_prompt_version_mismatch`).

## Durable Memory

- Prompt storage and Dataverse ground truth: `project-prompt-storage-strategy`, `project-dynamics-as-prompt-ground-truth`.
- PDF/document processing: `project-pdf-processing-tiers`.
- Reviewer prompt migration: `project-reviewer-prompt-dataverse-migration`.
- Prompt injection/security: `project-a7-prompt-injection-hardening`.
- Thinking-default budget truncation (zero-text `max_tokens`): `project-executor-thinking-budget-truncation`.

## Standard Probe

```bash
rg -n "executePrompt|llm-client|prompt-store|PromptResolver|PromptComposer|fallback" lib shared pages tests docs
```
