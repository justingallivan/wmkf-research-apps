---
title: Application State Atlas
domain: dataverse
kind: source-of-truth
status: canonical
summary: "Created: 2026-05-07 (S137, Phase 1 of docs/CLAUDE_REMEDIATION_PLAN.md) Probe scripts: scripts/audit-postgres-state.js,..."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
last_verified: 2026-08-17
related:
  - docs/CLAUDE_REMEDIATION_PLAN.md
  - scripts/audit-postgres-state.js
  - scripts/audit-dataverse-state.js
  - docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md
---

# Application State Atlas

<!-- drain-table:file-purpose=atlas-state-page -->

**Created:** 2026-05-07 (S137, Phase 1 of `docs/CLAUDE_REMEDIATION_PLAN.md`)
**Probe scripts:** `scripts/audit-postgres-state.js`, `scripts/audit-dataverse-state.js`

## Claim labeling

Per remediation rule #1 (probe-before-plan), every state claim across the Atlas pages should be labeled:
- **[VERIFIED YYYY-MM-DD via X]** — actually probed (live audit, grep, file read)
- **[ASSUMED — per Y]** — sourced from a memory entry, design doc, or prior session decision; not re-verified

**Default:** unlabeled headers (Schema / Read paths / Write paths) are derived from probes; their content is verified unless explicitly marked otherwise. Migration-disposition / planned-additions / locked-decisions blocks are assumptions and labeled as such.

If a claim is unlabeled and you can't tell which kind it is, treat it as `[ASSUMED]` and probe before acting.

The canonical reference for the live state of the application's data layer.

> **How to use this:** before any data-layer plan claim ("X is the source of truth," "Y is empty," "Z has no Dataverse counterpart"), find the relevant per-entity page below and cite it. If the page is older than 60 days and the work is destructive, re-run the probe script first and update the page.

## Per-entity pages

### Reviewer-finder domain (Postgres)

| Table | Rows | Status | Page |
|---|---:|---|---|
| ~~`researchers`~~ | — | **DROPPED 2026-06-04 (S219)** via migration 018 (was 331 rows). Source of truth = Dataverse `wmkf_potentialreviewers`. | [postgres-researchers.md](atlas/postgres-researchers.md) |
| ~~`publications`~~ | — | **DROPPED 2026-06-04 (S219)** via migration 018 (was empty, dead writer) | [postgres-publications.md](atlas/postgres-publications.md) |
| ~~`researcher_keywords`~~ | — | **DROPPED 2026-06-04 (S219)** via migration 018 (was 1,028 rows; folded into Dataverse `wmkf_potentialreviewers.wmkf_keywords`) | [postgres-other-reviewer-tables.md](atlas/postgres-other-reviewer-tables.md) |
| ~~`reviewer_suggestions`~~ | — | **DROPPED 2026-06-04 (S219)** via migration 018 (was 337 rows; Dataverse `wmkf_appreviewersuggestion` is source of truth) | [postgres-reviewer-suggestions.md](atlas/postgres-reviewer-suggestions.md) |
| `grant_cycles` | 13 | drain-only post-W3 (2026-05-12); Dataverse `wmkf_appgrantcycle` is source of truth (10 rows). NOT dropped (separate domain, still draining). | [postgres-grant-cycles.md](atlas/postgres-grant-cycles.md) |
| ~~`proposal_searches`~~ | — | **DROPPED 2026-06-04 (S219)** via migration 018 (was empty, `extract-summary` endpoint retired) | [postgres-other-reviewer-tables.md](atlas/postgres-other-reviewer-tables.md) |
| `search_cache` | 0 | **KEPT — live cache** (0 rows but `DatabaseService.checkCache`/`cacheSearch` in pubmed/biorxiv/arxiv/chemrxiv + `/api/cron/maintenance` cleanup are live callers). Excluded from the S219 drop. | [postgres-other-reviewer-tables.md](atlas/postgres-other-reviewer-tables.md) |
| `reviewer_find_roster` | probe required | **ACTIVE operational roster cache/source for Workbench Find**; written and read through `reviewer-roster-store.js`, not a migration drain | [postgres-reviewer-find-roster.md](atlas/postgres-reviewer-find-roster.md) |

### Reviewer-finder domain (Dataverse)

