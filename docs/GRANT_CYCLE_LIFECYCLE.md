---
title: Grant Cycle Lifecycle
domain: architecture
kind: source-of-truth
status: canonical
summary: "Status: Mixed — some AI fields and post-approval flows are live; PA-orchestrated flows are still pending. See \"What's live now (2026-05-08)\" below."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/atlas/dataverse-akoya-request.md
  - lib/services/execute-prompt.js
  - scripts/test-echo-parity.js
  - docs/POSTGRES_TO_DATAVERSE_MIGRATION.md
---

# Grant Cycle Lifecycle

**Status:** Mixed — some AI fields and post-approval flows are live; PA-orchestrated flows are still pending. See "What's live now (2026-05-08)" below.
**Created:** Session 94, 2026-04-08
**Stakeholders:** Justin (prompt development, Vercel app), Connor (PowerAutomate flows, Dynamics admin)

> **Cycle redesign in flight.** The next grant cycle is being restructured: the standalone "Concept" stage is being eliminated and Phase I + Phase II are likely to merge into a single applicant-facing package (internal Phase I/II labels persist as a label change, not a separate document submission). The lifecycle below describes the **current cycle**; the redesigned cycle will need its own pass once Sarah/Connor lock the new shape. See memory entries `project_grant_phasing_evolution.md` and `project_app_roadmap_2026-04-25.md`.

## What's live now (2026-05-08)

- **AI fields on `akoya_request`** are deployed (Field Sets A + C + D + 6 workflow-chaining fields per `docs/atlas/dataverse-akoya-request.md`). Field Set B ("Grant Reporting") is also DEPLOYED as of S139.
- **`wmkf_ai_run`** audit table is live; Vercel writes via `dynamics-service.logAiRun` and `lib/services/execute-prompt.js`.
- **`/phase-i-dynamics/summarize-v2`** writes summaries via the Executor contract — single-request prompt-tuning surface (not in nav, direct URL).
- **Reviewer-finding + Review-management + Integrity screening** all run from the Vercel app.
- **PA-side `ExecutePrompt` flow** is the parity oracle (Connor builds; Vercel side is ready, see `scripts/test-echo-parity.js`).
- **Connor's `akoya_request` create/update PA flows** (file-org, AI check-in, staff version) are still pending.

---

## Overview

This document maps the full lifecycle of a grant application from submission through funding decision. Each stage identifies the Dynamics status value, what triggers it, who acts, and whether AI automation is involved.

**Architecture:**
- Automated AI tasks run in PowerAutomate, calling the Claude API directly and writing results to Dynamics
- Human-initiated tasks (reviewer finding, review management, integrity screening) run in the Vercel app
- Dynamics is the source of truth for all operational data

---

## Phase I: Application

| # | Stage | Dynamics Status | Trigger | Actor | AI Task | Output |
|---|-------|----------------|---------|-------|---------|--------|
| 1 | Application submitted | `Phase I Status = Pending Committee Review` | Applicant submits in GOapply | Applicant | — | New request created in Dynamics |
| 2 | Documents stored | — | Request creation | GOapply/Dynamics | — | Application docs placed in akoyaGO SharePoint request folder |
| 3 | File organization | — | Step 2 complete | PA flow | — | Docs moved into Phase I subfolder |
| 4 | AI compliance check | — | Step 3 complete | PA flow → Claude API | **Compliance verification, keyword extraction, summary generation** | Results written to Dynamics fields on `akoya_request` |
| 5 | Staff version created | — | Step 4 passes compliance | PA flow | — | Formatted cover page + consolidated PDF saved to WMKF Research SharePoint |
| 6 | PD assignment | — | After application deadline | PA flow → Claude API | **PD assignment by specialty area** | PD assigned on `akoya_request` |
| 7 | PD review & scoring | `Not Scored` or `Scored` | PDs review applications | PDs (human) | — | Applications scored or eliminated |
| 8 | Staff recommendation | `Recommended Invite` or `Recommended Not Invite` | PD discussion complete | Staff (human) | — | Recommendations for program chairs |
| 9 | Integrity screening | — | Recommendations finalized | Staff via Vercel app (manual) | **Integrity screening** | Screen all `Recommended Invite` applicants |
| 10 | Chair approval | `Invited` or `Not Invited` | Program chairs review | Program chairs (human) | — | Final Phase I decisions |

---

## Phase II: Proposal

| # | Stage | Dynamics Status | Trigger | Actor | AI Task | Output |
|---|-------|----------------|---------|-------|---------|--------|
| 11 | Phase II proposal submitted | `Phase II Status = Phase II Pending Committee Review` | Invited applicant submits in GOapply | Applicant | — | Request updated in Dynamics |
| 12 | Documents stored | — | Proposal submission | GOapply/Dynamics | — | Proposal docs placed in akoyaGO SharePoint request folder |
| 13 | File organization | — | Step 12 complete | PA flow | — | Docs moved into Phase II subfolder |
| 14 | AI compliance check | — | Step 13 complete | PA flow → Claude API | **Compliance verification (+ additional tasks TBD)** | Results written to Dynamics fields |
| 15 | Staff version created | — | Step 14 passes compliance | PA flow | — | Formatted cover page + consolidated PDF saved to WMKF Research SharePoint |
| 16 | PD review & recommendation | `Recommended` or `Not Recommended` | PDs review proposals | PDs (human) | — | Staff funding recommendations |
| 17 | Board decision | `Approved` or `Phase II Declined` | Board meets | Board (human) | — | Final funding decisions |

