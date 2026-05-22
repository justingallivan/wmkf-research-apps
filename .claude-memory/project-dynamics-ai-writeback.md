---
name: Dynamics AI Fields — v3 canonical, write access verified
description: Canonical field names + write-access state for AI writeback to Dynamics akoya_request and wmkf_ai_run. Supersedes v2 spec.
type: project
originSessionId: 09e7e972-ba80-4cd8-88a7-6fa9bffc5036
---
**Canonical spec:** `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` (Connor, 2026-04-14). v2 (`docs/archive/DYNAMICS_AI_FIELDS_SPEC_v2.md`) is archived — field names, Choice values, and child-table schema in v2 do NOT match what's actually live. Always refer to v3.

**Why:** Connor implemented v3 in Dynamics and renamed several fields (no underscores after `wmkf_ai_` prefix, some renamed: `structured_data` → `dataextract`, `task_type` → `tasktype`, etc.). Writing code against v2 names will fail.

**How to apply:** When wiring any AI writeback, pull the field/Choice names from v3. Do not re-derive from v2 or from memory.

## Verified write state (2026-04-14)

- **App registration `d2e73696-537a-483b-bb63-4a4de6aa5d45`** has `prvUpdate` on `akoya_request` and `prvCreate`/`prvUpdate` on `wmkf_ai_run` (**no `prvDelete` — append-only by design**). Scoped — `systemuser` writes still 403.
- **Email sending works** — Activity privileges (`prvCreateActivity`/`prvWriteActivity`/`prvReadActivity` + `prvSendAsUser`) cover SendEmail. No separate `prvSendEmail` needed.
- **`prvCreateNote` on `annotation` is NOT granted.** Don't design anything that drops notes on records without first going back to IT.
- **SharePoint `Sites.Selected` write** granted 2026-04-15; verified end-to-end via `scripts/probe-sharepoint-write.js` on 2026-05-01 (PUT + DELETE round-trip on `akoya_request` library both succeed). No longer blocking.

## Canonical names (Field Sets A, C; table `wmkf_ai_run`)

**`akoya_request` (Field Set A):** `wmkf_ai_summary` (Memo), `wmkf_ai_dataextract` (Memo, JSON).
**`akoya_request` (Field Set C):** `akoya_submissionaccepted` (existing, reused), `wmkf_ai_complianceissues` (Memo, JSON), `wmkf_ai_compliancesummary` (Memo).
**`wmkf_ai_run`:** `wmkf_ai_runid` (GUID), `wmkf_ai_runnum` (auto-number primary), `wmkf_ai_request` (lookup), `wmkf_ai_tasktype` (Picklist), `wmkf_ai_model` (String), `wmkf_ai_promptversion` (Integer), `wmkf_ai_status` (Picklist), `wmkf_ai_rawoutput` (Memo), `wmkf_ai_notes` (Memo). Timestamp = built-in `createdon`.

**Choice values (must use numeric, not labels):**
- `wmkf_ai_tasktype`: Summary=682090000, Report=682090001, Check-in=682090002, PD Assignment=682090003.
- `wmkf_ai_status`: Completed=682090000, Failed=682090001, Needs Review=682090002.

Note: "compliance" task label was renamed to **Check-in** in v3.

## Known quirks (will change soon)

- `wmkf__ai_summary` (double underscore) exists on `akoya_request` alongside the real `wmkf_ai_summary` — cruft, Connor will delete. Do not target it.
- `wmkf_ai_rundatetime` exists on `wmkf_ai_run` but is vestigial — use built-in `createdon` instead. Do not write to `wmkf_ai_rundatetime`.
- **`wmkf_ai_rawoutput` cap is 1,000,000 chars** (Connor raised it from the 2000-char default on 2026-04-14). `DynamicsService.logAiRun` still truncates with a `…[truncated N chars]` marker as a safety valve, but real Grant Reporting payloads (5-15k) are nowhere near the cap. `wmkf_ai_notes` is still on the 2000-char default — keep notes short.

