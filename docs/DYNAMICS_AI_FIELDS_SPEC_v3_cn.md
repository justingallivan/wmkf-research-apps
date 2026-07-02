# Dynamics Custom Fields for AI Output — Implementation Spec

**Author:** Connor
**Status:** v3 — `wmkf_ai_run` table, Field Sets A / B / C / D + workflow-chaining fields, Choices, and permissions all live in Dynamics. Set B deployed 2026-05-07 (28 fields total in that batch); see `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` for the canonical field list.
**Date:** 2026-04-14
**Based on:** Justin's v2 spec (`input/DYNAMICS_AI_FIELDS_SPEC.md`)

---

## Field Name Translation Key

Some field names have been modified from the original spec. This table maps old → new for anyone building app-side connections.

| Original name (Justin's specs) | New name (Dynamics) | Change reason |
|-------------------------------|---------------------|---------------|
| `wmkf_ai_run` (table) | `wmkf_ai_run` | No change |
| `wmkf_runid` | `wmkf_ai_runid` | Standardized to `wmkf_ai_` prefix |
| *(new)* | `wmkf_ai_runnum` | New field — auto-number Primary column for user-facing record identifier |
| `wmkf_request` | `wmkf_ai_request` | Standardized to `wmkf_ai_` prefix |
| `wmkf_task_type` | `wmkf_ai_tasktype` | Prefix + no underscores after prefix |
| `wmkf_generated_at` | `createdon` (built-in) | Replaced with Dynamics default field |
| `wmkf_model` | `wmkf_ai_model` | Standardized to `wmkf_ai_` prefix |
| `wmkf_prompt_version` | `wmkf_ai_promptversion` | Prefix + no underscores after prefix |
| `wmkf_status` | `wmkf_ai_status` | Standardized to `wmkf_ai_` prefix |
| `wmkf_raw_output` | `wmkf_ai_rawoutput` | Prefix + no underscores after prefix |
| `wmkf_notes` | `wmkf_ai_notes` | Standardized to `wmkf_ai_` prefix |
| `wmkf_ai_structured_data` | `wmkf_ai_dataextract` | Renamed + no underscores after prefix |
| `wmkf_ai_compliance_issues` | `wmkf_ai_complianceissues` | No underscores after prefix |
| `wmkf_ai_compliance_summary` | `wmkf_ai_compliancesummary` | No underscores after prefix |
| `wmkf_ai_summary` | `wmkf_ai_summary` | No change |

**Naming convention:** All custom fields use the `wmkf_ai_` prefix. No additional underscores appear after the prefix (e.g., `wmkf_ai_tasktype` not `wmkf_ai_task_type`).

---

## Child Table — `wmkf_ai_run`

One row per AI processing run. Serves as an audit trail and replay cache. Both Vercel apps and PowerAutomate flows write here on every run.

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_runid` | Unique Identifier (auto) | System GUID for the record |
| `wmkf_ai_runnum` | Auto-number (Primary column) | User-facing record identifier |
| `wmkf_ai_request` | Lookup → `akoya_request` | The request this run was for |
| `wmkf_ai_tasktype` | Choice | Which AI task ran |
| `createdon` *(built-in)* | DateTime | When the AI call ran — uses Dynamics default field, no custom field needed |
| `wmkf_ai_model` | Single-line text (~64) | Claude model ID (e.g. `claude-sonnet-4`) |
| `wmkf_ai_promptversion` | Whole number | Prompt version, bumped on prompt text changes |
| `wmkf_ai_status` | Choice | Run outcome |
| `wmkf_ai_rawoutput` | Multi-line text (JSON) | Full structured payload from Claude |
| `wmkf_ai_notes` | Multi-line text | Failure messages, retry context |

**Dynamics Explorer note:** This table is excluded from search results and schema suggestions in the chat tool. It's an operational log, not business data; `pages/api/dynamics-explorer/chat.js` denies direct schema requests for `wmkf_ai_run` and strips returned `wmkf_ai_run` search hits before the tool result is sent back to Claude.

---

## Choices

| Choice | Label | Value |
|--------|-------|-------|
| `wmkf_ai_tasktype` | Summary | 682090000 |
| | Report | 682090001 |
| | Check-in | 682090002 |
| | PD Assignment | 682090003 |
| `wmkf_ai_status` | Completed | 682090000 |
| | Failed | 682090001 |
| | Needs Review | 682090002 |

**Note:** API calls must use the numeric values, not the labels. The original spec's "compliance" label was renamed to "Check-in" to better reflect the task's purpose in the grant workflow.

---

## Field Set A — Proposal Intake Summary

Fields on `akoya_request`. Current values only; provenance lives in `wmkf_ai_run` with `wmkf_ai_tasktype = 682090000` (Summary).

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_summary` | Multi-line text | AI-generated proposal summary narrative |
| `wmkf_ai_dataextract` | Multi-line text (JSON) | Keywords, PI name(s), methods, etc. |

---

## Field Set C — Compliance Check

Fields on `akoya_request`. Provenance lives in `wmkf_ai_run` with `wmkf_ai_tasktype = 682090002` (Check-in).

| Field | Type | Purpose |
|-------|------|---------|
| `akoya_submissionaccepted` *(existing)* | Two options | Compliance pass/fail — AI writes this on completion |
| `wmkf_ai_complianceissues` | Multi-line text (JSON) | Array of `{category, severity, description}` |
| `wmkf_ai_compliancesummary` | Multi-line text | Human-readable one-paragraph summary |

Sample JSON for `wmkf_ai_complianceissues`:

```json
[
  { "category": "budget", "severity": "error", "description": "Budget exceeds $1M cap" },
  { "category": "format", "severity": "warning", "description": "Missing biosketch for co-PI" }
]
```

`severity` values: `error`, `warning`, `info`

---

## Field Set D — PD Assignment

**No new fields on `akoya_request`.** The AI writes directly to the existing `wmkf_programdirector` lookup. Confidence, rationale, and alternate candidates are exported to an Excel sheet by PowerAutomate for human audit — not persisted in Dynamics.

A `wmkf_ai_run` row is still created with `wmkf_ai_tasktype = 682090003` (PD Assignment) for traceability.

---

## Field Set E — Fit Assessment

**Renamed from "Field Set D" on 2026-05-26 (Connor walkthrough)** to resolve the prior label collision with PD Assignment. Fields and deployment are unchanged — only the label moved.

Fields on `akoya_request`. Written live by the Phase I Dynamics summarize-v2 Executor path.

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_fitassessment` | Picklist | AI's assessment of how well the proposal fits Keck program priorities |
| `wmkf_ai_fitrationale` | Memo | AI-generated rationale supporting the fit assessment |

Both fields are deployed and populated in prod (verified `akoya_request` 1002787, others).

---

## Field Set B — Grant Report Extraction

**Status: cleared to build (2026-05-07).** Connor approved building the skeleton as currently spec'd; expect iteration as staff feedback comes in. Schema additions logged to `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`.

**Naming note:** Field names below follow the `wmkf_ai_` prefix convention with no additional underscores (e.g., `wmkf_ai_report_postdocs` → `wmkf_ai_reportpostdocs`). Some publication fields are shortened (e.g., `wmkf_ai_report_publications_total` → `wmkf_ai_reportpubstotal`).

Provenance lives in `wmkf_ai_run` with `wmkf_ai_tasktype = 682090001` (Report).

### Counts (numeric, filterable)

Fields on `akoya_request`. All count fields should allow null — the AI returns `null` when a count isn't stated in the report.

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_reportpostdocs` | Whole number | Postdocs supported by this grant |
| `wmkf_ai_reportgradstudents` | Whole number | Graduate students supported |
| `wmkf_ai_reportundergrads` | Whole number | Undergraduates supported |
| `wmkf_ai_reportpubstotal` | Whole number | Total publications from the grant |
| `wmkf_ai_reportpubspeerreviewed` | Whole number | Peer-reviewed publications |
| `wmkf_ai_reportpubsnonpeerreviewed` | Whole number | Non-peer-reviewed publications |
| `wmkf_ai_reportpatentsawarded` | Whole number | Patents awarded during the grant |
| `wmkf_ai_reportpatentssubmitted` | Whole number | Patents filed/submitted |
| `wmkf_ai_reportadditionalfunding` | Multi-line text | Short description of additional funding leveraged |

### Narratives (freeform text)

Multi-line text fields on `akoya_request`. Staff can edit after the AI produces a draft.

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_reportprojectimpacts` | Multi-line text | Multi-paragraph project impacts narrative |
| `wmkf_ai_reportawardsandhonors` | Multi-line text | Awards and honors received during grant period |
| `wmkf_ai_reportpub1citation` | Multi-line text | Citation for top publication |
| `wmkf_ai_reportpub1abstract` | Multi-line text | Abstract for top publication |
| `wmkf_ai_reportpub1source` | Single-line text | Source flag (verbatim vs AI-summarized) for top publication |
| `wmkf_ai_reportpub2citation` | Multi-line text | Citation for second publication |
| `wmkf_ai_reportpub2abstract` | Multi-line text | Abstract for second publication |
| `wmkf_ai_reportpub2source` | Single-line text | Source flag for second publication |
| `wmkf_ai_reportimplications` | Multi-line text | Staff-draft implications for future grantmaking |

**Publication fields decision (2026-05-07):** Flat fields chosen over JSON blob — easier for staff to edit per-cell and native Dynamics views/filtering work without custom rendering. **Note:** This decision is publication-specific; `wmkf_ai_reportgoalsassessment` (below) intentionally stays a JSON Memo because the per-goal payload is variable-shape.

### Goals assessment (structured)

| Field | Type | Purpose |
|-------|------|---------|
| `wmkf_ai_reportoverallrating` | Choice | `successful`, `mixed`, `unsuccessful` (starting set, 2026-05-07; full rating mechanism not yet spec'd) |
| `wmkf_ai_reportoutcomesummary` | Multi-line text | 2–4 sentence summary of overall delivery |
| `wmkf_ai_reportgoalsassessment` | Multi-line text (JSON) | Full per-goal breakdown (see sample below) |
| `wmkf_ai_reportnotesforstaff` | Multi-line text | Things a PD should double-check |

Sample JSON for `wmkf_ai_reportgoalsassessment`:

```json
[
  {
    "goal_number": "Aim 1",
    "goal_text": "Develop a novel catalyst for…",
    "evidence_from_report": "Section 3 describes completion of…",
    "status": "achieved",
    "confidence": "high"
  },
  {
    "goal_number": "Aim 2",
    "goal_text": "…",
    "status": "partial",
    "confidence": "medium"
  }
]
```

`status` values: `achieved`, `partial`, `not_addressed`, `pivoted`
`confidence` values: `high`, `medium`, `low`

---

## Permissions / Admin Actions

| Action | Detail | Status |
|--------|--------|--------|
| Write permissions on app registration | Custom security role: `prvUpdate` on `akoya_request`, `prvCreate`/`prvUpdate` on `wmkf_ai_run`. App ID: `d2e73696-537a-483b-bb63-4a4de6aa5d45` | **Done** (2026-04-14) |
| Activity privileges | `prvCreateActivity`, `prvWriteActivity`, `prvReadActivity` on Activity entity + `prvSendAsUser` (already granted). Note: `prvSendEmail` from Justin's original spec does not exist as a distinct privilege — `prvSendAsUser` + Activity privileges should cover it. Justin to verify with `node scripts/test-dynamics-email.js`. | **Done** (2026-04-14) |
| SharePoint write grant | `Sites.Selected` write access on akoyaGO site for the app registration | **Done** (2026-04-15) — IT granted write via Graph API |

---

## Implementation Status

1. ~~`wmkf_ai_run` child table + Choices~~ — **Done** (2026-04-14)
2. ~~Field Set A — Proposal Intake Summary~~ — **Done** (2026-04-14)
3. ~~Field Set C — Compliance Check~~ — **Done** (2026-04-14)
4. ~~Field Set B — Grant Report~~ — **Done** (deployed 2026-05-07; 22 fields on `akoya_request`; see `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` for the field list. Wiring `pages/api/grant-reporting/extract.js` to write the flat fields is a follow-up.)
5. ~~Field Set D — write permission grant~~ — **Done** (verified 2026-04-14)
6. ~~Workflow-chaining fields~~ — **Done** (deployed alongside Set B on 2026-05-07: `wmkf_ai_keywords`, `wmkf_ai_methodologies`, `wmkf_ai_riskflags`, `wmkf_ai_teaminfo`, `wmkf_ai_budgetsummary`, `wmkf_ai_timeline`)

---

## References

- `archive/DYNAMICS_AI_FIELDS_SPEC_v2.md` — Justin's v2 spec (superseded; historical only)
- `BACKEND_AUTOMATION_PLAN.md` — 5-phase roadmap
- `DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md` — identity bridge plan
- `archive/PENDING_ADMIN_REQUESTS.md` — historical admin-request log (all four asks resolved by 2026-05-08; see `STRATEGY.md` for current dependency table)

---

## Post-v3 notes (2026-04-14, Justin)

Verification and Connor follow-up after the v3 hand-off.

### Write access verified

- Ran `scripts/test-dynamics-write.js` against test request `992629`. Full round-trip PATCH succeeded on a memo field on `akoya_request`. Scoped-write probe against `systemuser` correctly returned 403. Details in session log.
- Ran `scripts/test-dynamics-email.js --send`. Outbound email via the SendEmail action succeeded end-to-end, confirming the Activity privilege grant covers email send. `prvSendAsUser` + Activity privileges are sufficient — no separate `prvSendEmail` needed.

### Items clarified with Connor

| Item | Resolution |
|------|------------|
| Field Set B (Grant Report) | Cleared 2026-05-07; deployed alongside workflow-chaining fields the same day. 22 fields on `akoya_request` (8 counts, 7 multi-line text, 6 publication fields, 1 choice). Wiring `grant-reporting/extract.js` to write the flat fields is the remaining follow-up. |
| Duplicate `wmkf__ai_summary` field (double underscore) on `akoya_request` | Confirmed as a mistake. Connor will delete it. Canonical field is `wmkf_ai_summary` (single underscore). |
| `wmkf_ai_rundatetime` on `wmkf_ai_run` | Connor created it but it's vestigial. Apps should use the built-in `createdon` column as stated in the main v3 doc. Do **not** write to `wmkf_ai_rundatetime`. |

### Privilege gaps noted (not currently blocking)

- **`prvCreateNote` on `annotation`** — the grant does not include Note creation. Nothing in v3 requires it, but if a future flow wants to drop audit notes on records, we'd need to request this.
- ~~**SharePoint `Sites.Selected` write**~~ — **Resolved** (2026-04-15). IT granted write access on akoyaGO site.