| Entity | Rows | Status | Page |
|---|---:|---|---|
| `wmkf_appresearcher` | — | **DROPPED S213** — bibliometric sidecar collapsed into `wmkf_potentialreviewers` (17 fields folded onto the person); see `docs/archive/APPRESEARCHER_COLLAPSE_PLAN_V2.md` | (page removed) |
| `wmkf_appreviewersuggestion` | 793 (2026-08-15 PT snapshot) | active lifecycle ledger | [dataverse-wmkf-appreviewersuggestion.md](atlas/dataverse-wmkf-appreviewersuggestion.md) |
| `wmkf_potentialreviewers` (custom WMKF entity) | 4,427 | canonical reusable reviewer-person record; also carries the bibliometric fields (affiliation/h-index/citations/scholar/orcid/etc.) folded in from the dropped sidecar (S213) | [dataverse-wmkf-potentialreviewers.md](atlas/dataverse-wmkf-potentialreviewers.md) |
| `wmkf_apppublication` | — | **DROPPED S213** (was 0 rows, no callers) — went down with the appresearcher collapse | (page section removed) |
| `wmkf_appgrantcycle` | 10 | Dataverse-primary post-W3 (2026-05-12); full 11-attr schema deployed; consumed by reviewer-finder/grant-cycles + review-manager render/send-emails + maintenance-service blob-cleanup | same page |
| `wmkf_appproposalsearch` | 0 | DEPLOYED (S185), entity set is the unconventional `wmkf_appproposalsearchs`; verified S188 audit re-sweep 2026-05-25 | same page |
| `wmkf_app_z_publication_author` | n/a | NOT DEPLOYED | same page |
| `wmkf_apprequestperson` | 5,561 | active junction (S139); awaiting Connor PA dual-write | [dataverse-wmkf-apprequestperson.md](atlas/dataverse-wmkf-apprequestperson.md) |
| `wmkf_appreviewanswer` | — | **[CREATED prod S301; R/W LIVE S302]** point-in-time answer-snapshot child of `wmkf_appreviewersuggestion` (one row per question per submitted review). WRITE: `/api/external/review/[token]/submit` upserts the rows by alternate key in one atomic changeset (Phase 3). READ: `/api/review-manager/reviewers` GET, keyed child read by `_wmkf_appreviewersuggestion_value`, rendered in `ReviewsTab` (Phase 4) | [dataverse-wmkf-appreviewanswer.md](atlas/dataverse-wmkf-appreviewanswer.md) |
| `wmkf_reviewquestion` | 23 total (12 active, 11 inactive) | **[LIVE through S305; production re-probed 2026-07-26]** staff-editable review-form question set, system of record for *which* questions the form asks. READ: `lib/external/review-question-fetcher.js` (cached, fail-closed) supplies the live reviewer context/draft/submit flow. WRITE: controlled seed plus the live superuser editor (`/admin` → Review Questions), which atomically creates, updates, reorders, or soft-deletes rows and records `review_question_audit`. Snapshot (`wmkf_appreviewanswer`) preserves history so the set edits live. | [dataverse-wmkf-reviewquestion.md](atlas/dataverse-wmkf-reviewquestion.md) |

### Vendor entities (master records)

| Entity | Rows | Status | Page |
|---|---:|---|---|
| `akoya_request` | 5,000+ | master grant-request record | [dataverse-akoya-request.md](atlas/dataverse-akoya-request.md) |
| `contact` | 5,000+ | reviewer promotion target | (covered in adapter `lib/dataverse/adapters/contact.js`) |
| `account` | 4,601 | organization pivot | (Wave 2 intake portal will extend) |
| `systemuser` | 222 | internal staff | (used for impersonation; see `dataverse-identity-map.js`) |
| `wmkf_ai_run` | 380 (2026-08-16 PT snapshot) | append-only AI invocation audit ledger; includes both controlled Request `1002379` Pre-Site attempts | [dataverse-wmkf-ai-run-and-prompt.md](atlas/dataverse-wmkf-ai-run-and-prompt.md) |
| `wmkf_ai_prompt` | 23 (2026-08-16 PT derived from verified 22-row snapshot plus successful immutable v3 publication) | staff-editable prompt rows for Executor; includes governed `initial-assessment.generate` v1 and sole-current `pre-site-visit.proposal-core.generate` v3 | same page |
| `wmkf_granteedeliverable` | 14 | **LIVE S271** grantee deliverable package lifecycle/image/date side table; production schema and service-principal CRUD verified; row count refreshed 2026-08-12 via `check:memory-drift` | [dataverse-wmkf-granteedeliverable.md](atlas/dataverse-wmkf-granteedeliverable.md) |
| `wmkf_requestdocument` | 3 (2026-08-17 inventory) | **LIVE PRODUCTION SCHEMA + PARTIAL CONTROLLED INITIAL-ASSESSMENT PILOT.** Wave 19 adds the Pre-Site section/snapshot fields and current Pre-Site/Final pointers; the post-apply inventory remained three Initial Assessment rows and no Pre-Site row. Initial Assessment mechanics, lineage, recovery, editing, and current Graph metadata retain the production evidence described on the entity Atlas page. **[VERIFIED IN SOURCE/TESTS AND READ-ONLY LIVE PROMPT COMPARISON 2026-08-17; PRODUCTION GENERATION NOT YET PROVED]** the Pre-Site writer consumes Wave 19 and uses only the exact Proposal Narrative plus Dataverse. Sole-current prompt v3 already matches this narrative-only runtime contract. | [dataverse-wmkf-requestdocument.md](atlas/dataverse-wmkf-requestdocument.md) |

