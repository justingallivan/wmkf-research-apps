---
title: Executor Contract
domain: prompt-executor
kind: source-of-truth
status: canonical
summary: "The Executor is the function invoker. The prompt row is the function definition. Chains and triggers are the Flow's job, not the Executor's."
canonical: true
cataloged: 2026-07-02
last_verified: 2026-08-30
owner: product-engineering
related:
  - lib/services/execute-prompt.js
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/BACKEND_AUTOMATION_PLAN.md
  - docs/WORKFLOW_CHAINING_DESIGN.md
---

# Executor Contract

**Status:** SHIPPED on the Vercel side — this doc describes the contract that
`lib/services/execute-prompt.js` implements in production today (used by the Phase I summary route
and multiple live grantee, field-primer, and review services). A Power Automate implementation is a deferred target, not a
second current implementation. The original "May 1 2026 cycle target" framing is historical.
**Created:** 2026-04-24 (Session 109, reconciliation pass)
**Last status update:** 2026-08-30 (durable budget recovery, provenance, and concurrent-draft handling)
**Owners:** Justin (Vercel implementation — shipped); Connor would own any future Power Automate implementation
**Related docs:** `docs/PROMPT_STORAGE_DESIGN.md`, `docs/BACKEND_AUTOMATION_PLAN.md`, `docs/WORKFLOW_CHAINING_DESIGN.md`, `docs/GRANT_CYCLE_LIFECYCLE.md`

---

## Purpose

The Executor is the contract implemented by the Vercel `executePrompt()` service function and
reserved for a future Power Automate `ExecutePrompt` child flow. Today, only the Vercel
implementation exists. A future PA implementation must perform the same ten steps with the same
inputs and outputs so that:

- A prompt row authored once in `wmkf_ai_prompt` can serve both caller types without duplication.
- Cache prefixes can be made byte-identical if/when a second runtime exists.
- `wmkf_ai_run` rows from either runtime will remain structurally coherent.
- Adding a shared prompt does not require maintaining divergent prompt bodies in two runtimes.

The Executor is the **function invoker**. The prompt row is the **function definition**. Chains and triggers are the **Flow's** job, not the Executor's.

## Scope of generality

The contract covers **Pattern A + dual-caller prompts and Pattern B/C Vercel-only prompts** — one Executor, no branching. Specifically:

**In scope:**
- Single-shot Claude prompts (system + user, no multi-turn)
- Backend-triggered (PA, on Dynamics status change) and user-triggered (Vercel button) callers
- Summarization, classification, multi-output extraction
- Prompts that mix Dynamics-sourced inputs, SharePoint file inputs, and caller-supplied overrides
- Sequential chains (output → input via shared Dynamics fields) and parallel-consumer chains (shared context block)

