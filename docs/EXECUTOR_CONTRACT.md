# Executor Contract

**Status:** SHIPPED on the Vercel side — this doc describes the contract that `lib/services/execute-prompt.js` implements in production today (consumed by `/api/phase-i-dynamics/summarize-v2`). PowerAutomate implementation is Connor's; pacing tracked outside this doc. The original "May 1 2026 cycle target" framing is historical; that target has passed.
**Created:** 2026-04-24 (Session 109, reconciliation pass)
**Last status update:** 2026-05-25 (S188, B6-F2 readiness-audit drift refresh)
**Owners:** Justin (Vercel implementation — shipped), Connor (PowerAutomate implementation)
**Related docs:** `docs/PROMPT_STORAGE_DESIGN.md`, `docs/BACKEND_AUTOMATION_PLAN.md`, `docs/WORKFLOW_CHAINING_DESIGN.md`, `docs/GRANT_CYCLE_LIFECYCLE.md`

---

## Purpose

The Executor is the shared **contract** between the PowerAutomate `ExecutePrompt` child flow and the Vercel `executePrompt()` service function. Both implementations do the same nine things with the same inputs and same outputs, so that:

- A prompt row authored once in `wmkf_ai_prompt` serves both callers without duplication
- Cache prefixes are byte-identical across callers (prompt cache hits work)
- `wmkf_ai_run` rows written by either caller are structurally identical (audit trail stays coherent)
- Adding a new prompt means editing a Dynamics row — not authoring new code in two places

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

**Deferred (Phase 1+):** `overridePromptBody: { system?: string, body?: string }` — body-level override for per-session prompt editing (PROMPT_STORAGE_DESIGN §17). Not needed for May 1.

### Outputs