### Vendor entities — Dynamics Explorer read-only

The Dynamics Explorer (`pages/api/dynamics-explorer/chat.js`) traverses several vendor entities for natural-language queries. These are **read-only from the app's perspective** — no migration scope, no app-owned writes.

| Entity set | Purpose |
|---|---|
| `akoya_programs` | Grant program definitions; lookup target from `akoya_request.wmkf_grantprogram` |
| `akoya_requestpayments` | Per-request payment ledger; explorer payments tool reads here |
| `annotations` | Vendor-standard Dataverse notes entity; explorer annotations tool reads. App registration does NOT have `prvCreateNote` (per `project_dynamics_ai_writeback.md`) — read-only by design. |

Promote any of these to a per-entity page if app code starts writing to it.

### Other Postgres (compact summary, promote on touch)

| Group | Tables | Page |
|---|---|---|
| Identity (Postgres) + Wave 1 retired entries | `user_profiles` (live); `user_app_access`, `user_preferences`, `system_settings` (RETIRED 2026-05-12, now Dataverse-only) | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| Dynamics Explorer state | `dynamics_query_log`, `dynamics_feedback`, `dynamics_user_roles`, `dynamics_restrictions` | same |
| Expertise Finder | `expertise_roster`, `expertise_matches` | same |
| Integrity Screener | `integrity_screenings`, `screening_dismissals`, `retractions` | same |
| Virtual Review Panel | `panel_reviews`, `panel_review_items` | same |
| Intake portal (pre-pilot) | `intake_drafts`, `intake_audit` | same |
| External reviewer acceptance follow-up | `reviewer_acceptance_jobs` (post-accept side-effect queue; Dataverse suggestion row remains accepted-state source) | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| Review synthesis lifecycle | `review_synthesis_jobs` (generation queue/currentness ledger; no review text; Dataverse request memo remains content source) — **[VERIFIED 2026-07-28 via controlled automatic smoke and post-deploy probes] migration 028 applied; Production automation enabled; job `2` completed in one claim with AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6`; exact cleanup returned zero eligible requests; final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` Ready** | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| External reviewer authoring | `review_drafts` (autosave scratchpad; Dataverse `wmkf_appreviewanswer` is the submitted system of record) | [postgres-review-drafts.md](atlas/postgres-review-drafts.md) |
| Monitoring | `health_check_history`, `system_alerts`, `maintenance_runs`, `api_usage_log` | same |
| BILL.com | `bill_webhook_events` (webhook dedup), `bill_onboarding_state` (honorarium onboarding durable state) | same |
| Reviewer identity resolver observability | `reviewer_identity_shadow_log` (best-effort legacy/works/combined comparison log; migration 026 applied to production 2026-07-19) | [postgres-reviewer-identity-shadow-log.md](atlas/postgres-reviewer-identity-shadow-log.md) |

## Adapter inventory (`lib/dataverse/adapters/`)

**[VERIFIED 2026-07-29 via directory inventory]** The adapter layer contains
20 files:

`account.js`, `ai-prompt.js`, `ai-run.js`, `app-request-person.js`,
`contact.js`, `grant-cycle.js`, `grant-request.js`,
`grantee-deliverable.js`, `membership.js`, `policy.js`, `request-document.js`,
`potential-reviewer.js`, `proposal-budget-line.js`, `researcher.js`,
`review-answer.js`, `review-question.js`, `reviewer-suggestion.js`,
`sharepoint-document-location.js`, `system-user.js`, and
`user-preference.js`.