**Out of scope (separate code paths):**
- Tool-use / agent loops (Dynamics Explorer)
- Streaming SSE to the UI (token-by-token display — today's Phase II pattern stays outside)
- Non-Claude models
- Anthropic Batch API (`wmkf_batch_run`, retrospective work)
- Multi-turn stateful conversations

---

## Signature

### Inputs

| Name | Type | Required | Purpose |
|---|---|---|---|
| `promptName` | string | yes | Matches `wmkf_ai_prompt.wmkf_ai_promptname`. Executor picks the current published version (`wmkf_ai_iscurrent = true`). |
| `requestId` | GUID | conditional | `akoya_request` row GUID. Required for prompts that declare any `dynamics:akoya_request.*` or `sharepoint` source variables. Optional for all-`override` prompts (Pattern B/C). |
| `overrideVariables` | object | no | Per-invocation variable overrides. Keys must match names declared in `wmkf_ai_promptvariables`. Used for user-session overrides (Vercel) and test harness runs. |
| `runSource` | enum | yes | One of the `wmkf_ai_runsource` picklist values (e.g., `PowerAutomate Auto`, `Vercel Interactive`, `Vercel User`, `Vercel Test`). Caller supplies. |
| `forceOverwrite` | bool | no | Default `false`. When `true`, output guards (see *Output guards*) are bypassed and the Executor writes regardless of whether targets are populated. Caller's choice — not a Dynamics-row setting. |
| `actingUserSystemId` | GUID | no | Dataverse system-user identity used to attribute supported writes. Callers must derive it from authenticated/server context, never request input. |
| `assertSystemIncludes` | string \| string[] | no | Fail-closed assertion that each required substring survived composition in the actual system prompt. Used when a mutable prompt row must retain a security-critical block. |
| `requireNoPersistence` | bool | no | Default `false`. When `true`, the Executor rejects any current prompt row whose output schema declares a target other than `kind: none`, before the model call or target write. Use for producers that need request-linked audit lineage but must remain pass-through-only even if the mutable prompt row drifts. |
| `maxTokensOverride` | positive integer | no | Server-owned, per-invocation output-budget override, capped at the final resolved model's reviewed `maxOutputTokens`. The Pre-Site standing value and review-synthesis retry floor/ceiling resolve through `lib/services/executor-budget-service.js` from the latest append-only `executor.budgets.vNNNNNN` Dataverse setting; `shared/config/executorBudgets.js` owns only the closed schema, safety bounds, and outage fallback. The superuser Admin panel reads the same resolved revision. Never accept this value from client input. |
| `timeoutMsOverride` | positive integer | no | Server-owned, per-invocation LLM transport timeout override (milliseconds), passed to `LLMClient` in place of its 120s default. The Pre-Site value resolves through the same durable budget revision and remains bounded to the reviewed 60 000–240 000 ms range; never accept it from client input. Non-integer/non-positive values are ignored. |
| `minimumEffectiveMaxTokensExclusive` | non-negative integer | no | Server-owned retry guard. After applying the resolved model ceiling, the final token budget must exceed this value or the Executor aborts before the provider call. Review synthesis uses the first attempt's budget here so a concurrent model change cannot trigger a retry with no larger effective budget. |
| `semanticAttempt` | positive integer | no | Default `1`. Server-owned audit metadata for caller-level semantic retries. |
| `retryOfRunId` | GUID | no | Prior failed `wmkf_ai_run` id when the caller re-invokes. Included in notes for deterministic audit pairing; null is allowed when the prior audit write failed. |

### Durable Executor-budget publication

**[SOURCE-VERIFIED 2026-08-29; production publication not yet claimed.]**
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
- `review-synthesis.generate`: retry `floor` and `ceiling`.

Publication validates code-owned numeric ranges and both prompts' currently
resolved reviewed-model output ceilings before the create. Admin and seed
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

**Deferred (Phase 1+):** `overridePromptBody: { system?: string, body?: string }` — body-level override for per-session prompt editing (PROMPT_STORAGE_DESIGN §17). Not needed for May 1.

### Outputs

| Name | Type | Purpose |
|---|---|---|
| `parsed` | object \| null | Output object matching `wmkf_ai_promptoutputschema`. `null` when `blocked = true`. Downstream chain steps consume this. |
| `runId` | GUID \| null | `wmkf_ai_run.wmkf_ai_runid` when audit-row creation succeeds. A thrown failure can carry `runId = null` if writing the failure row also fails. |
| `cacheHit` | bool | Derived from Claude response's `usage.cache_read_input_tokens > 0`. For observability. |
| `blocked` | bool | `true` when at least one guarded target was already populated and `forceOverwrite` was false. Claude was not called; no targets written. |
| `conflicts` | array | When `blocked`, one entry per guarded target that triggered the block: `{ output, table, field, existingContent, existingLength, modifiedOn }`. Caller (typically Vercel) uses this to render a confirm-overwrite UI. |
| `writeResults` | object \| null | When not blocked: `{ allOk, results: [{ output, ok, field?, jsonPath?, reason?, error? }] }`. `null` when blocked. |
| `usage` | object \| absent | Verbatim Anthropic `usage` object (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). The key is omitted from the blocked return. |
| `meta` | object \| absent | `{ promptName, promptVersion, promptId, modelUsed, systemChars, bodyChars, aiPayloadBoundaries, rawOutputRetention, semanticAttempt, retryOfRunId }`. The key is omitted from the blocked return. Useful for observability/UI display and caller-level retry linkage. |

### Errors

The Vercel Executor throws on prompt-not-found, variable-resolution, composed
system assertion, Claude API, output-parse/validation, and other contract-level
failures. Individual target persistence failures are returned in
`writeResults` with `allOk=false`; the run is logged as `Needs Review` and the
parsed result is still returned so the caller can handle partial persistence
explicitly.

The normalized provider response must end with `stopReason="end_turn"` before
raw or JSON output can reach persistence. `max_tokens`,
`model_context_window_exceeded`, `refusal`, missing, and unreviewed stop reasons
fail closed even if the returned text happens to be syntactically valid JSON.
Typed output errors include `code`, `stopReason`, and `maxTokens`; the current
codes are `claude_output_truncated`, `claude_context_window_exceeded`,
`claude_output_refused`, `claude_output_incomplete`, and
`claude_output_invalid_json`.

**Audit attempt invariant:** the Executor attempts a `wmkf_ai_run` row for
blocked, completed/needs-review, and thrown-failure outcomes. Audit persistence
can itself fail; that secondary failure is logged server-side and a thrown error
then carries `runId = null`. Do not describe the audit trail as mathematically
complete when Dataverse logging is unavailable.

---

## The 10 steps

| # | Step | Future PA action (target contract) | Current Vercel implementation |
|---|---|---|---|
| 1 | Resolve prompt | HTTP GET `wmkf_ai_prompts?$filter=wmkf_ai_promptname eq '<name>' and wmkf_ai_iscurrent eq true&$top=1` | `execute-prompt.js` queries `wmkf_ai_prompts` directly via Dataverse (NOT via `PromptResolver` — that's the legacy `wmkf_ai_runs` scratch-row path, used now only by audit scripts) |
| 2 | Parse variable declarations | Parse JSON on `wmkf_ai_promptvariables` | `JSON.parse(row.wmkf_ai_promptvariables)` |
| 3 | Resolve variable values | Apply-to-each + Switch on `source.kind` | Loop + switch; source kinds handled by dedicated resolvers |
| 4 | **Preflight output guards** | For each output with `guard != "always-overwrite"`, GET target field. If populated AND `forceOverwrite = false` → write `wmkf_ai_run` with status `Needs Review`, return `{ blocked: true, conflicts, runId }`. Capture `@odata.etag` per target for step 8's `If-Match`. | Same. Skip steps 5–8 on block. |
| 5 | Compose Claude payload | Compose action: system + user blocks; `cache_control: {type:"ephemeral"}` at declared prefix boundary | `buildClaudeRequest(prompt, variables)` |
| 6 | Call Claude | HTTP action → Anthropic API | `callClaude()` → `LLMClient.complete()` (2026-06-11; canonical transport — `safeFetch` SSRF allowlist, abortable timeout, 429/529 retry, API-key redaction). The `cache_control` system array passes through verbatim. The Executor preserves normalized joined `text`, `stopReason`, `stopDetails`, refusal state, model, usage, and the applied token budget. A prompt with `generationMode:"native-json-schema"` passes `jsonSchema` as Anthropic `output_config.format` only when the concrete model is explicitly reviewed for structured output. No `appName` is passed — avoids double-counting `api_usage_log` against the driver route's own `logUsage`. |
| 7 | Validate termination + parse output | Require a clean terminal response, then parse the complete joined text using `wmkf_ai_promptoutputschema.jsonSchema` (or treat as raw text when `parseMode = "raw"`) | Requires `stopReason="end_turn"` before parsing/persistence. Joins every text content block. Applies required-key checks and then the optional local `validationSchema`. |
| 8 | Persist outputs | Coalesce all `akoya_request` outputs into **one** PATCH with `If-Match: <etag>` from step 4. Direct field writes (no `jsonPath`) merge into the payload as `{ field: value }`. `jsonPath` outputs grouped by field: GET the current memo, apply each `$.path` write in declaration order (later writes win on key collisions), serialize back, add the merged JSON to the same payload. Two direct outputs writing the same field (no `jsonPath`) throws at preflight as a schema error. Success or failure is uniform across all contributors: a 412 marks every eligible output as `concurrent_edit`. Persistence errors become structured `writeResults`, not necessarily thrown errors. | Same coalesced PATCH and structured result |
| 9 | Log Execution | Attempt to create `wmkf_ai_run`: Lookup to prompt row, `wmkf_ai_promptversion`, `wmkf_ai_runsource`, `wmkf_ai_status`, `wmkf_ai_model`, `wmkf_ai_rawoutput` according to `rawOutputRetention`, token/cache counts in `wmkf_ai_notes`, `wmkf_ai_request` Lookup | Same; logging failure is fail-visible and can leave `runId=null` on a thrown path |
| 10 | Return | Return parsed output, audit id, cache/guard state, structured write results, usage, and metadata | `return { parsed, runId, cacheHit, blocked, conflicts, writeResults, usage, meta }` |

---

## Metadata shapes

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

**Source kinds (Phase 1+):**

| Kind | Meaning | Phase |
|---|---|---|
| `prior_output` | Value from a field a prior Execution wrote (implicit chaining via Dynamics) | Phase 1 |
| `context_block` | Recursively assemble another prompt row tagged as `Context` | Phase 2 |

**Preprocess hints (Phase 0):** `pdf_to_text` only — the live `execute-prompt.js` throws on any other hint. `docx_to_text`, `truncate_tokens:N`, `strip_images` are deferred until needed. If a PA implementation is added, every supported hint must be implemented and tested in both runtimes.

**Placement attribute (Phase 0 — present but single-valued):** v0 only supports `placement: "user"`. Phase 2 adds `placement: "system"` for context-block variables that need to be part of the cacheable system-array prefix.

**`cacheable` flag:** Phase 0 stores this declaration but does not use it to place variables
relative to the cache boundary. `composeMessages()` interpolates variables wherever their
placeholders occur in the stored system/body templates, and `callClaude()` marks the completed
system block. An identical rerun can be cache-eligible when its composed prefix is unchanged
(including stable nonces for opted-in untrusted variables), but a cache hit must be verified
from response usage rather than assumed. Cross-prompt alignment still requires Phase-2 context
blocks.

**Data classification + payload boundary (added 2026-05-04):** A variable can declare two additional optional fields to opt into the shared AI payload-boundary helper:

| Field | Type | Meaning |
|---|---|---|
| `dataClass` | string | Classification tag from `DATA_CLASSES` in `lib/utils/ai-payload-boundary.js` (e.g. `proposal_text`, `grant_report_text`, `crm_record_text`, `review_text`, `staff_provided_context`). |
| `maxChars` | integer | Hard cap on transmitted character count for this variable. |

**Both fields must be present for enforcement to fire** — declaring only one is treated as no declaration (backwards compatible). When both are present, the Executor applies `buildBoundedTextPayload` to the resolved value before composing the prompt:

- The bounded value is what reaches the prompt body / system block.
- Source string is `executor.<promptName>.<variableName>` (e.g. `executor.phase-i.summary.proposal_text`), so audit logs and tests can distinguish Executor-driven boundaries from route-driven ones.
- Boundary metadata (`source`, `dataClass`, `maxChars`, `originalChars`, `transmittedChars`, `truncated`, `truncationMarker`) is returned on `result.meta.aiPayloadBoundaries` (array, one entry per bounded variable). The `wmkf_ai_run` notes string also captures a compact form of the metadata (no content) so unattended PA-triggered runs keep an audit trail.
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

Each output may declare a `guard` policy that the Executor applies in step 4 (preflight) before any Claude call. Default is `"skip-if-populated"` for any `akoya_request` field-target.

| Guard | Behavior |
|---|---|
| `skip-if-populated` | Read target field. If populated (string-trim length > 0; for JSON-path targets, the path must resolve and be non-null/non-empty) AND `forceOverwrite = false` → block. |
| `always-overwrite` | Skip the preflight read. Always proceed to Claude. Use for fields that are deliberately re-derived every run (audit logs, computed scores, status flags). |

**Phase 1+ deferred guards:** `append` (concatenate to existing value with separator), `version-on-conflict` (write to `field_v2` etc.), `error-on-conflict` (fail with 409 instead of returning `blocked`).

**`parseMode` (output schema, Phase 0):** `"json"` (default — Claude must return parseable JSON matching `jsonSchema`) or `"raw"` (the complete joined text becomes the value of the single declared output; `jsonSchema` ignored). Multi-output prompts must use `"json"`.

**`validationSchema` (output schema, added 2026-05-22 — A7 step 3):** an optional declarative schema, in the `validateAiJson` node format (`lib/utils/ai-output-schema.js` — `{ "type": "object", "fields": { … } }`, plus `array` / `record` / scalar nodes; fully JSON-serialisable). When present and `parseMode = "json"`, the Executor validates the parsed model output against it in step 7, **after** the `jsonSchema.required` check and **before** step 8 persistence. Undeclared keys are dropped and types/lengths are bounded, so a prompt-injected model cannot smuggle an extra field through to an `akoya_request` writeback. A validation failure throws (logged as a `failed` run row). Prompts that omit `validationSchema` are unchanged — the field is purely additive. `raw` parseMode never reaches this check. `jsonSchema` (presence/required-key assertion) and `validationSchema` (post-parse shape enforcement) are independent and may both be declared.

**`rawOutputRetention` (output schema, added 2026-05-04):** controls what the Executor writes to `wmkf_ai_run.wmkf_ai_rawoutput` after parsing/persisting the model response. Default is `"full"` for backwards compatibility.

| Mode | `wmkf_ai_rawoutput` content |
|---|---|
| `full` | Full Claude response text, truncated only by the Dataverse Memo safety cap. |
| `hash` | Content-free metadata: `{retention:"hash", originalChars, sha256}`. Use when the model output is already persisted to a target field such as `akoya_request.wmkf_ai_summary`. |
| `none` | Content-free metadata: `{retention:"none", originalChars}`. Use when even hash correlation is unnecessary. |

`phase-i.summary` uses `"hash"` because the summary itself is already written to `akoya_request.wmkf_ai_summary`; the run row only needs correlation metadata. Thrown failures after a provider response retain the same policy inside a diagnostic envelope with stop reason, token budget, usage, and retained/hash-only output metadata.

---

## Caching contract

**Byte-identical prefixes are the target contract for any future second runtime.** Today there is no
PA prefix to compare. If PA is implemented and it produces different bytes before the first
`cache_control` marker, the two callers will land in different cache buckets.

The current Phase-0 Executor:

1. Sends `system` and `user` as separate blocks (requires the `wmkf_ai_systemprompt` + `wmkf_ai_promptbody` split — added by Connor in Phase 0, confirmed live 2026-04-24).
2. Interpolates each variable wherever its placeholder occurs in the stored system/body templates; it does not branch on `cacheable` or `placement` to move that value across the boundary.
3. Emits one `cache_control: {type: "ephemeral"}` on the completed system block.

Any change before that marker, including a variable interpolated into the system text, splits the
prefix. A repeat is cache-eligible only when the resulting prefix is byte-identical and meets
the active model's requirements; response usage is the proof of a realized hit.

**Within-prompt caching (Phase 0):** rerunning `phase-i.summary` on the same `requestId` with
the same PDF content may be cache-eligible when its composed prefix is unchanged; confirm a
realized hit through `usage.cache_read_input_tokens`.

**Cross-prompt caching (Phase 2 target, not built):** the planned shape has `phase-i.summary` and
`phase-i.compliance` reference a shared `context_block` placed in `system`, allowing a back-to-back
invocation to reuse the document prefix. `context_block` remains deferred.

---

## Logging contract

Every execution path attempts one `wmkf_ai_run` row with, at minimum, the
following fields. A Dataverse failure can prevent that row from being created;
callers and operators must treat `runId=null` as an audit failure, not as proof
that no execution occurred.

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
| `wmkf_ai_rawoutput` | Completed Claude response according to `rawOutputRetention` (`full`, `hash`, or `none`), or a thrown-failure diagnostic envelope whose nested response output applies the same retention policy |
| `wmkf_ai_request` | Lookup to `akoya_request` (if applicable) |
| `wmkf_ai_notes` | Input/output token counts + cache hit counts + any error summary; includes `semanticAttempt` and, for a linked caller retry, `retryOf=<prior run GUID>` |
| `createdon` | Built-in Dataverse creation timestamp for the run row. Do not write vestigial `wmkf_ai_rundatetime`. |

---

## Notes for caller authors (Vercel route + PA parent flow)

The Executor is intentionally minimal. Two decisions belong to the caller, not the prompt row:

### 1. `forceOverwrite` — set per *call site*, not per prompt

Each caller decides whether the user invoking it can clobber populated target fields. Suggested defaults:

| Caller | `forceOverwrite` default | Rationale |
|---|---|---|
| Interactive Vercel route (button click in UI) | `false` | User is in front of the screen — surface the conflict, let them confirm. Vercel route turns `blocked: true` into HTTP 409, UI shows existing content + "Overwrite?" button, user re-submits with `forceOverwrite: true`. |
| PowerAutomate auto-trigger (status-change-driven) | depends on the trigger | If the trigger fires only on the *first* transition into the target stage, `forceOverwrite: false` is the safer default — it prevents re-runs on backsliding statuses from clobbering curated content. If the parent flow is explicitly a *re-summarize all rows* batch (e.g., model bump, prompt-template change), set `forceOverwrite: true`. |
| Vercel test harness | `true` | Test runs use clean fixtures or controlled overwrites. |
| PowerAutomate manual-button flow ("Re-run summary on this row") | `true` | The user clicked a button literally meaning "redo this." |

**For any future PA flows (Phase 1):** every parent flow that calls `ExecutePrompt` must explicitly
pass `forceOverwrite`. Do not default it at the child-flow level: a bulk re-summarization flow and a
first-pass intake flow have opposite correct defaults.

### 2. Output `guard` — set once on the prompt row

The `guard` policy lives on the `wmkf_ai_promptoutputschema` row, not per call site. It encodes a property of the *target field*, not a property of the caller. Examples:

- `wmkf_ai_summary` (human-curated narrative): `guard: "skip-if-populated"` — guard fires by default; `forceOverwrite` decides
- An audit-log JSON Memo that's always re-derived: `guard: "always-overwrite"` — Executor never preflights; `forceOverwrite` is a no-op for this output

A prompt row with `guard: "always-overwrite"` on every output ignores `forceOverwrite` entirely. This is correct: the caller should not be choosing whether to overwrite a field that *should always be overwritten by design*.

---

## Non-goals (what the Executor does NOT do)

- **Does not orchestrate chains.** The caller (parent PA flow or Vercel API route) decides which prompts run in what order. Executor runs exactly one prompt per invocation.
- **Does not branch on output.** Business-logic conditions ("if compliance failed, notify staff") live in the caller's Flow.
- **Does not semantically retry.** Caller decides retry policy. Executor returns a
  typed failure; the review-synthesis service is the current example that
  re-invokes once only for `claude_output_truncated`. Transport-level 429/529
  retries remain inside `LLMClient` and are not semantic prompt attempts.
- **Does not handle arbitrary code.** Preprocessing, source kinds, and target kinds are closed enums.
  A new case requires a new enum value in the live Executor and, if PA is later implemented, its
  conformance implementation — not an "exec arbitrary script" escape hatch.
- **Does not write to SharePoint.** Phase 0 is Dynamics-only for persistence.
- **Does not manage prompt lifecycle.** Draft/publish/retire is a separate dashboard concern.
- **Does not stream.** Streaming Executor variant (`executePromptStream`) deferred; today's streaming routes stay outside the contract.

---

## Test oracle

A small test prompt `test.echo`:
- Declares two variables — one `dynamics`, one `override`
- Output schema: `{ echo: string }` with target `kind: none`
- System prompt: `"Echo the inputs verbatim as JSON."`

The Vercel implementation uses this as a characterization fixture. If a PA implementation is added,
evaluate both runtimes for:
1. Identical composed request bytes and structurally equivalent `wmkf_ai_run` output for identical
   `requestId` and `overrideVariables`.
2. Cache eligibility and actual `cacheHit` behavior under the active model, using response usage
   rather than treating a second invocation as proof.

If either assertion fails, the two implementations have drifted and must be reconciled before building more prompts on top.

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
- PowerAutomate `ExecutePrompt` child flow — Connor-owned, pacing tracked outside this doc
- Context blocks + `context_block` source kind + `placement: system`
- `prior_output` source kind
- `overridePromptBody` input
- Streaming Executor variant
- Interactive test-run gate (manual review is still required). The Admin prompt
  publisher now performs template, output-schema, reviewed-model, native-output
  capability, and max-token validation before mutation; it does not run the
  model as part of publication.

**Caching note:** within-prompt cache hits only. Running summary then compliance on the same request does NOT share cache on the document block — both calls pay full price. Worth revisiting when proposal-context-extraction (`docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`) ships.