| Name | Type | Purpose |
|---|---|---|
| `parsed` | object \| null | Output object matching `wmkf_ai_promptoutputschema`. `null` when `blocked = true`. Downstream chain steps consume this. |
| `runId` | GUID | `wmkf_ai_run.wmkf_ai_runid` for the logged Execution. |
| `cacheHit` | bool | Derived from Claude response's `usage.cache_read_input_tokens > 0`. For observability. |
| `blocked` | bool | `true` when at least one guarded target was already populated and `forceOverwrite` was false. Claude was not called; no targets written. |
| `conflicts` | array | When `blocked`, one entry per guarded target that triggered the block: `{ output, table, field, existingContent, existingLength, modifiedOn }`. Caller (typically Vercel) uses this to render a confirm-overwrite UI. |
| `writeResults` | object \| null | When not blocked: `{ allOk, results: [{ output, ok, field?, jsonPath?, reason?, error? }] }`. `null` when blocked. |
| `usage` | object \| null | Verbatim Anthropic `usage` object (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`). `null` when blocked. |
| `meta` | object \| null | `{ promptName, promptVersion, promptId, modelUsed, systemChars, bodyChars }`. `null` when blocked. Useful for observability/UI display. |

### Errors

Executor throws (Vercel) or sets failure status (PA) on: prompt not found, variable resolution failure, Claude API error, output parse failure, target write failure.

**Invariant:** a `wmkf_ai_run` row is **always** written — even on failure — with `wmkf_ai_status = Failed` and `wmkf_ai_notes = <error summary>`. This preserves audit completeness.

---

## The 10 steps

| # | Step | PA action | Vercel equivalent |
|---|---|---|---|
| 1 | Resolve prompt | HTTP GET `wmkf_ai_prompts?$filter=wmkf_ai_promptname eq '<name>' and wmkf_ai_iscurrent eq true&$top=1` | `execute-prompt.js` queries `wmkf_ai_prompts` directly via Dataverse (NOT via `PromptResolver` — that's the legacy `wmkf_ai_runs` scratch-row path, used now only by audit scripts) |
| 2 | Parse variable declarations | Parse JSON on `wmkf_ai_promptvariables` | `JSON.parse(row.wmkf_ai_promptvariables)` |
| 3 | Resolve variable values | Apply-to-each + Switch on `source.kind` | Loop + switch; source kinds handled by dedicated resolvers |
| 4 | **Preflight output guards** | For each output with `guard != "always-overwrite"`, GET target field. If populated AND `forceOverwrite = false` → write `wmkf_ai_run` with status `Needs Review`, return `{ blocked: true, conflicts, runId }`. Capture `@odata.etag` per target for step 8's `If-Match`. | Same. Skip steps 5–8 on block. |
| 5 | Compose Claude payload | Compose action: system + user blocks; `cache_control: {type:"ephemeral"}` at declared prefix boundary | `buildClaudeRequest(prompt, variables)` |
| 6 | Call Claude | HTTP action → Anthropic API | `fetch('https://api.anthropic.com/v1/messages', ...)` |
| 7 | Parse output | Parse JSON on Claude response `content[0].text` using `wmkf_ai_promptoutputschema.jsonSchema` (or treat as raw text when `parseMode = "raw"`) | Same |
| 8 | Persist outputs | Coalesce all `akoya_request` outputs into **one** PATCH with `If-Match: <etag>` from step 4. Direct field writes (no `jsonPath`) merge into the payload as `{ field: value }`. `jsonPath` outputs grouped by field: GET the current memo, apply each `$.path` write in declaration order (later writes win on key collisions), serialize back, add the merged JSON to the same payload. Two direct outputs writing the same field (no `jsonPath`) throws at preflight as a schema error. Success or failure is uniform across all contributors: a 412 marks every eligible output as `concurrent_edit`. | Same coalesced PATCH |
| 9 | Log Execution | Create `wmkf_ai_run`: Lookup to prompt row, `wmkf_ai_promptversion`, `wmkf_ai_runsource`, `wmkf_ai_status`, `wmkf_ai_model`, `wmkf_ai_rawoutput` according to `rawOutputRetention`, token/cache counts in `wmkf_ai_notes`, `wmkf_ai_request` Lookup | Same |
| 10 | Return | Return `{ parsed, runId, cacheHit, blocked: false }` | `return { parsed, runId, cacheHit, blocked: false }` |

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

**Preprocess hints (Phase 0):** `pdf_to_text` only — the live `execute-prompt.js` throws on any other hint. `docx_to_text`, `truncate_tokens:N`, `strip_images` are deferred until needed. Adding a new hint requires updating both Executor implementations.

**Placement attribute (Phase 0 — present but single-valued):** v0 only supports `placement: "user"`. Phase 2 adds `placement: "system"` for context-block variables that need to be part of the cacheable system-array prefix.

**`cacheable` flag:** Phase 0 honors this for *within-prompt* cache alignment (rerunning the same prompt on the same request hits the Claude cache). Cross-prompt cache alignment (e.g., summary + compliance sharing the bundle) requires context blocks in Phase 2.

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

**`parseMode` (output schema, Phase 0):** `"json"` (default — Claude must return parseable JSON matching `jsonSchema`) or `"raw"` (the entire `content[0].text` becomes the value of the single declared output; `jsonSchema` ignored). Multi-output prompts must use `"json"`.

**`validationSchema` (output schema, added 2026-05-22 — A7 step 3):** an optional declarative schema, in the `validateAiJson` node format (`lib/utils/ai-output-schema.js` — `{ "type": "object", "fields": { … } }`, plus `array` / `record` / scalar nodes; fully JSON-serialisable). When present and `parseMode = "json"`, the Executor validates the parsed model output against it in step 7, **after** the `jsonSchema.required` check and **before** step 8 persistence. Undeclared keys are dropped and types/lengths are bounded, so a prompt-injected model cannot smuggle an extra field through to an `akoya_request` writeback. A validation failure throws (logged as a `failed` run row). Prompts that omit `validationSchema` are unchanged — the field is purely additive. `raw` parseMode never reaches this check. `jsonSchema` (presence/required-key assertion) and `validationSchema` (post-parse shape enforcement) are independent and may both be declared.

**`rawOutputRetention` (output schema, added 2026-05-04):** controls what the Executor writes to `wmkf_ai_run.wmkf_ai_rawoutput` after parsing/persisting the model response. Default is `"full"` for backwards compatibility.

| Mode | `wmkf_ai_rawoutput` content |
|---|---|
| `full` | Full Claude response text, truncated only by the Dataverse Memo safety cap. |
| `hash` | Content-free metadata: `{retention:"hash", originalChars, sha256}`. Use when the model output is already persisted to a target field such as `akoya_request.wmkf_ai_summary`. |
| `none` | Content-free metadata: `{retention:"none", originalChars}`. Use when even hash correlation is unnecessary. |

`phase-i.summary` uses `"hash"` because the summary itself is already written to `akoya_request.wmkf_ai_summary`; the run row only needs correlation metadata.

---

## Caching contract

**Byte-identical prefixes across callers are the whole point of cache alignment.** If PA and Vercel produce different bytes before the first `cache_control` marker, they land in different cache buckets and neither call benefits from the other.

The Executor always:

1. Sends `system` and `user` as separate blocks (requires the `wmkf_ai_systemprompt` + `wmkf_ai_promptbody` split — added by Connor in Phase 0, confirmed live 2026-04-24).
2. For each variable marked `cacheable: true`, places it **before** the last `cache_control` marker.
3. For each variable marked `cacheable: false`, places it **after** the marker (in the non-cached tail).
4. Emits exactly one `cache_control: {type: "ephemeral"}` at the boundary.

Any change to the prompt body, the system prompt, or a cacheable variable splits the cache — that's correct behavior. The cache is only safe to rely on when nothing in the prefix has changed.

**Within-prompt caching (Phase 0):** rerunning `phase-i.summary` on the same `requestId` with the same PDF content will hit cache on repeat invocations within the 5-min TTL.

**Cross-prompt caching (Phase 2):** `phase-i.summary` and `phase-i.compliance` both reference a shared `context_block` placed in `system`, so a back-to-back invocation of both prompts on one request hits cache on the second call for the document tokens.

---

## Logging contract

Every Execution writes one `wmkf_ai_run` row with, at minimum:

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
| `wmkf_ai_rawoutput` | Claude response according to `rawOutputRetention` (`full`, `hash`, or `none`) |
| `wmkf_ai_request` | Lookup to `akoya_request` (if applicable) |
| `wmkf_ai_notes` | Input/output token counts + cache hit counts + any error summary |
| `wmkf_ai_rundatetime` | Set by caller or default to now |

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

**For Connor's PA flows (Phase 1):** every parent flow that calls `ExecutePrompt` must explicitly pass `forceOverwrite` as an input parameter. Don't default it to either value at the child-flow level — make the parent flow author declare intent. A bulk re-summarization flow and a first-pass intake flow have opposite correct defaults; the contract should not pick.

### 2. Output `guard` — set once on the prompt row

The `guard` policy lives on the `wmkf_ai_promptoutputschema` row, not per call site. It encodes a property of the *target field*, not a property of the caller. Examples:

- `wmkf_ai_summary` (human-curated narrative): `guard: "skip-if-populated"` — guard fires by default; `forceOverwrite` decides
- An audit-log JSON Memo that's always re-derived: `guard: "always-overwrite"` — Executor never preflights; `forceOverwrite` is a no-op for this output

A prompt row with `guard: "always-overwrite"` on every output ignores `forceOverwrite` entirely. This is correct: the caller should not be choosing whether to overwrite a field that *should always be overwritten by design*.

---

## Non-goals (what the Executor does NOT do)

- **Does not orchestrate chains.** The caller (parent PA flow or Vercel API route) decides which prompts run in what order. Executor runs exactly one prompt per invocation.
- **Does not branch on output.** Business-logic conditions ("if compliance failed, notify staff") live in the caller's Flow.
- **Does not retry.** Caller decides retry policy. Executor returns failure; caller decides whether to re-invoke.
- **Does not handle arbitrary code.** Preprocessing, source kinds, and target kinds are closed enums. Weird cases require a new enum value implemented in both executors — not an "exec arbitrary script" escape hatch.
- **Does not write to SharePoint.** Phase 0 is Dynamics-only for persistence.
- **Does not manage prompt lifecycle.** Draft/publish/retire is a separate dashboard concern.
- **Does not stream.** Streaming Executor variant (`executePromptStream`) deferred; today's streaming routes stay outside the contract.

---

## Test oracle

A small test prompt `test.echo`:
- Declares two variables — one `dynamics`, one `override`
- Output schema: `{ echo: string }` with target `kind: none`
- System prompt: `"Echo the inputs verbatim as JSON."`

Both executors must:
1. Invoked with identical `requestId` and `overrideVariables`, produce byte-identical `wmkf_ai_rawoutput`
2. On second invocation, `cacheHit` is `true` regardless of which caller went first

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
- Publish-time structural lint + test-run gate (manual review still the current process)

**Caching note:** within-prompt cache hits only. Running summary then compliance on the same request does NOT share cache on the document block — both calls pay full price. Worth revisiting when proposal-context-extraction (`docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`) ships.