The earlier four-adapter inventory and statement that grant cycles and
`akoya_request` had no adapters were superseded by the DAL migration. Read the
named adapter and its callers before changing a contract; this Atlas deliberately
does not duplicate every method signature.

## Service-layer inventory (`lib/services/`)

The high-leverage services for data-layer work — full source remains authoritative.

| Service | Postgres tables touched | Dataverse access | Notes |
|---|---|---|---|
| `database-service.js` | `search_cache`, `user_profiles`, `api_usage_log`, etc. — researcher/publication/suggestion methods gutted W5 (commit `0c58da4`) | none | central Postgres gateway for the surviving tables; the Wave 1 `user_preferences` branch was removed after the table dropped |
| `discovery-service.js` | — (Postgres-researchers cache check removed in W5 commit `c0c5b5b`) | `wmkf_potentialreviewer` (indirect via picker flow) | previously called `DatabaseService.findResearcher` for the verification cache; PubMed verification is now unconditional |
| `deduplication-service.js` | — (Postgres-researchers lookup removed in W5 commit `c0c5b5b`) | none | previously called `DatabaseService.findResearcher` to attach `existing?.id`; merged candidates are now transient with no PG id |
| `contact-enrichment-service.js` | — (Postgres-researchers writer removed in W5 commit `c0c5b5b`) | `wmkf_potentialreviewer` (read+upsert identity + bibliometrics, S213) via adapter chain | enrichment writeback targets the person: `potentialReviewerAdapter.upsertByEmail` (identity) + `researcherAdapter.upsertByPotentialReviewer` (bibliometrics, now person-targeting post-collapse), gated on potentialreviewer-row existence |
| `dynamics-service.js` | none | all entities | canonical Dataverse client (OAuth, OData, search, email, `updateIfEmpty`, `logAiRun`, impersonation) |
| `dynamics-context.js` | none | all | AsyncLocalStorage scoping for restrictions |
| `dynamics-identity-service.js` | `user_profiles` (read) | `systemusers` (read) | impersonation contract (`MSCRMCallerID`) |
| `dataverse-identity-map.js` | `user_profiles` | `systemusers` | bridge resolver |
| `program-director-resolver.js` | none | `systemusers` (read) | email → `systemuserid` |
| `app-access-service.js` / `dataverse-app-access-service.js` | none (Wave 1 Postgres table retired) | `wmkf_appuserappaccesses` | unsupported Postgres configuration fails loudly; the old PG branch has been removed |
| `settings-service.js` / `dataverse-settings-service.js` | none (Wave 1 Postgres table retired) | `wmkf_appsystemsettings` | unsupported Postgres configuration fails loudly; the old PG branch has been removed |
| `dataverse-prefs-service.js` | — | `wmkf_appuserpreferences` | Postgres `user_preferences` dropped 2026-05-12 |
| `prompt-resolver.js` | none | **`wmkf_ai_run` scratch row** (read, 5-min cache) — NOT `wmkf_ai_prompt` (Session 103 holdover; will swap when v3 path matures) | falls back to bundled `.js` modules unless `PROMPT_RESOLVER_STRICT=true` |
| `execute-prompt.js` | none — calls Claude through `llm-client.js`, rejects unreviewed concrete prompt-row Claude ids, preserves joined text/stop metadata, and requires `end_turn` before persistence | `wmkf_ai_prompts` (read in `fetchCurrentPrompt()`), `akoya_requests` (read once up-front for the skip-if-populated guard in `preflightGuards()`; **coalesced write to the prompt's declared `target.field` via `persistOutputs()` → `DynamicsService.updateRecord`**), `wmkf_ai_runs` (one audit attempt per invocation in `writeRunRow()` with FKs to prompt + request) | Executor contract; **dynamically writes to `akoya_request` flat fields** (e.g. `wmkf_ai_summary`) only after terminal-response, parse, and local-schema validation. Prompt-level `generationMode:native-json-schema` is capability-gated. |
| `llm-client.js` / `model-capabilities.js` | `api_usage_log` (write via DatabaseService when `appName` supplied) | none | canonical Anthropic wrapper plus reviewed model capability registry for request shaping, structured-output eligibility, limits, and refusal semantics |
| `intake-draft-service.js` | `intake_drafts` (R/W) | none | drafts cleared on submit |
| `review-draft-service.js` | `review_drafts` (R/W) | none | external reviewer review-form autosave scratchpad; submit maps draft → Dataverse `wmkf_appreviewanswer` then deletes the draft (Phase 3) |
| `review-synthesis-job-service.js` / `review-synthesis-drain.js` | `review_synthesis_jobs` (R/W) | `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `akoya_request`, and `wmkf_ai_run` through adapters/Executor | **[VERIFIED 2026-07-28 via signed-in Workbench readback, controlled automatic smoke, production Postgres/Dataverse readback, and post-deploy cron probe]** Migration 028 is live and Production automation is enabled. Job `2` completed in one claim with AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6`; exact temporary-review cleanup returned the census to zero eligible requests. PR #98 fixed the automatic Executor run-source contract; PR #99 makes a claimed job revalidate lifecycle readiness before content loading so vanished inputs cancel rather than retry. Final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready. The table stores state/hashes only, never reviewer content; Dataverse `wmkf_reviewsynthesisjson` remains the synthesis source of truth. |
| `intake-audit-service.js` | `intake_audit` (write append-only) | none | sha256-hashed |
| `integrity-service.js`, `integrity-matching-service.js` | `integrity_screenings`, `screening_dismissals`, `retractions` | none — Postgres-only chain | imports only `@vercel/postgres`; no Dynamics client. UI may pass Dataverse-derived applicant data into the request body, but the service itself doesn't read `akoya_request`. |
| `panel-review-service.js`, `multi-llm-service.js` | `panel_reviews`, `panel_review_items` | none | Virtual Review Panel; Claude request shaping uses `model-capabilities.js` |
| `feedback-service.js` | `dynamics_feedback`, `dynamics_query_log` | none | |
| `notification-service.js`, `alert-service.js`, `maintenance-service.js`, `health-checker.js` | `system_alerts`, `health_check_history`, `maintenance_runs` | none | |
| `graph-service.js` | none | none (Microsoft Graph, separate token cache) | SharePoint files, including current metadata readback by stable drive/item identity |
| `external-token.js` | none (read/write live on `wmkf_appreviewersuggestion` extension fields) | `wmkf_appreviewersuggestion` | HMAC JWT primitive |
| `review-upload.js` | none | `wmkf_appreviewersuggestion` (PATCH) + SharePoint | shared writer for staff + reviewer paths |
| `grantee-deliverable-record.js` | none | `wmkf_granteedeliverable` | canonical package helper; read-only `getDeliverableForRequest()` never creates, staff write paths use `ensureDeliverableForRequest()` and `patchDeliverable()` |
| `initial-assessment/artifact-service.js` | none | `akoya_request`, `wmkf_requestdocument`, `wmkf_ai_prompt`, `wmkf_ai_run`, and SharePoint `akoya_request` | governed Initial Assessment producer/read model; requires exactly one active `AI Materials/ProposalNarrative_{Request#}.pdf` before side effects, exact retry convergence, Ready-row no-overwrite, atomic request-pointer/Ready/supersession activation, operator-visible retained-item cleanup work without silent eviction, and stable Graph identity. **[VERIFIED IN SOURCE 2026-08-16 via focused tests and read-only live Request `1002788` extraction]** the new exact AI input resolves with non-empty text. Historical Request `1002788` artifact generation preserves mechanics-only evidence from its earlier Phase I source; Request `1003109` production-proved the superseded outbound-package input contract and recovery mechanics. Production adds response-only Graph-current metadata overlay by stable identity, with explicit missing/unavailable fallbacks and no Dataverse write. Cleanup is manual (no drain). |
| `pre-site-visit/proposal-core-service.js` / `artifact-service.js` / `docx-renderer.js` | none | reads `akoya_request`, applicant `account`, Co-PI junction, exact Proposal Narrative, and governed prompt; writes `wmkf_ai_run`, `wmkf_requestdocument`, `akoya_request.wmkf_CurrentPreSiteVisit`, and one SharePoint Word item when generation succeeds | **[VERIFIED IN SOURCE/FOCUSED TESTS AND READ-ONLY LIVE PROMPT COMPARISON 2026-08-17; PRODUCTION GENERATION NOT YET PROVED.]** The durable writer requires the exact narrative identity before side effects, excludes the bibliography from prompt and generation identity, persists eight named fields plus immutable input/output snapshots, renders from Dataverse readback, uploads to `Artifacts/Pre-Site Visit/`, and atomically activates one current Ready Word row. Sole-current prompt v3 already matches the narrative-only runtime contract. |
| `reviewer-finder/load-proposal-service.js` | none | `akoya_request` and SharePoint `akoya_request` | default ingestion prefers exactly one active `Reviewer Materials/Proposal_{Request#}.pdf`, then falls back only to exactly one active current-cycle `Phase I/ProjectDescription.pdf`; neither/ambiguity fails before download/Blob write and returns the server-listed picker data. Explicit server-listed `fileKey` supports deliberate historical/ad-hoc staff override. This Reviewer Finder compatibility rule does not change external reviewer-material visibility or governed Initial Assessment input. |
| `claude-reviewer-service.js` | none | none | legacy; new code uses `llm-client.js` |
| `discovery-service.js` external clients (`pubmed-service.js`, `openalex-service.js`, `arxiv-service.js`, `biorxiv-service.js`, `chemrxiv-service.js`, `orcid-service.js`, `serp-contact-service.js`) | none | none | external research-DB clients |
| `literature-search-service.js` | none | none | shared search shim |

## Endpoint inventory

For per-endpoint persistence info, see **`docs/API_ROUTE_SECURITY_MATRIX.md`**. The matrix has a registered structural check and is the canonical endpoint list; that check is run manually and by selected hooks/session workflows, but is not presently part of `.github/workflows/test.yml`. The Atlas defers to it rather than duplicating a count or route table. ~~**Atlas v1 gap:** the matrix doesn't yet annotate "writes Postgres `<table>` / Dataverse `<entity>`."~~ **Closed S141 (2026-05-08):** the matrix has a Persistence column for every registered route (PG = Postgres, DV = Dataverse). The current code-derived route-file count is [149](CANONICAL_COUNTS.md#api-route-file-count).

For the reviewer-finder + review-manager subset, the per-entity pages above already enumerate read/write endpoints.

## Cross-system join keys

Useful summary of how Postgres ↔ Dataverse currently join (or will join post-cutover):

| Postgres key | Dataverse counterpart | Join field |
|---|---|---|
| `user_profiles.dynamics_systemuser_id` | `systemusers.systemuserid` | direct |
| ~~`researchers.email`~~ → `wmkf_potentialreviewers.wmkf_emailaddress` *(historical)* | — | Postgres `researchers` DROPPED 2026-06-04 (S219, migration 018); the de-dupe key now lives entirely in Dataverse. |
| ~~`reviewer_suggestions.request_number`~~ → `akoya_requests.akoya_requestnum` *(historical)* | — | Postgres `reviewer_suggestions` DROPPED 2026-06-04 (S219); join now via `wmkf_appreviewersuggestion`. |
| ~~`reviewer_suggestions.researcher_id` (→ email)~~ → `wmkf_appreviewersuggestion._wmkf_potentialreviewer_value` *(historical)* | — | Postgres `reviewer_suggestions` DROPPED 2026-06-04 (S219). |
| `grant_cycles` (entire table) | `wmkf_appgrantcycle` — **10 rows** (2026-05-14 audit), Dataverse-primary | migration complete (W3, 2026-05-12) |
| `wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` | SharePoint `akoya_request/{requestNumber}_{guidNoHyphensUpper}/Reviewer_Uploads/{reviewerSubfolder}` | written by `lib/services/review-upload.js`; any plan that touches reviewer suggestions must preserve this path or orphan the SharePoint files |
| `wmkf_ai_run.wmkf_ai_Prompt@odata.bind` | `wmkf_ai_prompt` | written by `lib/services/execute-prompt.js`; FK from audit row to source prompt |
| `wmkf_ai_run.wmkf_ai_Request@odata.bind` | `akoya_request` | written by `execute-prompt.js` + `dynamics-service.js logAiRun`; FK from audit row to processed request |
| ~~`proposal_searches.grant_cycle_id` → `grant_cycles.id`~~ *(historical)* | — | **No longer an application dependency.** The LEFT JOIN was retired in W3; `pages/api/reviewer-finder/grant-cycles.js` retains only a past-tense NOTE. `proposal_searches` was DROPPED 2026-06-04 (S219, migration 018). |

## "As-built vs. as-designed" reconciliation (Wave 2)

| Entity | Schema-as-code | Live deployment | Has data |
|---|---|---|---|
| `wmkf_appresearcher` | — | **DROPPED S213** (collapsed into `wmkf_potentialreviewers`) | — |
| `wmkf_appreviewersuggestion` | extension manifest | ✅ 52 attrs | ✅ 793 rows (2026-08-15 PT snapshot) |
| `wmkf_apppublication` | — | **DROPPED S213** | — |
| `wmkf_appgrantcycle` | ✅ 8 attrs | ✅ 10 attrs (different gap from Postgres) | ✅ 10 rows (2026-05-14 audit) |
| `wmkf_appproposalsearch` | ✅ | ✅ (entity set `wmkf_appproposalsearchs`, NOT `-es`) | empty |
| `wmkf_app_z_publication_author` | ✅ | ❌ NOT DEPLOYED | n/a |

## Known gaps in this Atlas (v1)

- ~~**Endpoint persistence annotation** not yet merged into `API_ROUTE_SECURITY_MATRIX.md`.~~ Closed S141 (2026-05-08).
- **Vendor `contact` and `account` extension fields** not enumerated yet — needed for intake portal pilot work (AO/Liaison fields per `project_intake_portal_pilot_decisions_2026-05-06.md`).
- **`wmkf_ai_prompt` and `wmkf_ai_run`**: per-entity page at [`atlas/dataverse-wmkf-ai-run-and-prompt.md`](atlas/dataverse-wmkf-ai-run-and-prompt.md). Both schemas are documented from live code in `execute-prompt.js` — prompt read in `fetchCurrentPrompt()`, run-row write with the prompt FK and an optional caller-supplied request FK in `writeRunRow()`.
- **`wmkf_apprequestperson` junction** — DEPLOYED S139 (`c8cbfe1`); 5,561 rows backfilled (`8b9b287`). Atlas page: [`atlas/dataverse-wmkf-apprequestperson.md`](atlas/dataverse-wmkf-apprequestperson.md). Steady-state still pending Connor's PA dual-write flows.
- **Intake portal slice-0 entities** — **DEPLOYED to prod Dataverse S178 (2026-05-22)** via `apply-dataverse-schema.js --wave=4 --execute`. The Item 6 pre-deploy gate **P1-Update closed FAIL** (Connor 2026-05-20) — a FAIL routes the recompute mechanism to the Option A′ fallback with zero schema rework, so it did not block the deploy. Entity sets `wmkf_proposalbudgetlines` / `wmkf_portalmemberships` confirmed live. Live Item 6 / PA-flow status: **`docs/INTAKE_PORTAL_BUDGET_ROSTER_RECONCILE_STATUS.md`**, authoritative. 2026-05-13 working names superseded by the 2026-05-14 schema review:
  - `wmkf_proposalbudgetline` (was `wmkf_budgetline`; absorbs cost-share — `wmkf_proposalcostshare` withdrawn) — spec `lib/dataverse/schema/wave4/wmkf_proposalbudgetline.json`, page [`atlas/dataverse-wmkf-proposalbudgetline.md`](atlas/dataverse-wmkf-proposalbudgetline.md).
  - `wmkf_portalmembership` — spec `lib/dataverse/schema/wave4/wmkf_portalmembership.json`, page [`atlas/dataverse-wmkf-portalmembership.md`](atlas/dataverse-wmkf-portalmembership.md).
  - Roster (`wmkf_personnel`) **withdrawn** — folded into `wmkf_apprequestperson` (3 nullable fields + `wmkf_role` enum 2→5, spec'd S155).
  - `akoya_request.wmkf_totalothersources` (Money) — spec `lib/dataverse/schema/wave4-existing/akoya_request-intake-aggregates.json`.
  - `wmkf_priorsupport` / `wmkf_milestone` — deferred post-pilot (narrative/PDF for pilot).
  - **Doc-vs-catalog gap (unresolved):** `contact.wmkf_portal_oid` + `akoya_request.wmkf_phaseiisubmittedat/by` appear in `INTAKE_PORTAL_DESIGN.md:621` next-steps but are absent from the authoritative 2026-05-14 catalog — needs Connor/owner reconciliation; not pulled into slice 0.
  Authoritative catalog: `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` 2026-05-14 entry.

## Probe re-run

```bash
node scripts/audit-postgres-state.js     # ~5s, free
node scripts/audit-dataverse-state.js    # ~10s, free, hits live tenant
```

Both scripts are read-only and idempotent.
