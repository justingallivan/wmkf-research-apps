---
title: Executor Contract
domain: prompt-executor
kind: source-of-truth
status: canonical
summary: "Single-prompt execution contract for the shipped Dataverse path and the branch-built profiled job mode."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-09-12
owner: product-engineering
related:
  - lib/services/execute-prompt.js
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/BACKEND_AUTOMATION_PLAN.md
  - docs/WORKFLOW_CHAINING_DESIGN.md
---

# Executor Contract

**Shipped [VERIFIED via `lib/services/execute-prompt.js` and its callers]:**
The legacy single-prompt path serves the Phase I summary route and grantee,
field-primer, and review services.

**Branch-built [VERIFIED via Executor, job worker, and ledger source]:** The
[internal profiled job mode](#internal-profiled-job-mode) uses the same
Executor transport and parser with frozen inputs, awaited checkpoints, and
deferred audit. The branch includes synthetic text fixtures, a default-off
staff proposal draft trial, and an offline typed recommendations fixture.
Admin can author immutable profile revisions and registered text task versions
and render a fabricated sample. [Staff trial](#staff-proposal-draft-trial),
[typed fixture](#typed-recommendations-fixture).

**Planned (owner decision, 2026-11-10):** Power Automate will submit and poll
jobs through authenticated endpoints. PA routes, Entra authorization,
real Request-field destinations, and broader task enablement remain planned.
See the [shared Executor job design](plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).

**Created:** 2026-04-24 (Session 109, reconciliation pass)
**Last status update:** 2026-11-11 (staff proposal trial and typed fixture)
**Owners:** Justin (backend Executor); Connor (Power Automate trigger and follow-up flows)
**Related docs:** `docs/PROMPT_STORAGE_DESIGN.md`, `docs/BACKEND_AUTOMATION_PLAN.md`, `docs/WORKFLOW_CHAINING_DESIGN.md`, `docs/GRANT_CYCLE_LIFECYCLE.md`

---

## Purpose

The Executor invokes one prompt per call. The shipped path resolves a Dataverse
prompt row or accepts a server-owned snapshot, composes the input, calls the
provider, validates the response, and attempts an invocation audit. The internal
profiled mode accepts a frozen prompt and context and returns audit data to the
worker. Callers own sequencing and business follow-up.

## Scope of generality

The shipped path covers **Pattern A, dual-caller prompts, and Pattern B/C Vercel-only prompts** as defined in the [prompt storage design](PROMPT_STORAGE_DESIGN.md).

**In scope:**
- Single-shot Anthropic prompts and explicitly allowed OpenAI prompt snapshots (system + user, no multi-turn)
- Server-side callers, including user-triggered Vercel routes. Power Automate status triggers are planned through the job service.
- Summarization, classification, multi-output extraction
- Prompts that mix Dynamics-sourced inputs, SharePoint file inputs, and caller-supplied overrides
- Individual invocations within caller-orchestrated sequences. Callers can use persisted Dynamics outputs or pass approved shared inputs to multiple calls.

**Out of scope (separate code paths):**
- Tool-use / agent loops (Dynamics Explorer)
- Streaming SSE to the UI (token-by-token display — today's Phase II pattern stays outside)
- Providers other than Anthropic and OpenAI
- Anthropic Batch API (`wmkf_batch_run`, retrospective work)
- Multi-turn stateful conversations

---

## Signature

This signature describes the shipped legacy invocation. See [internal profiled job mode](#internal-profiled-job-mode) for the additional worker-only inputs.

### Inputs

| Name | Type | Required | Purpose |
|---|---|---|---|
| `promptName` | string | yes | Matches `wmkf_ai_prompt.wmkf_ai_promptname`. Executor requires the sole row with `wmkf_ai_iscurrent = true` for that name; the lookup filters on name and current flag and errors if zero or multiple rows match. It does not independently filter `wmkf_ai_promptstatus`, so runtime selection relies on the publisher's current-row lifecycle. |
| `requestId` | GUID | conditional | `akoya_request` row GUID. Required for prompts that declare any `dynamics:akoya_request.*` or `sharepoint` source variables. Optional for all-`override` prompts (Pattern B/C). |
| `overrideVariables` | object | no | Per-invocation variable overrides. Keys must match names declared in `wmkf_ai_promptvariables`. Used for user-session overrides (Vercel) and test harness runs. |
| `runSource` | enum | yes | One of the `wmkf_ai_runsource` picklist values (e.g., `PowerAutomate Auto`, `Vercel Interactive`, `Vercel User`, `Vercel Test`). Caller supplies. |
| `forceOverwrite` | bool | no | Default `false`. When `true`, output guards (see *Output guards*) are bypassed and the Executor writes regardless of whether targets are populated. Caller's choice — not a Dynamics-row setting. |
| `actingUserSystemId` | GUID | no | Dataverse system-user identity used to attribute supported writes. Callers must derive it from authenticated/server context, never request input. |
| `assertSystemIncludes` | string \| string[] | no | Fail-closed assertion that each required substring survived composition in the actual system prompt. Used when a mutable prompt row must retain a security-critical block. |
| `requireNoPersistence` | bool | no | Default `false`. When `true`, the Executor rejects any current prompt row whose output schema declares a target other than `kind: none`, before the model call or target write. Use for producers that need request-linked audit lineage but must remain pass-through-only even if the mutable prompt row drifts. |
| `promptSnapshot` | object | no | Server-owned frozen prompt row for a historical generation. When supplied, the Executor skips current-row lookup and validates exact `wmkf_ai_promptname`, GUID `wmkf_ai_promptid`, positive `wmkf_promptversion`, system/body text, and a concrete model id (tier aliases are refused). The snapshot must include the Executor's variable/output-schema/model fields; `requireNoPersistence:true` is required for Cycle Dossier pass-through stages. Existing callers omit this field and continue resolving the sole current row. |
| `allowedProviders` | string[] | no | Server-owned provider allowlist. Defaults to `['anthropic']`, preserving every existing caller. A resolved OpenAI model fails with `provider_not_allowed` before variable resolution unless the caller explicitly includes `openai`. Unknown models/providers retain the existing unreviewed-model failure. Never accept this value from client input; a workflow must intersect its own server-side provider policy before calling. |
| `maxTokensOverride` | positive integer | no | Server-owned, per-invocation output-budget override, capped at the final resolved model's reviewed `maxOutputTokens`. The Pre-Site standing value and review-synthesis retry floor/ceiling resolve through `lib/services/executor-budget-service.js` from the latest append-only `executor.budgets.vNNNNNN` Dataverse setting; `shared/config/executorBudgets.js` owns only the closed schema, safety bounds, and outage fallback. The superuser Admin panel reads the same resolved revision. Never accept this value from client input. |
| `timeoutMsOverride` | positive integer | no | Server-owned, per-invocation LLM transport timeout override (milliseconds), passed to `LLMClient` in place of its 120s default. The Pre-Site standing value and the field-primer timeout-only value resolve through the same durable budget revision and remain bounded to the reviewed 60 000–240 000 ms range; never accept it from client input. Non-integer/non-positive values are ignored. |
| `deadlineMs` | positive number (epoch ms) | no | Server-owned absolute bound for the provider call, for callers with a fixed time budget or time-limited lease (for example, field primer). Checked immediately before the model call: the transport timeout becomes the smaller of the caller's budget (or the client default) and the time remaining, and a deadline with under one second left throws `executor_deadline_exhausted` before any tokens are spent. Never accept it from client input. |
| `signal` | `AbortSignal` | no | Server-owned external cancellation for callers that must interrupt an in-flight provider call for reasons other than the deadline (e.g. the Cycle Dossier worker's operator-stop poll, S509). Combined with `deadlineMs`'s internal signal via `AbortSignal.any` when both are present, so either can end the call; a pre-aborted signal throws its `reason` before any tokens are spent. The caller's abort reason propagates unwrapped (same object identity) out of `executePrompt`. Never accept it from client input. |
| `auditRetention` | `'content-free'` | no | Default `undefined` keeps the existing audit behavior. `'content-free'` makes every `wmkf_ai_run` write for the call, on success, pre-flight-block, and every failure path (including failures before the prompt row or its declarations load), carry no input or model text: `wmkf_ai_promptoverride` lists override variable names and character counts only, `wmkf_ai_rawoutput` is forced to the `none` retention envelope on success (or `{ code, stopReason }` on failure, with no message, stack, or response output), and `wmkf_ai_notes` carry only `semanticAttempt`, `retryOf`, `code`, and `stopReason`. Pre-flight-blocked writes carry `{ blocked: true }` and notes with `preflightBlocked=true`, and the returned `meta.rawOutputRetention` reads `'none'`. Any other value throws `executePrompt: invalid auditRetention`. For callers whose inputs are sensitive transcripts. Server-owned; never accept it from client input. |
| `minimumEffectiveMaxTokensExclusive` | non-negative integer | no | Server-owned retry guard. After applying the resolved model ceiling, the final token budget must exceed this value or the Executor aborts before the provider call. Review synthesis uses the first attempt's budget here so a concurrent model change cannot trigger a retry with no larger effective budget. |
| `semanticAttempt` | positive integer | no | Default `1`. Server-owned audit metadata for caller-level semantic retries. |
| `retryOfRunId` | GUID | no | Prior failed `wmkf_ai_run` id when the caller re-invokes. Included in notes for deterministic audit pairing; null is allowed when the prior audit write failed. |

### Historical prompt snapshots and frozen inputs

`promptSnapshot` is an opt-in server boundary for workflows that have already
captured a published prompt row. `cycle-dossier-generation.js` stores the full
prompt row (including model, temperature, token budget, variable declarations,
and output schema) in its configuration snapshot and passes that exact object to
both no-persistence Executor stages. The Executor validates the identity and
version before model resolution and rejects `opus`, `sonnet`, and `haiku` tier
aliases so a later model-registry change cannot silently alter a replay. The
historical row is never fetched from the mutable current pointer during that
call; `prompt-store.fetchPromptVersion(name, {promptId, version})` is available
for a caller that needs to resolve the exact row before capturing it.

OpenAI can enter the Executor only through a server-built prompt snapshot whose
concrete model has a reviewed `provider:'openai'` capability row and only when
that call explicitly includes `openai` in `allowedProviders`. Prompt publishing
remains Anthropic-only; there is no caller-supplied `modelOverride` option.

Cycle Dossier variables are all declared `source.kind: override` and the worker
supplies the retained narrative/evidence strings. Passing `requestId` still
causes the Executor to perform its normal request-row read for request identity,
ETag/output-guard compatibility, and audit lineage. That read does not replace
any override variable and no dossier output schema permits a request write;
source freezing and change detection remain the generation service/worker's
responsibility. A caller using a historical snapshot must keep the snapshot and
its source payload immutable, use `requireNoPersistence:true`, and reauthorize
immediately before each provider stage.

### Durable Executor-budget publication

**[PRODUCTION-DEPLOYED 2026-08-30; FIRST REVISION PUBLISHED 2026-09-07.]** Revision
`executor.budgets.v000001` is live (published 2026-09-07T20:33:23Z by Justin Gallivan,
owner-directed): Pre-Site standing 32 768 tokens / 240 000 ms, review-synthesis retry
16 000–32 000, field-primer timeout-only 240 000 ms — the reviewed code defaults, pinned so a
later change to those defaults cannot move Production on its own. Publication reported model
ceilings for the two token-carrying prompts only, confirming the timeout-only kind skips that read.
The Admin editor refuses a revision identical to the current values, so v1 was published through
`PUT /api/admin/executor-budgets` from the signed-in superuser session.
`GET/PUT /api/admin/executor-budgets` is superuser-only and publishes one
complete budget document as a new `wmkf_appsystemsettings` row named
`executor.budgets.vNNNNNN`. Existing revision rows are never updated. PUT
requires the editor's `expectedVersion` plus a UUID `requestId`; this expected
value is the highest reserved numeric revision, which normally equals the
current valid version but can be higher when a damaged row was skipped. Stale editors
and payload-changing request-id reuse fail with 409. Request ids are
canonicalized, prefix reads follow all Dataverse pages, and a create race is
reread so a matching replay succeeds while a different winner returns the new
current state with 409. Post-create verification checks the exact created row,
even if a later valid revision has already overtaken it. The closed schema contains only:

- `pre-site-visit.proposal-core.generate`: standing `maxTokensOverride` and
  `timeoutMsOverride`;
- `review-synthesis.generate`: retry `floor` and `ceiling`;
- `field-primer.generate` (S493, 2026-09-07): timeout-only `timeoutMsOverride`
  (default 240 000 ms). Output tokens stay on the prompt row, so no model
  ceiling applies and publication does not read that prompt.
- `cycle-dossier.entry` (S509, 2026-09-12): timeout-only `timeoutMsOverride`
  (default 200 000 ms; envelope 60 000–220 000 ms, the worker's 280 s lease
  minus its 60 s checkpoint reserve). Read once at preview and pinned into the
  run's captured config as `budget.entryTimeoutMs`; the research-plan stage
  keeps its 85 s code default. Added after the 85 s default expired on the
  first pilot-mode entry call (Request 1002874).

Registry growth is additive: a stored revision published before a prompt name
was registered stays authoritative for the names it carries, and the reader
fills the missing names from the code default with no storage warning.
Publication always requires the complete set. Publication validates code-owned
numeric ranges and the token-carrying prompts' currently resolved
reviewed-model output ceilings before the create. Admin and seed
publication of a governed prompt model perform the inverse strict check against
the current durable budget. Because these are separate Dataverse publications,
the final Executor call seam also caps a server-owned override to the resolved
model ceiling; this closes the concurrent-publication interleaving without
weakening the fail-closed check for an invalid prompt-row budget. Runtime consumers
perform a lenient read and use the highest valid publication. A malformed row is
skipped with a bounded `storageWarnings` entry and its well-formed numeric key
still reserves that revision, so the next repair publication cannot reuse the
key. Admin shows the warning; if a draft is stale, publishing remains disabled
until the administrator resets or explicitly reapplies only locally changed
fields over the current server revision. An unknown future `schemaVersion`
remains a typed 409 publication blocker so older code cannot overwrite a format
it cannot understand. Admin reads fail closed on a Dataverse outage; runtime
reads use the reviewed code fallback on an outage or when no valid publication
exists. The fallback preserves the
S466/S467 values (32 768 tokens / 240 seconds; 16 000–32 000 retry range) but is
not the normal mutable source of truth. Runtime routes accept no budget fields.

Before the first publication, the owner-viewed Production Admin panel reported
**No published revision · using reviewed code fallback**. That dated observation
verified the read/fallback presentation at the time; it was superseded by the
owner-directed publication of revision 1 on 2026-09-07 described above. Runtime
reads now resolve the highest valid published revision, using the reviewed code
fallback only when settings are absent or unavailable or no valid revision exists.

**Deferred (Phase 1+):** `overridePromptBody: { system?: string, body?: string }` — body-level override for per-session prompt editing (PROMPT_STORAGE_DESIGN §17). Not needed for May 1.

### Outputs

| Name | Type | Purpose |
|---|---|---|
| `parsed` | object \| null | Output object matching `wmkf_ai_promptoutputschema`. `null` when `blocked = true`. Downstream chain steps consume this. |
| `runId` | GUID \| null | `wmkf_ai_run.wmkf_ai_runid` when audit-row creation succeeds. A thrown failure can carry `runId = null` if writing the failure row also fails. |
| `cacheHit` | bool | Derived from `usage.cache_read_input_tokens > 0`. OpenAI reports zero for both cache counters in this seam. |
| `blocked` | bool | `true` when at least one guarded target was already populated and `forceOverwrite` was false. No provider was called; no targets written. |
| `conflicts` | array | When `blocked`, one entry per guarded target that triggered the block: `{ output, table, field, existingContent, existingLength, modifiedOn }`. Caller (typically Vercel) uses this to render a confirm-overwrite UI. |
| `writeResults` | object \| null | When not blocked: `{ allOk, results: [{ output, ok, field?, jsonPath?, reason?, error? }] }`. `null` when blocked. |
| `usage` | object \| absent | Normalized snake-case provider usage (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). OpenAI cache fields are zero. The key is omitted from the blocked return. |
| `usageComplete` | bool \| absent | `true` only when the provider response carried both raw input and output token totals as finite, non-negative numbers. Normalized zero values must never be used to infer completeness. Omitted from the blocked return. |
| `meta` | object \| absent | `{ promptName, promptVersion, promptId, modelUsed, provider, systemChars, bodyChars, aiPayloadBoundaries, rawOutputRetention, semanticAttempt, retryOfRunId }`. The key is omitted from the blocked return. Useful for observability/UI display and caller-level retry linkage. |

### Errors

The Vercel Executor throws on prompt-not-found, variable-resolution, composed
system assertion, provider API, output-parse/validation, and other contract-level
failures. Individual target persistence failures are returned in
`writeResults` with `allOk=false`; the run is logged as `Needs Review` and the
parsed result is still returned so the caller can handle partial persistence
explicitly.

The normalized provider response must end with `stopReason="end_turn"` before
raw or JSON output can reach persistence. `max_tokens`,
`model_context_window_exceeded`, `refusal`, missing, and unreviewed stop reasons
fail closed even if the returned text happens to be syntactically valid JSON.
Typed output errors include `code`, `stopReason`, `maxTokens`, and the content-free
diagnostics `blocks` (per-block `{type, chars}` census), `thinkingTokens`
(`usage.output_tokens_details.thinking_tokens`, null when not reported), and
`budgetAdvisory` (set when a thinking-default model runs below the 4,096-token
advisory floor; never blocks the call). The current codes are
`claude_output_truncated`, `claude_context_window_exceeded`,
`claude_output_refused`, `claude_output_incomplete`, and
`claude_output_invalid_json`. A `max_tokens` stop with no text block keeps the
`claude_output_truncated` code (callers' bounded escalation retry depends on it)
and additionally sets `truncatedBeforeText=true`: on Opus 5 / Sonnet 5 / Fable,
default thinking spends tokens inside `max_tokens`, so an under-sized row budget
can be consumed before any answer text exists.

Every error thrown from inside the audited execution pipeline is annotated with `usage`, `modelUsed`, `provider`,
`usageComplete`, and `paidCall`. `paidCall=true` means a provider response was
received; `false` means failure happened before dispatch; `null` means dispatch
started but an abort or transport outcome left no usable response. The usage
object uses the same snake-case shape as a success and is zero-filled when no
response usage exists. A post-response parse, schema, refusal, truncation, or
later persistence/audit failure therefore cannot lose known usage. The Executor
still does not write `api_usage_log`; caller-owned ledgers remain responsible for
durable cost accounting.

### Provider dispatch

The resolved model capability row determines the transport. `anthropic` uses
the existing `LLMClient`; `openai` uses `OpenAIClient` only after the caller's
`allowedProviders` admits it. The OpenAI client flattens the Executor system
array into one message with the capability row's reviewed `instructionRole`,
uses `max_completion_tokens`, sends temperature only when the capability says
it is supported, and preserves `providerFinishReason`. It maps `stop` to
`end_turn`, `length` to `max_tokens`, and `content_filter` to `refusal`; a
non-empty `message.refusal` is also a refusal regardless of finish reason.
Unmapped reasons reach the existing fail-closed termination check.

**Legacy audit attempt invariant:** the Executor attempts a `wmkf_ai_run` row for
blocked, completed/needs-review, and thrown-failure outcomes. Audit persistence
can itself fail; that secondary failure is logged server-side and a thrown error
then carries `runId = null`. Do not describe the audit trail as mathematically
complete when Dataverse logging is unavailable.

---

## The 10 steps

| # | Step | Shipped legacy implementation |
|---|---|---|
| 1 | Resolve prompt | Use the sole current Dataverse prompt row by name, or validate a server-owned prompt snapshot. |
| 2 | Parse declarations | Parse the row's variable declarations and output schema. |
| 3 | Resolve variable values | Resolve each declared source kind and apply any declared A7 payload boundaries. |
| 4 | **Preflight output guards** | Inspect populated targets and capture the Request ETag for step 8. If a guarded target is populated and `forceOverwrite` is false, attempt a `Needs Review` audit row and return `{ blocked: true, conflicts, runId }` without steps 5–8. |
| 5 | Compose provider payload | Compose one system block and one user message from the prompt templates and resolved variables. |
| 6 | Call provider | `callProvider()` dispatches by the reviewed capability row: Anthropic → `LLMClient.complete()`; OpenAI → `OpenAIClient.complete()`. Both use `safeFetch`, abortable timeouts, retry, and key redaction. Anthropic retains its cache marker and native structured-output behavior. OpenAI uses the reviewed instruction role and Phase A keeps provider-native structured output disabled. No `appName` is passed, so the Executor does not write `api_usage_log`. |
| 7 | Validate termination + parse output | Require `stopReason="end_turn"` before parsing/persistence. Join every text content block. For JSON, apply required-key checks and then the optional local `validationSchema`. |
| 8 | Persist outputs | Coalesce all eligible `akoya_request` outputs into one PATCH using the ETag from step 4 when present. Direct field writes merge into the payload. For JSON paths, read the current memo and merge paths in declaration order. Two direct outputs for one field cause a schema error before writeback. A 412 marks all eligible outputs as `concurrent_edit`; persistence failures are reported through `writeResults`. |
| 9 | Log execution | Attempt to create a `wmkf_ai_run` row. See the logging contract for fields and failure handling. |
| 10 | Return | `{ parsed, runId, cacheHit, blocked, conflicts, writeResults, usage, usageComplete, meta }` on success. See the return contract for blocked calls. |

---

## Metadata shapes

These are the shipped legacy declaration shapes. The [internal synthetic mode](#internal-synthetic-job-mode) has its own opt-in declarations.

### `wmkf_ai_promptvariables` (Memo, JSON)

```json
{
  "variables": [
    {
      "name": "proposal_text",
      "source": { "kind": "sharepoint", "pattern": "project_narrative*.pdf", "preprocess": "pdf_to_text" },
      "required": true,
      "cacheable": true,
      "placement": "user"
    },
    {
      "name": "applicant_name",
      "source": { "kind": "dynamics", "table": "akoya_request", "field": "akoya_applicantname" },
      "required": true,
      "cacheable": false,
      "placement": "user"
    },
    {
      "name": "summary_length",
      "source": { "kind": "override", "default": "1" },
      "required": false,
      "cacheable": false,
      "placement": "user"
    }
  ]
}
```

**Source kinds (Phase 0):**

| Kind | Meaning | Executor behavior |
|---|---|---|
| `dynamics` | Field value from a Dataverse row keyed by `requestId` (or `table` + explicit GUID) | Dataverse GET |
| `sharepoint` | Fetch file by pattern from the SharePoint buckets for this request | Graph API GET + preprocess |
| `override` | Value from `overrideVariables` input; fall back to `default` | Read from input |

**Source kinds considered in the earlier design (unimplemented):**

| Kind | Meaning | Phase |
|---|---|---|
| `prior_output` | Value from a field a prior Execution wrote (implicit chaining via Dynamics) | Phase 1 |
| `context_block` | Recursively assemble another prompt row tagged as `Context` | Phase 2 |

**Preprocess hints (Phase 0):** `pdf_to_text` only — the live `execute-prompt.js` throws on any other hint. `docx_to_text`, `truncate_tokens:N`, `strip_images` are deferred until needed.

**Placement attribute (Phase 0 — present but single-valued):** v0 only supports `placement: "user"`. Earlier designs considered `placement: "system"` for context blocks. The synthetic profile composer defines its own placement rules.

**`cacheable` flag:** Phase 0 stores this declaration but does not use it to place variables
relative to the cache boundary. `composeMessages()` interpolates variables wherever their
placeholders occur in the stored system/body templates, and the Anthropic transport marks the completed
system block. An identical rerun can be cache-eligible when its composed prefix is unchanged
(including stable nonces for opted-in untrusted variables), but a cache hit must be verified
from response usage. The branch-built synthetic profile composer exercises
cross-prompt prefix equality using an explicitly frozen document block.

**Data classification + payload boundary (added 2026-05-04):** A variable can declare two additional optional fields to opt into the shared AI payload-boundary helper:

| Field | Type | Meaning |
|---|---|---|
| `dataClass` | string | Classification tag from `DATA_CLASSES` in `lib/utils/ai-payload-boundary.js` (e.g. `proposal_text`, `grant_report_text`, `crm_record_text`, `review_text`, `staff_provided_context`). |
| `maxChars` | integer | Hard cap on transmitted character count for this variable. |

**Both fields must be present for enforcement to fire** — declaring only one is treated as no declaration (backwards compatible). When both are present, the Executor applies `buildBoundedTextPayload` to the resolved value before composing the prompt:

- The bounded value is what reaches the prompt body / system block.
- Source string is `executor.<promptName>.<variableName>` (e.g. `executor.phase-i.summary.proposal_text`), so audit logs and tests can distinguish Executor-driven boundaries from route-driven ones.
- Boundary metadata (`source`, `dataClass`, `maxChars`, `originalChars`, `transmittedChars`, `truncated`, `truncationMarker`) is returned on `result.meta.aiPayloadBoundaries` (array, one entry per bounded variable). The `wmkf_ai_run` notes string also captures a compact form of the metadata (no content).
- Existing variables without these fields pass through ungated; adoption is opt-in per variable. Existing `kind: 'sharepoint'` variables that already use `source.maxChars` continue with the legacy silent substring unless they're upgraded by also declaring top-level `dataClass`.

Example:

```json
{
  "name": "proposal_text",
  "source": { "kind": "override" },
  "required": true,
  "cacheable": true,
  "placement": "user",
  "dataClass": "proposal_text",
  "maxChars": 100000
}
```

Callers no longer need to apply their own substring before passing values via `overrideVariables` — the Executor enforces the cap once, uniformly, regardless of `source.kind`.

### `wmkf_ai_promptoutputschema` (Memo, JSON)

```json
{
  "generationMode": "native-json-schema",
  "outputs": [
    {
      "name": "summary",
      "type": "string",
      "target": { "kind": "akoya_request", "field": "wmkf_ai_summary" },
      "guard": "skip-if-populated"
    },
    {
      "name": "keywords",
      "type": "array",
      "target": { "kind": "akoya_request", "field": "wmkf_ai_dataextract", "jsonPath": "$.keywords" },
      "guard": "skip-if-populated"
    }
  ],
  "jsonSchema": {
    "type": "object",
    "required": ["summary", "keywords"],
    "properties": {
      "summary":  { "type": "string" },
      "keywords": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

**`generationMode` (output schema, prompt-level opt-in):**
`"native-json-schema"` sends the declared `jsonSchema` through Anthropic's
native structured-output grammar. It requires `parseMode:"json"`, a real
`jsonSchema`, and `supportsStructuredOutput:true` on the resolved concrete
model. It is deliberately not inferred from `parseMode:"json"` because older
prompt rows may carry partial schemas intended only for the Executor's local
required-key check. Absence means ordinary generation; any unknown non-null
value fails closed before the Messages API call. Provider structured output
supplements—never replaces—the termination check and local `validationSchema`.
The Executor continues to resolve the model from the current prompt row; it
does not consult the per-app Admin → Models override for this decision. The
local 2026-08-16 Prompt Templates publisher changes `wmkf_ai_model` only by
publishing a new immutable prompt version and performs the native-output
capability/max-token check before Dataverse mutation. Direct out-of-band
Dataverse edits remain possible, so the Executor repeats its runtime capability
guard at invocation time.

**Target kinds (Phase 0):**

| Kind | Meaning |
|---|---|
| `akoya_request` | PATCH a field on the `akoya_request` row identified by `requestId`. `jsonPath` optional — used when multiple outputs share a JSON Memo field (e.g., `wmkf_ai_dataextract`). |
| `none` | Output is computed but not persisted (consumer is the caller's return value only). |

`wmkf_ai_run` was previously listed here as a target kind but is not supported by the live `execute-prompt.js` (which throws on any kind other than `akoya_request` or `none`). The Execution row's own fields are written by step 9 automatically; callers do not need to declare them as outputs.

**Output guards (Phase 0):**

Each output may declare a `guard` policy that the Executor applies in step 4 (preflight) before any provider call. Default is `"skip-if-populated"` for any `akoya_request` field-target.

| Guard | Behavior |
|---|---|
| `skip-if-populated` | Read target field. If populated (string-trim length > 0; for JSON-path targets, the path must resolve and be non-null/non-empty) AND `forceOverwrite = false` → block. |
| `always-overwrite` | Skip the preflight read. Always proceed to the provider. Use for fields that are deliberately re-derived every run (audit logs, computed scores, status flags). |

**Phase 1+ deferred guards:** `append` (concatenate to existing value with separator), `version-on-conflict` (write to `field_v2` etc.), `error-on-conflict` (fail with 409 instead of returning `blocked`).

**`parseMode` (output schema, Phase 0):** `"json"` (default — the provider must return parseable JSON matching `jsonSchema`) or `"raw"` (the complete joined text becomes the value of the single declared output; `jsonSchema` ignored). Multi-output prompts must use `"json"`.

**`validationSchema` (output schema, added 2026-05-22 — A7 step 3):** an optional declarative schema, in the `validateAiJson` node format (`lib/utils/ai-output-schema.js` — `{ "type": "object", "fields": { … } }`, plus `array` / `record` / scalar nodes; fully JSON-serialisable). When present and `parseMode = "json"`, the Executor validates the parsed model output against it in step 7, **after** the `jsonSchema.required` check and **before** step 8 persistence. Undeclared keys are dropped and types/lengths are bounded, so a prompt-injected model cannot smuggle an extra field through to an `akoya_request` writeback. A validation failure throws (logged as a `failed` run row). Prompts that omit `validationSchema` are unchanged — the field is purely additive. `raw` parseMode never reaches this check. `jsonSchema` (presence/required-key assertion) and `validationSchema` (post-parse shape enforcement) are independent and may both be declared.

**`rawOutputRetention` (output schema, added 2026-05-04):** controls what the Executor writes to `wmkf_ai_run.wmkf_ai_rawoutput` after parsing/persisting the model response. Default is `"full"` for backwards compatibility. A caller passing `auditRetention: 'content-free'` overrides this setting and forces `none` for that call.

| Mode | `wmkf_ai_rawoutput` content |
|---|---|
| `full` | Full provider response text, truncated only by the Dataverse Memo safety cap. |
| `hash` | Content-free metadata: `{retention:"hash", originalChars, sha256}`. Use when the model output is already persisted to a target field such as `akoya_request.wmkf_ai_summary`. |
| `none` | Content-free metadata: `{retention:"none", originalChars}`. Use when even hash correlation is unnecessary. |

`phase-i.summary` uses `"hash"` because the summary itself is already written to `akoya_request.wmkf_ai_summary`; the run row only needs correlation metadata. Thrown failures after a provider response retain the same policy inside a diagnostic envelope with stop reason, token budget, usage, and retained/hash-only output metadata.

---

## Caching contract

The shipped legacy Executor:

1. Sends `system` and `user` as separate blocks (requires the `wmkf_ai_systemprompt` + `wmkf_ai_promptbody` split — added by Connor in Phase 0, confirmed live 2026-04-24).
2. Interpolates each variable wherever its placeholder occurs in the stored system/body templates; it does not branch on `cacheable` or `placement` to move that value across the boundary.
3. Emits one `cache_control: {type: "ephemeral"}` on the completed system block.

Any change before that marker, including a variable interpolated into the system text, splits the
prefix. A repeat is cache-eligible only when the resulting prefix is byte-identical and meets
the active model's requirements; response usage is the proof of a realized hit.

**Within-prompt caching (Phase 0):** rerunning `phase-i.summary` on the same `requestId` with
the same PDF content may be cache-eligible when its composed prefix is unchanged; confirm a
realized hit through `usage.cache_read_input_tokens`.

**Synthetic cross-prompt prefix [BRANCH-BUILT]:** the profile composer places
the cache marker at the end of the first user text block, which holds the
protected document context. Frozen records and task-specific instructions
follow it. Compare composed prefixes with `prefixHash`. Measure realized
cache reuse through provider usage. See the [shared Executor job
design](plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md) for the planned
rollout.

---

## Logging contract

The legacy path attempts one `wmkf_ai_run` row with the fields below. A
Dataverse failure can prevent creation. A legacy failure with `runId=null`
can follow a provider response. In synthetic mode, `runId:null` is expected
because the worker owns deferred audit delivery.

| Field | Value |
|---|---|
| Lookup `wmkf_ai_prompt` (new in Phase 0) | Reference to the prompt row resolved in step 1 |
| `wmkf_ai_promptversion` | The resolved row's `wmkf_promptversion` |
| `wmkf_ai_promptoverridden` | `true` if `overrideVariables` was non-empty |
| `wmkf_ai_promptoverride` | JSON of the override inputs (for audit). Variables that opt into the payload boundary (`dataClass` + `maxChars`) are persisted as a redacted summary `[redacted: dataClass=…, originalChars=…, maxChars=…]` — the raw bounded text is never written to Dataverse. Non-bounded overrides are persisted verbatim. |
| `wmkf_ai_runsource` | Caller-supplied input |
| `wmkf_ai_tasktype` | Derived from the prompt row (future — after `tasktype` lands on `wmkf_ai_prompt`) |
| `wmkf_ai_status` | `Completed` / `Failed` / `Needs Review` (the last is also used for blocked runs — see *Notes for caller authors*) |
| `wmkf_ai_model` | The model ID actually used |
| `wmkf_ai_rawoutput` | Completed provider response according to `rawOutputRetention` (`full`, `hash`, or `none`), or a thrown-failure diagnostic envelope whose nested response output applies the same retention policy |
| `wmkf_ai_request` | Lookup to `akoya_request` (if applicable) |
| `wmkf_ai_notes` | Input/output token counts + cache hit counts + any error summary; includes `semanticAttempt`, for a linked caller retry `retryOf=<prior run GUID>`, and the content-free diagnostics `blocks=<type:chars,...>`, `thinkingTokens=<n>` (when reported), `thinkingBudget=below_floor(4096)` (thinking-default model under the advisory floor), and on a zero-text `max_tokens` stop `truncatedBeforeText=true` |
| `createdon` | Built-in Dataverse creation timestamp for the run row. Do not write vestigial `wmkf_ai_rundatetime`. |

---

## Notes for server-side caller authors

The following overwrite rules apply to shipped legacy calls.

### 1. `forceOverwrite` — set per *call site*, not per prompt

Each caller decides whether the user invoking it can clobber populated target fields. Suggested defaults:

| Caller | `forceOverwrite` default | Rationale |
|---|---|---|
| Interactive Vercel route (button click in UI) | `false` | User is in front of the screen — surface the conflict, let them confirm. Vercel route turns `blocked: true` into HTTP 409, UI shows existing content + "Overwrite?" button, user re-submits with `forceOverwrite: true`. |
| Vercel test harness | `true` | Test runs use clean fixtures or controlled overwrites. |

The proposed Power Automate job API uses server-owned operation and writeback
policies. Its contract is separate from the in-process `forceOverwrite` input.
See the [shared Executor job design](plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).

### 2. Output `guard` — set once on the prompt row

The `guard` policy lives on the `wmkf_ai_promptoutputschema` row, not per call site. It encodes a property of the *target field*, not a property of the caller. Examples:

- `wmkf_ai_summary` (human-curated narrative): `guard: "skip-if-populated"` — guard fires by default; `forceOverwrite` decides
- An audit-log JSON Memo that's always re-derived: `guard: "always-overwrite"` — Executor never preflights; `forceOverwrite` is a no-op for this output

A prompt row with `guard: "always-overwrite"` on every output ignores `forceOverwrite` entirely. This is correct: the caller should not be choosing whether to overwrite a field that *should always be overwritten by design*.

---

## Non-goals (what the Executor does NOT do)

- **Does not orchestrate chains.** The calling workflow decides which prompts run in what order. Executor runs exactly one prompt per invocation.
- **Does not branch on output.** Business-logic conditions ("if compliance failed, notify staff") live in the caller's Flow.
- **Does not semantically retry.** Caller decides retry policy. Executor returns a
  typed failure; the review-synthesis service is the current example that
  re-invokes once only for `claude_output_truncated`. Legacy transport-level
  429/529 retries remain inside `LLMClient`.
- **Does not handle arbitrary code.** Preprocessing, source kinds, and target kinds are closed enums.
  A new case requires a reviewed enum value and implementation in the shared Executor.
- **Does not write to SharePoint.** Phase 0 is Dynamics-only for persistence.
- **Does not manage prompt lifecycle.** Draft/publish/retire is a separate dashboard concern.
- **Does not stream.** Streaming Executor variant (`executePromptStream`) deferred; today's streaming routes stay outside the contract.

---

<a id="internal-synthetic-job-mode"></a>

## Internal profiled job mode

**[BRANCH-BUILT]** `executePrompt()` accepts the
`shared-document-task` execution mode from an internal worker. The prompt's
text-task variables JSON carries `contractVersion:1` and a profile reference
pinned by key, revision, and SHA-256. The typed fixture uses a separate v2
contract. The row has an empty system template and a task
body. It declares one required `prepared_context` and can declare
`frozen_record` slots. The profile composer verifies the snapshot's scope
and integrity, wraps documents and records as untrusted data, and enforces
bounded sizes and required fields. Extracted document text is capped at
256 KiB of UTF-8 per document and in aggregate. The canonical snapshot is
capped at 4 MiB, including escaping, the protected block, and record content. Record values are authoritative for
declared fields and missing values stay explicit. The reviewed model must
be a concrete Anthropic model. The worker supplies the frozen inputs,
including the model, token budget, and temperature. Text tasks cap frozen and
effective output budgets at 1,536 tokens, subject to the reviewed model ceiling.
The test-only recommendations capability caps both budgets at 4,096.
The Executor reads these inputs directly and resolves capabilities from the
reviewed local registry. Live model-list, prompt, Request, and SharePoint reads are absent
from this path.

| Task key | Parsed output key | Maximum | Job destination |
|---|---|---|---|
| `synthetic.executive-summary` | `summary` | 200 words | `fixture_summary` |
| `synthetic.methodology` | `methodology` | 12,000 characters | `fixture_methodology` |
| `proposal.executive-summary` | `summary` | 200 words | Retained draft |
| `proposal.methodology` | `methodology` | 12,000 characters | Retained draft |

The two synthetic keys run only under `environment:'test'`. The two proposal
keys require the bounded staff trial scope below. Each Executor output declares
`target.kind:'none'`. The fixture destination keys identify synthetic writer slots
for initialization. The worker owns authorization, freshness, audit, and any
separately authorized fixture writer.

### Worker-only inputs and ordering

Every invocation requires `promptSnapshot`, a matching `requestId`, and
`profiledContext: { profile, snapshot, scope, nonceSecret }` together with
`requireNoPersistence:true`, `auditMode:'deferred'`, and
`auditRetention:'content-free'`. The legacy override and overwrite controls
are disabled in this mode. The normal path refuses profiled rows without the
worker context. These arguments are internal server data.

1. For a new attempt, supply both `onDispatch()` and `onResponse(checkpoint)`.
   The Executor awaits the dispatch callback before calling the provider.
   The worker records a lease-fenced dispatch intent in the ledger. The
   Anthropic client makes at most one request per attempt. It sets
   `maxRetries:0` and `allowParameterRepair:false` and omits a fallback model.
2. The Executor awaits the response callback before parsing or generating
   audit data. The store commits the bounded response content and
   `response_saved` state in one PostgreSQL transaction. The retained
   checkpoint may contain model text and stays in bounded internal storage.
   The canonical checkpoint must fit 256 KiB. An oversized response saves
   a content-free marker and available usage, then fails validation. On
   recovery, pass the saved `responseCheckpoint`. The Executor checks its binding to the
   frozen prompt, snapshot integrity, Request, and effective token budget and
   resumes validation without another provider call.
3. The shared parser checks termination and output shape. The profiled mode
   also enforces the registered result contract and a 128 KiB canonical result
   limit, including the typed result wrapper where applicable. It returns
   `runId:null`, skipped write results, and a content-free `deferredAudit`
   on success. A classified validation failure carries deferred audit
   metadata too. The Executor performs no inline audit or target write.
4. The worker journals the validated result and deferred audit, and fences
   audit delivery and any conditional fixture publication separately.
   Explicit dispatch authorization or freshness denial records
   `failed_pre_dispatch` with `dispatch_denied` before a provider attempt.
   If the deadline expires during that late check, the tick returns
   `waiting` without creating an attempt. A definitive Anthropic 400, 401,
   429, or 529 rejection records `provider_rejected` in the PostgreSQL
   attempt, reusing `failed_pre_dispatch` even though the provider responded.
   This terminal state releases eligible slots. It keeps audit state `none`,
   so the rejection has no Dataverse AI-run row. `paidCall:true` marks a
   received response or rejection. Billing is a separate provider fact.
   Ambiguous outcomes become `unknown` and hold their fences. A saved response
   can resume validation. An unknown provider, audit, or destination outcome
   stops automatic replay of that operation.

See [Service & Utility Catalog](SERVICE_AND_UTILITY_CATALOG.md) for the profile,
context, task capabilities, worker, and store entries.

### Typed recommendations fixture

**[BRANCH-BUILT, offline only]** `expertise.recommendations` runs as a single
`generate-draft` task in `environment:'test'` with an authorization scope
of `expertise-fixture:<lowercase GUID>`. The capability rejects initialization
and has no destination. It is excluded from Admin authoring and rejected by
Admin preview and publication. The existing text-task catalog, v1 seal, v1
checkpoint binding and text result shape continue to apply to text tasks.

The task pins `contractVersion:2`, compiler version 1 and the code-owned
`expertise-recommendations-v1` result contract. Admission freezes the roster
fingerprint. The v2 sealed snapshot carries private roster context for
validation. The composer rebuilds the visible `roster_block` from that
context and verifies exact equality before rendering it once as wrapped
data after the document cache marker. The private extension stays out
of the provider payload. The v2 checkpoint binds the capability, result
contract, compiler, effective budget, Request, frozen prompt and snapshot
integrity. Recovery validates the saved response without a provider call.

The Executor checks the model JSON against the closed roster contract
before projection and derives canonical recommendation fields from the
frozen roster. The worker retains a result envelope with the contract
version and validated object. The store verifies scope, expiry, kind,
hash, encoded byte length and envelope when it reads the retained object.
`readValidatedRecommendations` is an internal fixture reader. Existing
staff result endpoints continue to return text only. A real source adapter,
staff result facade with read-time freshness, and PA admission remain
planned. [Shared task interfaces](plans/SHARED_EXECUTOR_TASK_INTERFACES_2026-11-11.md).

### Staff proposal draft trial

**[BRANCH-BUILT, default off]** One configured Request, one current Superuser,
and one trial UUID bind the proposal capabilities. The Workbench uses the
authenticated `reviewers` app session and trusted DAL context. POST
`/api/workbench/prompt-jobs` takes only `requestId` and a UUID
`Idempotency-Key` header. The service selects both proposal tasks and the
source policy. A transaction fence permits one job per trial UUID in the
shared ledger, including across principals/environments. Each task can
dispatch once, with a 1,536-token cap and no automatic retry or rerun. Exact
replay returns the existing job after reauthorization. Status excludes
source and model text. A separate, reauthorized results GET returns only
available validated draft outputs. Both reads use private, no-store responses.

The service pins the two published task/profile versions and the approved
manifest shape. The candidate source is one exact accepted Proposal Narrative
PDF in a unique active Request AI Materials folder plus the directly stored
Project Leader contact name. The manifest retains identifiers and hashes.
The worker verifies the complete source and PI identity, downloads at most
20 MiB, checks both accepted filename aliases and PI again, and freezes
`proposal` and `pi_name` in one snapshot. It rechecks authorization and
source freshness before dispatch. The adapter refuses missing, ambiguous,
changed, or oversized inputs. Known source-admission failures return safe
409 codes. An expired source window ends preparation before download.

The unscheduled `/api/cron/drain-prompt-jobs` endpoint requires the cron bearer
in every environment and advances one server-selected stage. The worker
delivers content-free AI-run audit using required current-actor impersonation
with fallback disabled. There is no Request-field write, fixture slot, or
publication command for these proposal tasks. Source and response content
expires after 24 hours. Configuration and validated results expire after
seven days. The drain deletes expired content in the exact configured scope
before rechecking the actor and preserves receipts. See the
[staff trial plan](plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md) and
[configuration contract](CREDENTIALS_RUNBOOK.md#optional--shared-executor-staff-draft-trial).

[VERIFIED via owner-authorized read-only source preparation] The owner-uploaded
`ProposalNarrative_1003384.pdf` is the unique accepted alias in Request 1003384's
active AI Materials folder. Preparation passed the candidate profile's limits
and the source remained current. The PI name comes from the populated
Dataverse Project Leader record. The owner separately approved the live
service-level trial. Preflight verified the actor, and the canonical
migration runner applied only 097. The Admin services published one profile
revision and both v1 task rows. The local trial used process-scoped
configuration. Its second invocation reused the cached document prefix.
The summary passed format validation and needs attribution review. The
Methodology reached the output cap and was rejected. Both AI-run audits
were delivered. A separately approved v2 cohort reused profile revision 1 and published both v2 tasks. The v2 summary passed validation and needs staff review for grounding caveats. The v2 Methodology finished but failed its word cap and had substantive grounding errors. Both v2 audits were delivered. The Workbench, Admin and cron HTTP endpoints remain undeployed. See the [staff trial receipts](plans/SHARED_EXECUTOR_STAFF_TRIAL_2026-11-11.md#second-controlled-trial).

### Admin authoring and sample preview

**[BRANCH-BUILT]** Admin → Prompt Templates → Shared document tasks writes
configuration for the two synthetic and two proposal tasks. `GET /api/admin/prompt-profiles`
reads the profile revision catalog. `PUT` appends a revision under
`executor.profiles.<key>.vNNNNNN` in `wmkf_appsystemsettings`, guarded by
the expected revision and exact UUID/payload readback. `POST` composes a
sample with fabricated document and record values. It performs no inference
or persistence write. Every method uses the superuser guard and trusted DAL
context.

Task creation and update use the existing versioned prompt publication
routes. The publisher validates the marked metadata and resolves the
published profile's exact key, revision, and hash before mutation. It
requires a UUID, and updates also require the expected prompt version.
Legacy names cannot switch modes, and registered task names require their
shared-document marker. The editor ties the preview to the draft payload
and drops it on edit. A partial task publication, or a failed or conflicting
publication with a new row ID, blocks further publication while the editor
reloads and checks the current version. A lost profile-publication response
retains its original revision payload and UUID for replay, including after
refreshing profile history. The worker reads the configuration frozen into
its job. Later settings revisions do not change that configuration.

## Test oracle

`scripts/test-echo-parity.js` is a Vercel smoke script for the
`executor.echo-parity` prompt. It invokes the provider twice and checks echoed
content, persisted raw output, and cache usage. The focused local synthetic
tests passed with fixture inputs and doubles for the provider and external
adapters. They exercise actual request composition and Executor/worker
ordering. Integrated staff-route, database and build verification passed
locally. The [staff workflow receipt](audits/SHARED_EXECUTOR_STAFF_OPUS55_REVIEW_2026-11-11.md#integrated-verification)
records the command scope and live-evidence limits.

```sh
npx jest tests/unit/execute-prompt-profile.test.js tests/unit/prompt-jobs-profile.test.js tests/unit/prompt-jobs-context.test.js tests/unit/execute-prompt-payload-boundary.test.js tests/unit/execute-prompt-audit-retention.test.js tests/unit/execute-prompt-multi-output.test.js --runInBand --silent
npx jest tests/unit/prompt-jobs-worker.test.js --runInBand
```

---

## Phase 0 concrete scope (originally targeted May 1 2026 — SHIPPED)

**Built for the May 1 milestone (Vercel-only) — all SHIPPED:**
- `executePrompt()` service function implementing steps 1–10 — `lib/services/execute-prompt.js`
- Variable source resolvers: `dynamics`, `sharepoint`, `override`
- Preprocessor: `pdf_to_text` (via existing `lib/utils/file-loader.js`)
- Target writer: `akoya_request` (including JSON-path set for `wmkf_ai_dataextract`)
- Output guards: `skip-if-populated` (default for `akoya_request` field-targets) and `always-overwrite`
- `forceOverwrite` input on the Executor; `parseMode: "raw"` and `parseMode: "json"` on output schemas
- Reference route: `pages/api/phase-i-dynamics/summarize-v2.js` — calls into `executePrompt()`
- First prompt row: `phase-i.summary` (system/body split, single raw-text output to `wmkf_ai_summary`, `guard: "skip-if-populated"`)

**Still deferred (post-May 1 status — re-verify before consuming):**
- Authenticated Power Automate submit/status, Entra machine authorization, and real Request-field destinations. See the [shared Executor job design](plans/SHARED_EXECUTOR_JOB_ARCHITECTURE_2026-11-10.md).
- `prior_output` source kind
- `overridePromptBody` input
- Streaming Executor variant
- Interactive test-run gate (manual review is still required). The Admin prompt
  publisher now performs template, output-schema, reviewed-model, native-output
  capability, and max-token validation before mutation; it does not run the
  model as part of publication.

**Caching note:** the current Executor marks the composed system block. Proposal text in the user message follows that marker, so the current Phase I summary path cannot reuse it as a cached document prefix across tasks.
