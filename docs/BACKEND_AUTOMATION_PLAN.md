---
title: Long-Term Plan: Event-Driven Backend Automation via PowerAutomate
domain: general
kind: plan
status: active
summary: "Active PowerAutomate roadmap: Vercel prompt-storage and Executor foundations shipped; PA-owned automation and remaining execution extensions are still planned."
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

**Status:** Active roadmap. The Vercel-side prompt-storage and Executor foundation shipped;
the remaining work is Connor-owned PowerAutomate composition/operation plus the extensions
needed for backend-first automation. This plan retains the earlier architecture discussion as
historical context.
**Created:** Session 90, 2026-03-28
**Last Updated:** Session 94, 2026-04-08
**Stakeholders:** Justin (prompt development, Vercel app), Connor (PowerAutomate flows, Dynamics admin)

## Context

This project started as a personal workflow automation tool and has grown into a multi-user platform. Leadership wants key processing tasks (especially proposal summarization and compliance screening) to happen automatically when documents arrive in Dynamics/Dataverse — no manual uploads, no button clicks. Other tasks (reviewer finding, review management) remain human-initiated and write their authoritative reviewer state to Dataverse. This is a target for grant-processing outputs, not a universal persistence rule: Integrity Screener, Virtual Review Panel, operational queues, drafts, and observability retain documented Postgres ownership.

See `docs/GRANT_CYCLE_LIFECYCLE.md` for the full proposal lifecycle with stage-by-stage detail.

---

> **Update — Session 100, 2026-04-15:** Two design decisions taken since this plan was originally written change how Phase 1+ should be approached:
>
> 1. **Prompts move out of `.js` into a Dataverse `wmkf_ai_prompt` table** so PA can read them natively. (Shipped — Connor built the table as `wmkf_ai_prompt`, not the originally-proposed `wmkf_prompt_template`; the Executor service at `lib/services/execute-prompt.js` reads from it via the `wmkf_ai_prompts` entity set.) See `docs/PROMPT_STORAGE_DESIGN.md`. Affects Phase 1 (prompts under development now should be designed with the storage schema in mind) and Phase 4 (PA flow construction reads from this table, not from hard-coded text).
> 2. **Workflow chaining via structured outputs** — the first call in a backend lifecycle (e.g., Phase I writeup) produces structured fields that downstream calls (compliance, PD assignment, etc.) consume from Dynamics, rather than re-reading the proposal. See `docs/WORKFLOW_CHAINING_DESIGN.md`. Materially changes what the "Summary + keyword extraction" prompt should produce, and what intermediate Dynamics fields need to exist on `akoya_request` before downstream PA flows can chain.
>
> The "Hybrid vs. full PA composition" question was resolved in Session 102 (2026-04-16): **full PA composition**. PA owns the entire flow including direct Anthropic API calls. The architecture diagram below accurately reflects the chosen path.