---

## AI Task Summary

### Automated (PowerAutomate → Claude API)

| Task | Lifecycle Step | Input | Output | Prompt Status |
|------|---------------|-------|--------|---------------|
| Compliance check | 4, 14 | Application/proposal PDF text | Pass/fail + reasons | To be developed |
| Summary + keywords | 4 | Application PDF text | Summary text, keywords → Dynamics fields | To be developed |
| PD assignment | 6 | Application text + staff roster + specialty rules | Recommended PD | **Expertise Finder app built** — prompt + roster in Vercel; hand to Connor for PA flow when validated |

### Human-Initiated (Vercel App)

| Task | Lifecycle Step | Tool | Status |
|------|---------------|------|--------|
| Integrity screening | 9 | Integrity Screener app | Built and running |
| Reviewer finding | Post-approval | Workbench Reviewers tab | Built and running |
| Review management | Post-approval | Workbench Reviewers tab | Built and running |
| Panel review | During PD review | Virtual Review Panel app | Built and running |
| Expertise matching | 6 (PD assignment) | Expertise Finder app | Built and running |
| Proposal summarization | Ad-hoc | Phase I/II Writeup apps | Built and running |

---

## Dynamics Fields for AI Output

**Status: DEPLOYED.** Connor created the canonical v3 field set; live names differ from the v2 spec referenced when this doc was first drafted. Field-level inventory and write contracts are in `docs/atlas/dataverse-akoya-request.md`. Highlights:

| Live field | Type | Purpose |
|---|---|---|
| `wmkf_ai_summary` | Memo | AI-generated summary (Field Set A) |
| `wmkf_ai_dataextract` | Memo (JSON) | Keywords, PI, methods, structured fields (Field Set A) |
| `wmkf_ai_complianceissues` | Memo (JSON) | Compliance task output (Field Set C) |
| `wmkf_ai_compliancesummary` | Memo | Compliance summary (Field Set C) |
| `wmkf_ai_reportsummary` + 21 reporting fields | Memo / mixed | Field Set B (Grant Reporting), DEPLOYED S139 |
| `wmkf_ai_run` (child entity) | Audit row | Run metadata: model, prompt version, status, raw output. `createdon` is the canonical timestamp (the older `wmkf_ai_rundatetime` is vestigial). |

The vestigial v2-style fields (`wmkf_ai_summary_generated_at`, `wmkf_ai_summary_model`, `wmkf_ai_summary_version`) were *not* deployed; the design landed on a child-entity audit row instead. Use `wmkf_ai_run` for run metadata, not flat fields on the parent.

PD assignment writes to existing `wmkf_programdirector` lookup (Field Set D — no new fields).

---

## PowerAutomate Flow Inventory

| Flow | Trigger | Steps | Status |
|------|---------|-------|--------|
| Phase I file organization | Request created with `Phase I Status = Pending Committee Review` | Move docs to Phase I subfolder | Planned |
| Phase I AI check-in | File organization complete | Call Claude API for compliance + summary + keywords → write to Dynamics | Planned |
| Phase I staff version | AI check passes compliance | Generate cover page + consolidate PDF → save to WMKF Research SharePoint | Planned |
| PD assignment | After application deadline (batch) | Call Claude API with all pending apps → assign PDs in Dynamics | Planned |
| Phase II file organization | `Phase II Status = Phase II Pending Committee Review` | Move docs to Phase II subfolder | Planned |
| Phase II AI check-in | File organization complete | Call Claude API for compliance (+ TBD tasks) → write to Dynamics | Planned |
| Phase II staff version | AI check passes compliance | Generate cover page + consolidate PDF → save to WMKF Research SharePoint | Planned |

---

## Prompt Development Priority

Ordered by lifecycle position (earliest AI task first):

1. **Compliance check** (step 4) — first AI task in the lifecycle, gates everything downstream
2. **Summary + keyword extraction** (step 4) — runs alongside compliance check
3. **PD assignment** (step 6) — rules need to be built from scratch
4. **Phase II compliance** (step 14) — similar to Phase I but requirements may differ

Development approach: batch evaluation against historical proposals in Dynamics, iterate on prompts, hand proven prompts to Connor for PA flows.

---

## Data Migration

**Wave 1 COMPLETE 2026-05-12.** `system_settings`, `user_app_access`, `user_preferences` migrated to Dataverse (`wmkf_appsystemsettings`, `wmkf_appuserappaccesses`, `wmkf_appuserpreferences`); Postgres tables dropped. Dispatcher services default to Dataverse. See `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` for migration history.

**Wave 2 in progress** (reviewer data migration). Plan locked S136; see `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`. Wave 2 build set landed S139 (junction entity `wmkf_apprequestperson`, contact-history endpoint, save-candidates Dataverse cutover). Most Postgres reviewer tables drain rather than migrate (match-on-discovery + history badges replaces 1:1 row migration).

System/infrastructure data stays in Vercel Postgres:
- User profiles + linkage to Dynamics `systemuser`
- Usage logs, monitoring (`api_usage_log`, `health_check_history`, `system_alerts`, `maintenance_runs`)
- Retraction Watch reference data
- Intake-portal drafts + audit (`intake_drafts`, `intake_audit`)
- Dynamics Explorer per-user state (`dynamics_feedback`, `dynamics_query_log`, `dynamics_user_roles`, `dynamics_restrictions`)
- Integrity Screener history (`integrity_screenings`, `screening_dismissals`)
- Virtual Review Panel persistence (`panel_reviews`, `panel_review_items`)