## Implementation status

- Field Set A (Proposal Summary): **DEPLOYED**.
- Field Set B (Grant Report): **DEPLOYED 2026-05-07** — 22 fields on `akoya_request` (8 counts, 7 multi-line text, 6 publication fields, 1 choice). See `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` for the field list and `wmkf_ai_tasktype = 682090001` (Report) for runs writing these.
- Field Set C (Compliance): **DEPLOYED**.
- Field Set D (PD Assignment): **DEPLOYED** — writes to existing `wmkf_programdirector` lookup.
- `wmkf_ai_run` child table: **DEPLOYED + live in production**.
- Workflow-chaining fields (`wmkf_ai_keywords`, `wmkf_ai_methodologies`, `wmkf_ai_riskflags`, `wmkf_ai_teaminfo`, `wmkf_ai_budgetsummary`, `wmkf_ai_timeline`): **DEPLOYED 2026-05-07** alongside Set B.

## Test scripts

- `scripts/test-dynamics-write.js` — CRUD smoke test. Targets test request `992629`. Includes negative-scope probe on `systemuser`.
- `scripts/test-dynamics-email.js --send` — sends test email via SendEmail action. Script was patched 2026-04-14 to bind sender systemuser via `partyid_systemuser@odata.bind` (previously only `addressused`, which 400s).
- `scripts/inspect-ai-fields.js` — dumps actual `wmkf_*ai*` attribute names on `akoya_request` and `wmkf_ai_run` for reconciliation.
- `scripts/test-log-ai-run.js` — creates a row in `wmkf_ai_run` against test request 992629, reads back to verify Choice mapping + lookup binding. Append-only, so test rows accumulate; ask Connor to purge periodically (filter `wmkf_ai_model eq 'claude-sonnet-4-TEST'`).

## Navigation property gotcha

Custom lookup navigation properties are **case-sensitive** and are NOT the same as the attribute logical name. For `wmkf_ai_run.wmkf_ai_request`, the nav prop is **`wmkf_ai_Request`** (capital R). Always discover via `EntityDefinitions(LogicalName='X')?$expand=ManyToOneRelationships($select=ReferencingEntityNavigationPropertyName)` before guessing. See `DynamicsService.logAiRun` for the canonical binding.

## Dynamics Explorer — `wmkf_ai_run` exclusion DONE

Verified 2026-05-14: `wmkf_ai_run` is not in `TABLE_ANNOTATIONS` (the `entitySet:` enumeration) in `shared/config/prompts/dynamics-explorer.js`. The chat tool's schema-suggestion path no longer surfaces it. Operational logs are out of the natural-language query surface.

## Writeback TODOs

- **Reusable "don't clobber" helper.** First user-initiated writeback (Phase I Dynamics summarize) hard-codes the read-before-write check inline. Once a second user-initiated writeback ships (Field Set C Compliance, Grant Reporting flat fields when Set B unblocks, etc.), lift the pattern into a `DynamicsService.updateIfEmpty(entitySet, guid, fieldName, value, { overwrite })` helper. Server-side 409-on-conflict is the contract; don't push this into individual endpoints.
- **Surface existing writeback state during lookup.** Current UX flow does the no-clobber check at submit time (server 409 → confirm dialog → resubmit with `overwrite: true`) — costs one extra round-trip for the common "yes, overwrite" case. Better UX: include the target flat fields (e.g. `wmkf_ai_summary`, `wmkf_ai_reportsummary`, etc.) in the `/api/grant-reporting/lookup-grant` select list so the frontend can surface a "will overwrite existing from YYYY-MM-DD" warning upfront on the Summarize button. Low priority until multiple apps hit this pattern.
- **Rule of thumb:** user-initiated flows check for existing data; backend/PowerAutomate flows can overwrite freely (they're authoritative reruns, not accidents).