> **Update — Session 110, 2026-04-25:** Phase 0 of the prompt-storage + Executor architecture is **shipped on the Vercel side**. Concrete state:
>
> 1. **`wmkf_ai_prompt` table is live** in Dynamics with a real seed row (`phase-i.summary`, GUID `d4201d8e-3840-f111-88b5-000d3a3065b8`). Seed script at `scripts/seed-phase-i-summary-prompt.js` is idempotent and round-trips cleanly. Field names finalized: `wmkf_ai_systemprompt`, `wmkf_ai_promptbody`, `wmkf_ai_promptvariables`, `wmkf_ai_promptoutputschema`, plus the new `wmkf_ai_Prompt` Lookup on `wmkf_ai_run` for provenance.
> 2. **`executePrompt()` Executor service** lives at
> `lib/services/execute-prompt.js` and implements the 10-step contract in
> `docs/EXECUTOR_CONTRACT.md`, including output guards
> (`skip-if-populated` / `always-overwrite` + `forceOverwrite`). It attempts an
> audit row for blocked, completed/needs-review, and thrown-failure outcomes,
> but audit persistence is fallible and a failure path can carry
> `runId = null`. Structured target writes also report per-output results and
> can return `allOk = false`; callers must not equate model completion with
> durable write success. Phase 0 source kinds were `dynamics`, `sharepoint`,
> and `override`; target kinds were `akoya_request` (with optional `$.foo`
> jsonPath) and `none`; parse modes were `raw` and `json`.
> 3. **Reference call site refactored** — `pages/api/phase-i-dynamics/summarize-v2.js` shrank from 292 → 145 lines and now does only Vercel-specific concerns (auth, rate limit, file load from `fileRef`, 409 shaping, per-user usage logging). UI compatibility preserved.
> 4. **Strategic shift on user-facing intake apps** — see `memory/project_phase_i_summary_app_winddown.md`. Phase I summary as a user-facing task is winding down post-May-2026 cycle; future intake prompts (compliance, fit-assessment, keywords) should be designed **backend-first** (PA-triggered) rather than as new Vercel routes. User-driven apps that tie into Dynamics (reviewer finder, Phase II tools, Expertise Finder, Grant Reporting, Review Manager) stay in active development.
>
> **Phase 1 implications for Connor:** the `ExecutePrompt` PA child flow builds against `docs/EXECUTOR_CONTRACT.md` — same 10 steps, same prompt-row schema, same `wmkf_ai_run` write contract. The Vercel implementation is the test oracle (echo-prompt parity). PA-side `forceOverwrite` defaults to caller's choice — see contract § "Notes for caller authors" for explicit guidance per parent flow type. The `phase-i.compliance` prompt row was deferred from Phase 0; when authored, it's a backend-first prompt.
>
> **Executor extensions still pending** before backend automation can do compliance/fit/keywords: native PDF input (`preprocess: pdf_native`), multi-output PATCH coalescing (current Executor's same-row second-PATCH would 412), Picklist-target output type. None blocking May 1; needed before backend intake automation.

> **Update — Session 103, 2026-04-17:** Three empirical findings affect PA flow design:
>
> 1. **`{{var}}` interpolation syntax verified on the Next.js side** (still needs a PA-side confirmation). Dataverse Memo fields holding `{{proposal_text}}`-style placeholders round-trip cleanly through OData — `{{` is not interpreted as an expression. See `docs/archive/CONNOR_QUESTIONS_2026-04-15.md` Q3.
> 2. **Historical Sonnet 4.6 observation (Session 103):** the April test measured an
> ~2,048-token effective floor. That is not current guidance: Anthropic now documents a
> 1,024-token minimum for Sonnet 4.6. PA flows must check the concrete model's current floor
> in [Anthropic's prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
> before deciding whether a marker is useful.
> 3. **Image handling creates a path asymmetry.** PA backend strips images in a pre-filter (lean, text-only); user-side Vercel paths likely keep PDFs with images intact. The cached content profiles differ significantly — a user-side PDF with figures may be 12–20K tokens vs. 5–7K text-only. Caching ROI is correspondingly higher on the user-side path.
>
> Related: Session 103 shipped a working prototype of the Dynamics-stored-prompt pattern against the Phase I test endpoint — see the "Session 103 prototype findings" section of `PROMPT_STORAGE_DESIGN.md`. **Update:** the Executor (`lib/services/execute-prompt.js`) is now the live prompt-execution path — it reads current prompt rows from Dataverse entity set `wmkf_ai_prompts` and writes audit rows to `wmkf_ai_runs`. The earlier `PromptResolver` service is a Session 103 holdover that reads a scratch row on `wmkf_ai_runs`; it is still in tree but is used only by scripts, not by live API routes.
>
> Also in Session 103: a **proposal context extraction plan** (`docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`) that extends the workflow-chaining idea for the upcoming single-phase cycle. Proposes ~15 structured fields the initial pass should extract so deep-dive calls (reviewer matching, panel review, compliance) read ~1.5K tokens of curated context instead of the full ~7K-token proposal. Compounds with expensive models and multi-LLM panel work. Not blocking v1; factored in when planning single-phase cycle Dynamics fields.

## Target architecture (Power Automate state externally unverified)

### Automated AI Tasks (PowerAutomate → Claude API → Dynamics)

The intended Power Automate flows handle automated backend processing:
1. Detect status change or document arrival in Dynamics
2. Fetch proposal PDFs from SharePoint
3. Call Claude API directly (HTTP connector with API key)
4. Write results back to Dynamics fields

Under the chosen target architecture, the Vercel app is **not in the loop** for
those automated tasks. The repository does not prove that the corresponding PA
flows, triggers, retries, or prompt-parity behavior are currently deployed.
Their live state is **UNKNOWN** pending a dated Power Platform probe.

> **Decision (2026-04-16, Session 102):** Full PA composition confirmed. PA owns the entire Claude call lifecycle for automated backend jobs — no Vercel dependency at runtime. This matches the original architecture above. Rationale: easier to debug PA-native flows, and backend automation is mission-critical. PA handles PDF extraction natively (confirmed 2026-04-15). Retry, `cache_control`, and JSON validation will be implemented in PA flows. See `PROMPT_STORAGE_DESIGN.md` for full decision record.

### Human-Initiated Tasks (Vercel App → Dynamics)

Staff use the Vercel app for tasks requiring judgment:
- Reviewer finding with specific expertise criteria
- Review management and materials distribution
- Integrity screening
- Virtual review panels
- Ad-hoc proposal summarization and analysis

Results from these tools flow back to Dynamics via direct API writes (write permissions granted; `createRecord` / `updateRecord` shipped — the earlier "once write permissions are granted" gate cleared).

### Prompt Development (Vercel App → Batch Evaluation)

New AI capabilities (compliance screening, PD assignment, staff matching) are developed by:
1. Building and testing prompts against historical proposals via batch evaluation tools in the Vercel app
2. Iterating with staff feedback until accuracy is acceptable
3. Handing proven prompts to Connor for deployment in PowerAutomate flows

---

## Phase 1: Prompt Development & Batch Evaluation

**Goal:** Build tools to develop, test, and validate prompts against historical proposals. Proven prompts are then deployed by Connor in PowerAutomate flows.

**AI tasks to develop prompts for (ordered by lifecycle priority):**
1. **Compliance checking** — does the application meet Foundation requirements? (lifecycle step 4)
2. **Summary + keyword extraction** — generate summary and keywords for Dynamics fields (lifecycle step 4)
3. **PD assignment by specialty area** — route proposals to the right program director (lifecycle step 6, rules to be built from scratch)
4. **Phase II compliance** — similar to Phase I but requirements may differ (lifecycle step 14)
5. **Staff-proposal matching** — route to staff lead, flag for consultant, identify relevant board members. **Now powered by the Expertise Finder app** (`pages/expertise-finder.js`) with the roster managed in Vercel Postgres (`expertise_roster` table). Prompt template at `shared/config/prompts/expertise-finder.js`. When validated, hand prompt to Connor for automated PowerAutomate flow.

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
5. When accuracy is acceptable, hand prompt to Connor for PowerAutomate deployment

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
| `panel_reviews` | Per-user | Virtual review panel results | Postgres-only (not yet migrated) |
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

**Goal:** Configure the automated AI processing flows in PowerAutomate. This is primarily Connor's work in the Power Platform.

### Flows to build

| Flow | Trigger | AI Task | Status |
|------|---------|---------|--------|
| Phase I file organization | Request created, `Phase I Status = Pending Committee Review` | — | Planned |
| Phase I AI check-in | File organization complete | Claude: compliance + summary + keywords | Planned |
| Phase I staff version | AI check passes compliance | — (PDF formatting) | Planned |
| PD assignment | After application deadline (batch) | Claude: assign PD by specialty | Planned |
| Phase II file organization | `Phase II Status = Phase II Pending Committee Review` | — | Planned |
| Phase II AI check-in | File organization complete | Claude: compliance (+ TBD) | Planned |
| Phase II staff version | AI check passes compliance | — (PDF formatting) | Planned |

### Flow architecture (each AI flow)
```
Dataverse trigger (status change on akoya_request)
  → SharePoint: get files from request folder
  → For each PDF:
    → SharePoint: get file content
    → HTTP: call Claude API directly (with proven prompt from Phase 1)
    → Parse response
    → Dataverse: update akoya_request with AI results
  → On failure: email Connor + Justin
```

### Trigger conditions
To be determined during flow construction — the proposal process is actively evolving, so exact status values and conditions will be customized as flows are built.

### Who does what
- **Justin:** develops and validates prompts (Phase 1), provides proven prompts for flows
- **Connor:** builds flows in Power Platform, configures triggers and Dataverse connectors, handles error notification routing

**Dependencies:** Phase 1 (proven prompts ready for deployment).

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
  Draft PowerAutomate flows (trigger logic, SharePoint file retrieval)
  Grant write permissions on app registration

After Phase 1 prompts are validated:
  Phase 4: PowerAutomate Flow Configuration (deploy prompts in flows)

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
4. **PowerAutomate flows** — build flows per Phase 4 specs using prompts developed in Phase 1
5. **Premium connectors** — available, no licensing blocker
6. **Pending from previous sessions:** None as of 2026-05-08 — all original asks resolved (Email Sender role granted; `Sites.Selected` read + write granted; Contact AppendTo granted; Mail.Send retired). See `docs/archive/PENDING_ADMIN_REQUESTS.md` for history.

---

## Verification Plan

- **Phase 1:** Batch evaluation produces CSV with AI assessments alongside actual outcomes; staff confirm accuracy is acceptable
- **Phase 2:** Save reviewer candidate in UI → verify data appears in Dynamics
- **Phase 3:** Migrate test data → verify Vercel app reads from Dynamics correctly
- **Phase 4:** Upload test proposal to Dynamics → verify AI results appear automatically via PowerAutomate flow
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
