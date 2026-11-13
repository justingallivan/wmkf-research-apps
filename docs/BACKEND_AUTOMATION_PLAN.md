---
title: Long-Term Plan: Event-Driven Backend Automation via PowerAutomate
domain: general
kind: plan
status: active
summary: "Executor is live. Short Title Sandbox delivery passed. Power Automate submission and the Grant Reporting destination remain open."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/GRANT_CYCLE_LIFECYCLE.md
  - lib/services/execute-prompt.js
  - docs/PROMPT_STORAGE_DESIGN.md
  - docs/WORKFLOW_CHAINING_DESIGN.md
---

# Long-Term Plan: Event-Driven Backend Automation via PowerAutomate

**Status:** Active roadmap. The shared prompt store and single-prompt
Executor are shipped. The isolated Short Title Sandbox Preview has authenticated
submit and status endpoints. The authorized hosted run delivered one field value.
Justin reported Connor’s Power Automate status check passed. Power Automate
submission remains pending. See the [Sandbox handoff](plans/POWER_AUTOMATE_PROMPT_HANDOFF_2026-11-11.md#hosted-sandbox-setup).
**Created:** Session 90, 2026-03-28
**Last implementation probe:** 2026-11-12 isolated Short Title Sandbox Preview delivery. The 2026-07-27 production Power Automate metadata probe is recorded below.
**Stakeholders:** Justin (prompt development, Vercel app), Connor (PowerAutomate flows, Dynamics admin)

## Context

This project started as a personal workflow automation tool and has grown into a multi-user platform. Leadership wants key processing tasks (especially proposal summarization and compliance screening) to happen automatically when documents arrive in Dynamics/Dataverse — no manual uploads, no button clicks. Other tasks (reviewer finding, review management) remain human-initiated and write their authoritative reviewer state to Dataverse. This is a target for grant-processing outputs, not a universal persistence rule: Integrity Screener, Virtual Review Panel, operational queues, drafts, and observability retain documented Postgres ownership.

See `docs/GRANT_CYCLE_LIFECYCLE.md` for the full proposal lifecycle with stage-by-stage detail.

---

## Current foundation and target architecture

[VERIFIED via `lib/services/execute-prompt.js` and
`pages/api/phase-i-dynamics/summarize-v2.js`] The Vercel Executor reads
versioned Dataverse prompts, resolves declared sources, validates model
results, coalesces eligible Request field writes, and attempts to write an
invocation audit to `wmkf_ai_run`. Audit persistence and Request writeback
can fail independently. The first reference prompt, `phase-i.summary`,
shipped in April 2026. See [Executor Contract](EXECUTOR_CONTRACT.md).

### Automated AI tasks [PLANNED]

1. Power Automate detects a configured lifecycle event and submits the
   approved Request and task keys to the backend.
2. The backend prepares authorized source material and executes the tasks
   through the shared Executor. It owns validation, the invocation audit,
   and conditional writeback to approved destinations.
3. Power Automate polls job status and handles business branching,
   notifications, and follow-up.

The owner selected Executive Summary and Methodology as the first pilot.
Planned inputs include a mix of applicant-submitted and assembled documents
and PI fields sourced directly from Dataverse. The destination is eventually
approved Request fields. A synthetic trial comes first so the flow and job
contract can be exercised while the real field mappings are finalized.
The synthetic profile and job service are implemented. The first hosted Power Automate-facing slice is the isolated Short Title Preview. Proposal draft destinations and Power Automate submission remain pending. The [historical proposal-context extraction design](PROPOSAL_CONTEXT_EXTRACTION_PLAN.md) does not gate the current pilot. J27 shared extraction remains an open product decision.

### Historical decisions and production probe

Session 102 (2026-04-16) chose full Power Automate composition to make the
flow easier for Connor to debug in one place and remove a Vercel runtime
dependency. Session 109 proposed a matching `ExecutePrompt` child flow.
A read-only production probe on 2026-07-27 scanned 114 cloud-flow definitions
visible to the Dataverse application user. None referenced `wmkf_ai_*`
fields or tables, Executor routes, Claude/Anthropic, or the WMKF Vercel app.
This was a dated probe of visible definitions. The owner superseded the
Power Automate-native design on 2026-11-10.

> **Later Grant Reporting direction (owner, 2026-10-21):** the standalone Grant Reporting app is out of date; the owner intends to integrate useful features elsewhere, but destination, scope, and timing remain undecided and no implementation has been requested. The active app still exists, but this older roadmap's Grant Reporting placement and any assumed PA/UI writeback destination are not current direction. See `.claude-memory/project-grant-reporting-rework.md`. Interim-report evaluation also remains undecided pending that product-direction review; see `.claude-memory/project-interim-report-automation.md`.

### Human-Initiated Tasks (Vercel App → Dynamics)

Staff use the Vercel app for tasks requiring judgment:
- Reviewer finding with specific expertise criteria
- Review management and materials distribution
- Integrity screening
- Virtual review panels
- Ad-hoc proposal summarization and analysis

Where their implementation contracts call for it, reviewer-finding and review-management operations write their authoritative records to Dynamics (write permissions granted; `createRecord` / `updateRecord` shipped — the earlier "once write permissions are granted" gate cleared). Persistence is capability-specific; this is not a blanket claim for every human-initiated tool, and it does not describe Grant Reporting's extracted output, which currently returns to the UI. The service attempts best-effort `wmkf_ai_run` audit logging when a request GUID is supplied; it does not write extracted output to `akoya_request`.

### Prompt Development (Vercel App → Batch Evaluation)

New AI capabilities (compliance screening, PD assignment, staff matching) are developed by:
1. Building and testing prompts against historical proposals via batch evaluation tools in the Vercel app
2. Iterating with staff feedback until accuracy is acceptable
3. Publishing approved shared prompts and coordinating with Connor on the task keys used by the flows

---

## Phase 1: Prompt Development & Batch Evaluation

**Goal:** Build tools to develop, test, and validate prompts against historical proposals. Approved shared prompts are published in Dataverse and invoked by the backend.

**AI tasks to develop prompts for (ordered by lifecycle priority):**
1. **Compliance checking** — does the application meet Foundation requirements? (lifecycle step 4)
2. **Summary + keyword extraction** — generate summary and keywords for Dynamics fields (lifecycle step 4)
3. **PD assignment by specialty area** — route proposals to the right program director (lifecycle step 6, rules to be built from scratch)
4. **Phase II compliance** — similar to Phase I but requirements may differ (lifecycle step 14)
5. **Staff-proposal matching** — route to staff lead, flag for consultant, identify relevant board members. **Now powered by the Expertise Finder app** (`pages/expertise-finder.js`) with the roster managed in Vercel Postgres (`expertise_roster` table). Prompt text and model live in the `expertise-finder.match` Dataverse prompt row, editable in Admin → Prompt Templates (row definition: `shared/config/prompts/expertise-finder-dynamics.js`). Any future automation would need an approved backend task contract and an appropriate trigger.

### What to build

#### Batch evaluation tool
A Vercel app page + API endpoint that:
1. Queries Dynamics for historical proposals matching filter criteria (status, date range, program area)
2. Fetches PDFs from SharePoint via Graph API (read access already exists)
3. Extracts text with `pdf-parse`
4. Runs the prompt under development against each proposal
5. Generates CSV output: proposal info + AI assessment + actual outcome (for comparison)
6. Tracks results across prompt iterations for accuracy comparison

#### CSV output (compliance screening example)

| Column | Source |
|--------|--------|
| Request Number | Dynamics |
| PI / Institution | Dynamics |
| Proposal Title | Dynamics |
| Actual Outcome | Dynamics (`akoya_requeststatus`) |
| AI Assessment | Claude (compliant / flagged / inconclusive) |
| AI Reasoning | Claude (2-3 sentence explanation) |
| Criteria Matched | Claude (which specific criteria triggered the flag) |
| Confidence | Claude (high / medium / low) |

#### CSV output (staff matching example)

| Column | Source |
|--------|--------|
| Request Number | Dynamics |
| Research Area | Claude extraction |
| Recommended Staff Lead | Claude |
| Staff Lead Reasoning | Claude |
| Consultant Recommended? | Claude (yes/no + who) |
| Board Members with Expertise | Claude |
| Actual Staff Assignment | Dynamics |

#### Prompt iteration workflow
1. Develop prompt in code (`shared/config/prompts/`)
2. Run batch evaluation against historical proposals
3. Review CSV results with staff — annotate where AI was right/wrong
4. Refine prompt, re-run, compare improvement
5. When accuracy is acceptable, publish the shared prompt and give Connor the approved backend task key for the flow.

#### Vercel timeout management
- Large batches exceed the 300s function timeout
- Strategy: process in chunks of 5-10 proposals per API call
- Batch endpoint accepts `offset` and `limit` parameters
- Frontend handles pagination automatically
- Each chunk's results appended to the same output

### Data sources
- **Criteria documents:** Already digitized and available for compliance prompt context
- **Historical proposals:** Phase I proposals in Dynamics (current format, actively evolving)
- **Text-only extraction** at batch scale — `pdf-parse` strips images, keeping costs manageable
- **Staff matching rules:** Need to be built from scratch based on staff input about current routing practices

### Key files
- `shared/config/prompts/*.js` — existing prompt patterns to follow
- `lib/services/dynamics-service.js` — Dynamics read access (working)
- `lib/services/graph-service.js` — SharePoint document access (working)
- `shared/config/baseConfig.js` — cache patterns to reuse

**Dependencies:** None. Can start immediately.

---

## Phase 2: Dynamics Write-Back (Human-Initiated Tools)

**Goal:** When staff use Reviewer Finder, Review Manager, or other Vercel app tools, results flow back to Dynamics.

### Prerequisites (Connor)
- Grant write permissions on app registration `d2e73696-537a-483b-bb63-4a4de6aa5d45`
- Custom security role "App - Proposal Processing" with `prvUpdate` on `akoya_request` (at minimum)
- Potentially `prvCreate` if we need to create related records
- Scoped to specific tables (not blanket write access) for least privilege

### What to build
- ~~Un-stub `updateRecord()` and `createRecord()` in `dynamics-service.js`~~ **SHIPPED.** Both primitives are implemented in `lib/services/dynamics-service.js` (`createRecord` and `updateRecord` are live; they no longer throw). Subsequent endpoint integrations have also shipped (save-candidates writes Dataverse; reviewers.js is Dataverse-backed; send-emails creates email activities and lifecycle PATCHes via the adapter).
- ~~Add Dynamics write-back to existing endpoints~~ **SHIPPED in W3-W6 (2026-05-12):**
  - `pages/api/reviewer-finder/save-candidates.js` — writes to Dataverse via `potential-reviewer`, `researcher`, `reviewer-suggestion` adapters
  - `pages/api/review-manager/reviewers.js` — Dataverse-backed (status changes via `suggestionAdapter.updateLifecycle`)
  - `pages/api/review-manager/send-emails.js` — Dynamics email activity + Dataverse lifecycle PATCH via adapter
- Behind feature flag until ready *(no longer relevant; the writes are unconditional in the cutover endpoints)*

### Key files
- `lib/services/dynamics-service.js` — write methods are live (`createRecord`/`updateRecord` shipped — the earlier "stubbed; currently throw" status was historical). Existing auth token flow works.
- (Permission requests are tracked inline in `docs/STRATEGY.md` IT-dependency table; the historical `PENDING_ADMIN_REQUESTS.md` is in `docs/archive/` after all four asks resolved.)

**Dependencies:** ~~Connor grants write permissions~~ — granted; write primitives shipped.

---

## Phase 3: Data Migration to Dynamics

**Historical goal:** evaluate movement of selected operational data from
Postgres to Dataverse. This is not a mandate to migrate Postgres-owned
application/operational stores whose current Atlas pages keep them there.

> **Current boundary:** the historical reviewer-domain Postgres tables named
> below were migrated in W3–W6. Migration 018 dropped the person, publication,
> proposal-search, and suggestion tables; it explicitly retained
> `grant_cycles`, which remains drain-only while Dataverse
> `wmkf_appgrantcycle` is authoritative. The remaining operational tables below
> are still Postgres-owned; migration of those stores is not scheduled merely
> because this historical phase proposed it.

### Tables to migrate

| Table | Records | Purpose | Cutover status |
|-------|---------|---------|----------------|
| historical `researchers` | Expert profiles | Shared pool of reviewer candidates | dropped by migration 018; Dataverse `wmkf_potentialreviewer` is source of truth (S213: bibliometrics folded onto the person; the `wmkf_appresearcher` sidecar was dropped) |
| historical `publications` | Linked to researchers | Publication history | dropped by migration 018 |
| historical `reviewer_suggestions` | Per-user per-proposal | "My Candidates" saved reviewers | dropped by migration 018; Dataverse `wmkf_appreviewersuggestion` is source of truth |
| historical `proposal_searches` | Per-user | Proposal analysis results | dropped by migration 018; `extract-summary` endpoint retired |
| `grant_cycles` | Shared | Grant cycle definitions | drain-only post-W3; explicitly kept by migration 018; Dataverse `wmkf_appgrantcycle` is source of truth |
| `integrity_screenings` | Per-user | Screening history | Postgres-only (not yet migrated) |
| `screening_dismissals` | Per-user | False positive dismissals | Postgres-only (not yet migrated) |
| `panel_reviews` | Per-user | Legacy virtual review panel results (app retired 2026-10-04; table retained) | Postgres-only (not yet migrated) |
| `expertise_roster` | Shared | Internal reviewer/consultant/board roster (38+ entries) | Postgres-only (not yet migrated) |
| `expertise_matches` | Per-user | AI proposal-to-reviewer matching history | Postgres-only (not yet migrated) |

### What stays in Vercel Postgres
System/infrastructure data that has no Dynamics equivalent:
- `user_profiles` — Vercel-side identity (linked to Dynamics `systemuser` via `dynamics_systemuser_id`)
- `dynamics_user_roles`, `dynamics_restrictions` — Dynamics Explorer permissions
- `api_usage_log`, `dynamics_query_log` — usage tracking
- `system_alerts`, `health_check_history`, `maintenance_runs` — monitoring
- `dynamics_feedback` — Dynamics Explorer feedback
- `retractions` — Retraction Watch reference data (~63K rows)

(Wave 1 retired 2026-05-12: `user_preferences`, `user_app_access`, `system_settings` moved to Dataverse `wmkf_appuserpreferences`, `wmkf_appuserappaccesses`, `wmkf_appsystemsettings`.)

### Prerequisites (Connor)
- ~~Create corresponding entities/fields in Dynamics for each table above~~ — done for the reviewer-domain entities (`wmkf_potentialreviewer` — now also carrying bibliometrics after the S213 `wmkf_appresearcher` sidecar collapse — `wmkf_appreviewersuggestion`, `wmkf_appgrantcycle`, `wmkf_apprequestperson`). Pending: integrity / panel-review / expertise entities (no scheduled work).
- ~~Define the Dynamics schema for reviewer data, screening results, etc.~~ — reviewer schema shipped (Wave 2). Screening / panel / expertise schemas not yet defined.

### Migration strategy

**SHIPPED for reviewer-domain application paths:** W3–W6 cut over the
endpoints, and migration 018 later dropped the historical person,
publication, proposal-search, and suggestion tables. Dataverse is the current
person/suggestion/grant-cycle source of truth. Postgres `grant_cycles` remains drain-only;
its destructive retirement still requires
the separately documented carryover checks in
`docs/atlas/postgres-grant-cycles.md`.

For the remaining Postgres-only tables (integrity, panel, expertise), the same per-table cut-over pattern applies when scheduled.

**Dependencies (residual):** Connor creates Dynamics entities for the not-yet-migrated tables.

---

## Phase 4: PowerAutomate Flow Configuration

**Goal:** Configure the Power Automate lifecycle triggers and follow-up flows. The backend owns shared execution and publication.

### Broader lifecycle flow candidates

The following candidates preserve the earlier lifecycle roadmap. The first
shared backend pilot covers Executive Summary and Methodology.

| Flow | Trigger | AI Task | Status |
|------|---------|---------|--------|
| Phase I file organization | Request created, `Phase I Status = Pending Committee Review` | — | Planned |
| Phase I AI check-in | File organization complete | Claude: compliance + summary + keywords | Planned |
| Phase I staff version | AI check passes compliance | — (PDF formatting) | Planned |
| PD assignment | After application deadline (batch) | Claude: assign PD by specialty | Planned |
| Phase II file organization | `Phase II Status = Phase II Pending Committee Review` | — | Planned |
| Phase II AI check-in | File organization complete | Claude: compliance (+ TBD) | Planned |
| Phase II staff version | AI check passes compliance | — (PDF formatting) | Planned |

### Planned flow architecture

```
Dataverse lifecycle trigger
  → Authenticated backend submit for approved task keys
  → Poll authenticated status using the returned job ID
  → Branch on the job outcome and notify the appropriate staff
```

Trigger conditions and approved tasks are configured with Connor. Justin
owns the shared job service and approved prompt/task configuration. Connor
owns Power Platform triggers, authentication setup, and business follow-up.

**Dependencies:** the approved backend job contract, connection setup, and
published task configuration. The synthetic trial can run before the real
Request-field mappings are complete. Production writeback requires the
reviewed mappings and the destination-specific conditional write contract.

---

## Phase 5: Operational Maturity

**Goal:** Production-grade monitoring, retry, and visibility.

- **Processing dashboard** on admin page: view batch evaluation results, track prompt accuracy across iterations
- **Alerting:** Extend existing `AlertService` for processing failures, Dynamics write errors
- **Monitoring:** PowerAutomate flow run history (native in Power Platform) + Vercel app health checks

**Dependencies:** Phases 1-4 in production.

---

## Sequencing & Dependencies

```
Can start now:
  Phase 1: Prompt Development & Batch Evaluation
  Phase A: CRM Email Send (existing plan, independent)

Connor (parallel):
  Create custom fields on akoya_request for AI outputs
  Draft Power Automate trigger and follow-up logic
  Grant write permissions on app registration

After the shared job and endpoint contract is implemented:
  Phase 4: Connect Power Automate triggers and test submit/status with synthetic inputs
  Enable real tasks after prompt validation and destination mapping

~~When Connor grants write permissions~~ — granted (S77 era):
  Phase 2: Dynamics Write-Back (human-initiated tools) — SHIPPED

After Phase 2 + Connor creates Dynamics entities:
  Phase 3: Data Migration to Dynamics — reviewer-domain SHIPPED W3-W6 (2026-05-12); integrity/panel/expertise tables remain Postgres-only.

Ongoing:
  Phase 5: Operational Maturity
```

---

## Connor's Admin Actions

All within Connor's access — no external IT or vendor dependencies.

1. **Custom fields on `akoya_request`** for AI outputs — fields spec'd in `docs/GRANT_CYCLE_LIFECYCLE.md`
2. **Write permissions** for app registration — custom security role with `prvUpdate` on `akoya_request`. App ID: `d2e73696-537a-483b-bb63-4a4de6aa5d45`
3. **Dynamics entities** for data migration — schema for reviewer data, screenings, panel reviews, etc.
4. **Power Automate flows** — configure triggers and status handling for approved backend task keys
5. **Premium connectors** — available, no licensing blocker
6. **Pending from previous sessions:** None as of 2026-05-08 — all original asks resolved (Email Sender role granted; `Sites.Selected` read + write granted; Contact AppendTo granted; Mail.Send retired). See `docs/archive/PENDING_ADMIN_REQUESTS.md` for history.

---

## Verification Plan

- **Phase 1:** Batch evaluation produces CSV with AI assessments alongside actual outcomes; staff confirm accuracy is acceptable
- **Phase 2:** Save reviewer candidate in UI → verify data appears in Dynamics
- **Phase 3:** Migrate test data → verify Vercel app reads from Dynamics correctly
- **Phase 4:** Use a synthetic event to verify authenticated submit, repeat delivery, status polling, and terminal outcome handling. Verify real Request writeback after field mappings and write policies are approved.
- **Phase 5:** Deliberately fail a processing job → verify alert fires

---

## Key Files Reference

| File | Role in This Plan |
|------|-------------------|
| `shared/config/prompts/*.js` | Prompt development (Phase 1) |
| `lib/services/dynamics-service.js` | Dynamics read access (Phase 1, shipped), write primitives `createRecord`/`updateRecord` shipped (Phase 2). |
| `lib/services/graph-service.js` | SharePoint document access (Phase 1) |
| `shared/config/baseConfig.js` | Cache patterns to reuse |
| `pages/admin.js` | Batch evaluation UI (Phase 1), processing dashboard (Phase 5) |
| `pages/api/reviewer-finder/save-candidates.js` | Dynamics write-back SHIPPED (Phase 2 / W2-W3); writes to `wmkf_potentialreviewer` (identity + bibliometrics, post-S213 collapse) + `wmkf_appreviewersuggestion` |
| `pages/api/review-manager/reviewers.js` | Dynamics-backed (W3-W6 / S164); status updates via `suggestionAdapter.updateLifecycle` |
| `docs/GRANT_CYCLE_LIFECYCLE.md` | Full lifecycle reference |
| `docs/archive/PENDING_ADMIN_REQUESTS.md` | Historical permission requests (all resolved as of 2026-05-08) |
| `docs/archive/CRM_EMAIL_SEND_PLAN.md` | Phase A, independent but complementary (archived; shipped S77) |
