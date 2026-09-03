---
title: Application State Atlas
domain: dataverse
kind: source-of-truth
status: canonical
summary: "Created: 2026-05-07 (S137, Phase 1 of docs/CLAUDE_REMEDIATION_PLAN.md) Probe scripts: scripts/audit-postgres-state.js,..."
canonical: true
cataloged: 2026-07-02
owner: product-engineering
last_verified: 2026-09-03
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
| `wmkf_appreviewanswer` | — | **[CREATED prod S301; R/W LIVE S302; WAVE 25 + TEMPLATE OUTPUTS PRODUCTION-LIVE 2026-09-03]** point-in-time answer-snapshot child of `wmkf_appreviewersuggestion` (one row per question per submitted review). WRITE: `/api/external/review/[token]/submit` and staff receipt paths upsert rows by alternate key. READ: `/api/review-manager/reviewers` GET attaches keyed child rows for the Workbench. The owner-approved Wave 25 Production apply created the exact nullable `wmkf_questionoptions` Memo field for full categorical option snapshots. Compatible writers/readers and both template-backed DOCX paths are live at `3101f067`; signed-in Request `1002903` proved the combined export, while the courtesy path was not transport-smoked. | [dataverse-wmkf-appreviewanswer.md](atlas/dataverse-wmkf-appreviewanswer.md) |
| `wmkf_reviewquestion` | 23 total (12 active, 11 inactive) | **[LIVE through S305; production re-probed 2026-07-26]** staff-editable review-form question set, system of record for *which* questions the form asks. READ: `lib/external/review-question-fetcher.js` (cached, fail-closed) supplies the live reviewer context/draft/submit flow. WRITE: controlled seed plus the live superuser editor (`/admin` → Review Questions), which atomically creates, updates, reorders, or soft-deletes rows and records `review_question_audit`. Snapshot (`wmkf_appreviewanswer`) preserves history so the set edits live. | [dataverse-wmkf-reviewquestion.md](atlas/dataverse-wmkf-reviewquestion.md) |

### Vendor entities (master records)

| Entity | Rows | Status | Page |
|---|---:|---|---|
| `akoya_request` | 5,000+ | master grant-request record | [dataverse-akoya-request.md](atlas/dataverse-akoya-request.md) |
| `contact` | 5,000+ | reviewer promotion target | (covered in adapter `lib/dataverse/adapters/contact.js`) |
| `account` | 4,601 | organization pivot | (Wave 2 intake portal will extend) |
| `systemuser` | 222 | internal staff | (used for impersonation; see `dataverse-identity-map.js`) |
| `emails` / `activitymimeattachments` | probe required | Standard Dynamics outbound email activity and attachment records. Existing guarded transport writes remain in `DynamicsService`; Pre-Site distribution reads exact activity/status/attachment recovery state through `email-activity.js`. Request `1002379` base PDF send and the 2026-08-25 calendar/material send are Production-proved through Dynamics transport acceptance; inbox/calendar-client delivery remains a separate observation. | (covered in adapter `lib/dataverse/adapters/email-activity.js`) |
| `wmkf_ai_run` | probe required | append-only AI invocation audit ledger; includes governed Production Request `1002379` Pre-Site v3 run `ba0f42b9-849a-f111-b8db-6045bd008868` plus the earlier controlled attempts | [dataverse-wmkf-ai-run-and-prompt.md](atlas/dataverse-wmkf-ai-run-and-prompt.md) |
| `wmkf_ai_prompt` | 24 (2026-08-18 PT: prior 23 rows plus successful immutable Pre-Site v4 publication) | staff-editable prompt rows for Executor; includes governed `initial-assessment.generate` v1 and sole-current `pre-site-visit.proposal-core.generate` v4 | same page |
| `wmkf_appsystemsetting` | probe required | Shared Dataverse settings store. **[PRODUCTION-DEPLOYED AND OWNER-VIEWED 2026-08-30; no durable budget revision published]** Executor standing/retry budgets use append-only keys `executor.budgets.vNNNNNN`; the highest valid revision is the mutable source, while code owns strict bounds and the outage fallback. **[PRODUCTION-LIVE V2 2026-09-01 UTC]** `final_writeup.matrix_audiences` stores explicit GUID-only persona/no-lens assignments plus broad Grant Program reviewer audiences under one ETag. The dry-run-first operator command upgraded once from `W/"96930393"`; exact readback proved v2 at `W/"96944113"`, all 11 current reviewer-role assignments, zero stale/unassigned rows, and unchanged nine-person Research/six-person Southern California audiences. Commit `84bf465b` in Ready deployment `dpl_41SybgPYfJXGarf7UqcMGCLMy4KS` is the v2-capable rollback floor. Live Dataverse names and current reviewer-role/program eligibility remain authoritative; persona lenses remain disabled. | [dataverse-wmkf-ai-run-and-prompt.md](atlas/dataverse-wmkf-ai-run-and-prompt.md) |
| `wmkf_granteedeliverable` | 14 | **LIVE S271** grantee deliverable package lifecycle/image/date side table; production schema and service-principal CRUD verified; row count refreshed 2026-08-12 via `check:memory-drift` | [dataverse-wmkf-granteedeliverable.md](atlas/dataverse-wmkf-granteedeliverable.md) |
| `wmkf_finalwriteupreviewacknowledgement` | 1 (2026-08-31 readback) | **[PRODUCTION-PROVED 2026-08-31.]** Wave 23 metadata is 11 exact / 0 absent / 0 divergent / 0 pending and the Final-document + reviewer alternate-key index is Active. Production readiness is exact `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`; Preview remains unset. Signed-in dashboard and Request `1002788` Final reads first proved retained Word access and responsible-PD exclusion. An eligible colleague's pre-role POST then failed with missing acknowledgement Create and persisted no partial row. After the dedicated reviewer role became effective for all 11 audience members, the colleague retry succeeded and appeared in review history; independent readback proved exactly one complete acknowledgement row with all required stable file/version observation fields populated. Dataverse attached nine standard App Opener baseline privileges when creating the role; none grants Delete, Assign, Share, or Request Document write. | [dataverse-wmkf-finalwriteupreviewacknowledgement.md](atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md) |
| `wmkf_sitevisit` | 1 active row for Production Request `1002379` (2026-08-25 readback) | Existing custom Activity now owns Site Visit schedule, format, IANA zone, location/link, organizer/attendee ActivityParty rows, and a server-owned immutable-reference map. Wave 21 is exact in sandbox and Production; reversible sandbox create/replace/delete proof passed. **[PRODUCTION-PROVED 2026-08-25]** signed-in save/readback confirmed Site Visit `11b41d73-02a0-f111-b8dc-6045bd018a07`, exact Request binding, active state, persisted logistics fields, and five ActivityParty rows. | [dataverse-wmkf-sitevisit.md](atlas/dataverse-wmkf-sitevisit.md) |
| `wmkf_requestdocument` | 12 (2026-08-31 census: 3 Initial Assessments, 8 Pre Site Visits, 1 Final Writeup; 11 Ready/1 Failed; lifecycle 4 Draft/3 Superseded/2 Board Ready/1 Final/1 Review) | **LIVE PRODUCTION SCHEMA + CONTROLLED INITIAL-ASSESSMENT, PRE-SITE, AND FINAL PROOF.** Initial Assessment restore/Board-freeze controls remain deployed/read-smoked but not Production-write-exercised. Wave 19 provides the Pre-Site section/snapshot fields and current Pre-Site/Final pointers. Request `1002379` proved generation, Site Visit handoff, guarded reopen, and frozen distribution. **[PRODUCTION-PROVED 2026-08-30 PT / 2026-08-31 UTC]** Wave 22 is 4 exact / 0 divergent, `FINAL_WRITEUP_SCHEMA_READY` is literal `on`, and Slice 1 is Ready in deployment `dpl_7kzQ1v7XGtyNx4Fady2JxMrTxQEJ` on `ebb147bb`. Authorized Request `1002788` retained current Pre-Site row `7b059a2f-19a3-f111-b8dd-000d3a5bbe46` at Ready/Final and created current Final row `b6d6220b-f0a4-f111-b8dd-70a8a59cded0` at Ready/Review with Justin Gallivan attribution at `2026-08-31T03:57:20Z`. Both rows reference the same 38,273-byte SharePoint item, version `1.0`, and governed hash; the request's distinct SharePoint-file count remained four. | [dataverse-wmkf-requestdocument.md](atlas/dataverse-wmkf-requestdocument.md) |

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
| Dynamics Explorer state | `dynamics_explorer_requests`, `dynamics_query_log`, `dynamics_feedback`, `dynamics_user_roles`, `dynamics_restrictions` — migration 033 applied and was schema/tracker-read-back in Production on 2026-08-21; one signed-in request proved exact lifecycle/query/usage joins | same |
| Expertise Finder | `expertise_roster`, `expertise_matches` | same |
| Integrity Screener | `integrity_screenings`, `screening_dismissals`, `retractions` | same |
| Virtual Review Panel | `panel_reviews`, `panel_review_items` | same |
| Intake portal (pre-pilot) | `intake_drafts`, `intake_audit` | same |
| Portal upload staging | `portal_upload_staging` (private Blob ownership, finalize lease/idempotency, candidate reconciliation; no published content authority) | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| External reviewer acceptance follow-up | `reviewer_acceptance_jobs` (post-accept side-effect queue; Dataverse suggestion row remains accepted-state source) | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| Review synthesis lifecycle | `review_synthesis_jobs` (generation queue/currentness ledger; no review text; Dataverse request memo remains content source) — **[VERIFIED 2026-07-28 via controlled automatic smoke and post-deploy probes] migration 028 applied; Production automation enabled; job `2` completed in one claim with AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6`; exact cleanup returned zero eligible requests; final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` Ready** | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| Pre-Site informational distribution | `pre_site_distribution_attempts` (exact preview, cross-system send recovery, transport receipt; no attachment bytes) — **[VERIFIED LIVE 2026-08-25: migration 035 applied; 66 columns including 11 calendar/Site Visit/material additions; base and calendar/material sends for Request `1002379` reached `sent`]** | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| Personalized scheduled email | `scheduled_email_messages` (exact editable draft, approval state, PD action/version audit, digest FYI receipt, send lease, Dynamics activity/transport receipt, Dataverse finalization repair) + `scheduled_email_vip_flags` (per-(PD, contact) review flags) — **[SOURCE-BUILT 2026-08-26; migration 036 NOT applied or production-proved]** | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| External reviewer authoring | `review_drafts` (autosave scratchpad; Dataverse `wmkf_appreviewanswer` is the submitted system of record) | [postgres-review-drafts.md](atlas/postgres-review-drafts.md) |
| Monitoring | `health_check_history`, `system_alerts`, `maintenance_runs`, `api_usage_log` | same |
| Operational observability | `operational_events` (migration 030; app-recorded failures/recoveries mirrored from `NotificationService.notify` + explicit seams, plus selected Vercel Log Drain rows via `/api/webhooks/vercel-log-drain`; admin surface `/api/admin/operational-events`) | [postgres-infra-tables.md](atlas/postgres-infra-tables.md) |
| BILL.com | `bill_webhook_events` (webhook dedup), `bill_onboarding_state` (honorarium onboarding durable state) | same |
| Reviewer identity resolver observability | `reviewer_identity_shadow_log` (best-effort legacy/works/combined comparison log; migration 026 applied to production 2026-07-19) | [postgres-reviewer-identity-shadow-log.md](atlas/postgres-reviewer-identity-shadow-log.md) |

## Adapter inventory (`lib/dataverse/adapters/`)

**[VERIFIED 2026-08-31 via directory inventory]** The adapter layer contains
24 files:

`account.js`, `ai-prompt.js`, `ai-run.js`, `app-request-person.js`,
`contact.js`, `email-activity.js`, `final-writeup-review-acknowledgement.js`,
`grant-cycle.js`, `grant-program.js`, `grant-request.js`,
`grantee-deliverable.js`, `membership.js`, `policy.js`, `request-document.js`,
`potential-reviewer.js`, `proposal-budget-line.js`, `researcher.js`,
`review-answer.js`, `review-question.js`, `reviewer-suggestion.js`,
`sharepoint-document-location.js`, `site-visit.js`, `system-user.js`, and
`user-preference.js`.

The earlier four-adapter inventory and statement that grant cycles and
`akoya_request` had no adapters were superseded by the DAL migration. Read the
named adapter and its callers before changing a contract; this Atlas deliberately
does not duplicate every method signature.

## Service-layer inventory (`lib/services/`)

The high-leverage services for data-layer work — full source remains authoritative.

**Request Document actor correction (2026-08-31):** services pass the
session-derived Dynamics actor into Request Document writes, but the owner-run
census proved those writes fall back and standard `createdby`/`modifiedby`
name the service principal. References below to actor passthrough, redaction,
or validation do not establish correct human attribution on the Request
Document row. Final group-review fields, Final acknowledgement rows, and the
Pre-Site distribution ledger are explicit exceptions. Wave 24 is now
**Production-live**: independent metadata readback on 2026-08-31 reported 3
exact / 0 absent / 0 divergent, the Production-only readiness flag is exact
`on`, and commit `8ff4205a0ad43337cd987a4fc76639f936bab4bc`
first reached Ready deployment `dpl_D94J9aRcfLfK81iBDsVYARVhZFPb`. The
additive fields are server-controlled row-origin actor/time and a Site Visit
milestone actor. Signed-in health passed. Naturally generated Request `1002874`
then created one Ready/Draft Pre-Site row with explicit Justin Gallivan
`InitiatedBy`/`InitiatedAt`, application built-in creator, exact current pointer,
and no missing-attribution event. The deployment-boundary census is now 1
attributed / 0 event-backed unattributed / 0 violations. Site Visit milestone
attribution remains opportunistic proof on the next natural handoff. See
`docs/REQUEST_DOCUMENT_EXPLICIT_ACTOR_PLAN.md`.

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
| `final-writeup/acknowledgement-service.js` | none | `akoya_request`, `wmkf_requestdocument`, `systemusers`, and `wmkf_finalwriteupreviewacknowledgements`; Microsoft Graph separately | **[PRODUCTION-PROVED 2026-08-31.]** Fail-closed current-Final/reviewer resolution, one publication observation, responsible-PD exclusion, same-version no-restamp, conditional later-version replacement, and ambiguous-write reread. Production readiness is exact `on` in Ready deployment `dpl_B9k3AprnYp5ExpkqpT3dUxCUZqWo`; signed-in Request `1002788` readback first proved responsible-PD exclusion. An eligible colleague's missing-Create failure left no partial row; after the remediated role became effective for all 11 audience members, their retry succeeded and the review-history state plus exact persisted row passed independent readback. |
| `final-writeup/dashboard-service.js` | none | `akoya_request` including broad `wmkf_grantprogram`, `wmkf_requestdocument`, `systemusers`, current reviewer-role membership, `wmkf_appsystemsettings`, and `wmkf_finalwriteupreviewacknowledgements`; Microsoft Graph separately | **[PRODUCTION-LIVE V2 / PERSONAS DISABLED 2026-09-01 UTC.]** The proved matrix remains grouped by broad Grant Program. The deployed source can project explicit v2 PD/PC/Leadership unions, but the flag is false and disabled mode performs no staffing read or response change. Signed-in post-migration smoke proved the Research matrix still renders. Stale stored identities only narrow enabled runtime and surface warnings. |
| `final-writeup/matrix-audience-service.js` | none | reads active `wmkf_grantprograms`, exact enabled reviewer-role `systemusers`, and `wmkf_appsystemsettings`; superuser Admin save writes only `final_writeup.matrix_audiences` | **[PRODUCTION-LIVE V2 2026-09-01 UTC.]** V1 remains matrix-readable; only complete canonical v2 replacements are writable. V2 stores explicit GUID-only persona/no-lens rows and broad Grant Program audiences under one ETag. Publication rejects stale/incomplete references; runtime prunes stale current-role/program intersections with warnings. The operator command upgraded once from `W/"96930393"`; exact readback proved `W/"96944113"`, 11 complete assignments, zero stale/unassigned rows, and unchanged nine-person Research/six-person Southern California audiences. Admin reload reported **Published revision loaded**. |
| `app-access-service.js` / `dataverse-app-access-service.js` | none (Wave 1 Postgres table retired) | `wmkf_appuserappaccesses` | unsupported Postgres configuration fails loudly; the old PG branch has been removed |
| `settings-service.js` / `dataverse-settings-service.js` | none (Wave 1 Postgres table retired) | `wmkf_appsystemsettings` | unsupported Postgres configuration fails loudly; the old PG branch has been removed |
| `executor-budget-service.js` | none | `wmkf_appsystemsettings` (append-only `executor.budgets.vNNNNNN` rows) + `wmkf_ai_prompt` (current model reads at publication) | **[SOURCE-VERIFIED 2026-08-29.]** Superuser publication is create-only, version/idempotency guarded, model-ceiling checked, and reread-verified. Pre-Site and review synthesis consume the latest valid revision server-side; a settings failure uses bounded code fallback. |
| `dataverse-prefs-service.js` | — | `wmkf_appuserpreferences` | Postgres `user_preferences` dropped 2026-05-12 |
| `prompt-resolver.js` | none | **`wmkf_ai_run` scratch row** (read, 5-min cache) — NOT `wmkf_ai_prompt` (Session 103 holdover; will swap when v3 path matures) | falls back to bundled `.js` modules unless `PROMPT_RESOLVER_STRICT=true` |
| `execute-prompt.js` | none — calls Claude through `llm-client.js`, rejects unreviewed concrete prompt-row Claude ids, preserves joined text/stop metadata, and requires `end_turn` before persistence | `wmkf_ai_prompts` (read in `fetchCurrentPrompt()`), `akoya_requests` (read once up-front for the skip-if-populated guard in `preflightGuards()`; **coalesced write to the prompt's declared `target.field` via `persistOutputs()` → `DynamicsService.updateRecord`**), `wmkf_ai_runs` (one audit attempt per invocation in `writeRunRow()` with FKs to prompt + request) | Executor contract; **dynamically writes to `akoya_request` flat fields** (e.g. `wmkf_ai_summary`) only after terminal-response, parse, and local-schema validation. Prompt-level `generationMode:native-json-schema` is capability-gated. |
| `llm-client.js` / `model-capabilities.js` | `api_usage_log` (direct best-effort write via `usage-logger.js` when `appName` supplied; migration 032 added nullable provider `stop_reason` to Production and was schema/tracker-read-back on 2026-08-21; signed-in Explorer smoke rows 5354/5355 then proved non-null `tool_use`/`end_turn` persistence; migration 033 added nullable Explorer request/round correlation, and request `84aee86d-9c89-4434-9642-47ee6ccb4141` proved usage rounds 1–2 in Production) | none | canonical Anthropic wrapper plus reviewed model capability registry for request shaping, structured-output eligibility, limits, refusal semantics, and per-call completion metadata |
| `dynamics-explorer-request-telemetry.js` | `dynamics_explorer_requests` (R/W; migration 033 Production-applied 2026-08-21) | none | awaited fail-soft request start/finalization; atomic running→terminal compare-and-set with terminal-row recovery; stores bounded metadata only; signed-in Production smoke proved one completed two-round row |
| `intake-draft-service.js` | `intake_drafts` (R/W) | none | drafts cleared on submit |
| `review-draft-service.js` | `review_drafts` (R/W) | none | external reviewer review-form autosave scratchpad; submit maps draft → Dataverse `wmkf_appreviewanswer` then deletes the draft (Phase 3) |
| `review-synthesis-job-service.js` / `review-synthesis-drain.js` | `review_synthesis_jobs` (R/W) | `wmkf_appreviewersuggestion`, `wmkf_appreviewanswer`, `akoya_request`, and `wmkf_ai_run` through adapters/Executor | **[VERIFIED 2026-07-28 via signed-in Workbench readback, controlled automatic smoke, production Postgres/Dataverse readback, and post-deploy cron probe]** Migration 028 is live and Production automation is enabled. Job `2` completed in one claim with AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6`; exact temporary-review cleanup returned the census to zero eligible requests. PR #98 fixed the automatic Executor run-source contract; PR #99 makes a claimed job revalidate lifecycle readiness before content loading so vanished inputs cancel rather than retry. Final deployment `dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready. The table stores state/hashes only, never reviewer content; Dataverse `wmkf_reviewsynthesisjson` remains the synthesis source of truth. |
| `intake-audit-service.js` | `intake_audit` (write append-only) | none | sha256-hashed |
| `integrity-service.js`, `integrity-matching-service.js` | `integrity_screenings`, `screening_dismissals`, `retractions` | none — Postgres-only chain | imports only `@vercel/postgres`; no Dynamics client. UI may pass Dataverse-derived applicant data into the request body, but the service itself doesn't read `akoya_request`. |
| `panel-review-service.js`, `multi-llm-service.js` | `panel_reviews`, `panel_review_items` | none | Virtual Review Panel; Claude request shaping uses `model-capabilities.js` |
| `feedback-service.js` | `dynamics_feedback`, `dynamics_explorer_requests` | none | optional request correlation requires authenticated-profile ownership plus exact non-null session match; verification failure saves feedback uncorrelated |
| `notification-service.js`, `alert-service.js`, `maintenance-service.js`, `health-checker.js` | `system_alerts`, `health_check_history`, `maintenance_runs`, `dynamics_explorer_requests` | none | maintenance deletes Explorer request rows at the query-log retention horizon; feedback FK becomes null |
| `graph-service.js` | none | none (Microsoft Graph, separate token cache) | SharePoint files, including current metadata readback by stable drive/item identity, exact historical-version metadata/bytes, native version restore, create-only or replace path upload, and current-item PDF conversion |
| `external-token.js` | none (read/write live on `wmkf_appreviewersuggestion` extension fields) | `wmkf_appreviewersuggestion` | HMAC JWT primitive |
| `review-upload.js` | none | `wmkf_appreviewersuggestion` (PATCH) + SharePoint | shared writer for staff + reviewer paths |
| `grantee-deliverable-record.js` | none | `wmkf_granteedeliverable` | canonical package helper; read-only `getDeliverableForRequest()` never creates, staff write paths use `ensureDeliverableForRequest()` and `patchDeliverable()` |
| `initial-assessment/artifact-service.js` | none | `akoya_request`, `wmkf_requestdocument`, `wmkf_ai_prompt`, `wmkf_ai_run`, and SharePoint `akoya_request` | governed Initial Assessment producer/read model; requires exactly one active `AI Materials/ProposalNarrative_{Request#}.pdf` before side effects, exact retry convergence, Ready-row no-overwrite, atomic request-pointer/Ready/supersession activation, operator-visible retained-item cleanup work without silent eviction, and stable Graph identity. **[VERIFIED IN SOURCE 2026-08-16 via focused tests and read-only live Request `1002788` extraction]** the new exact AI input resolves with non-empty text. Historical Request `1002788` artifact generation preserves mechanics-only evidence from its earlier Phase I source; Request `1003109` production-proved the superseded outbound-package input contract and recovery mechanics. Production adds response-only Graph-current metadata overlay by stable identity, with explicit missing/unavailable fallbacks and no Dataverse write. Cleanup is manual (no drain). |
| `initial-assessment/controls-service.js` | none | `akoya_request`, `wmkf_requestdocument`, and SharePoint `akoya_request` | **[PRODUCTION-DEPLOYED + SIGNED-IN READ-SMOKED 2026-08-30; POST WRITES NOT PRODUCTION-EXERCISED.]** Superuser restore resolves the canonical request pointer, promotes one native historical version, verifies governed content, and ETag-refreshes registry metadata with lost-response reconciliation. Board freeze sends the exact current source buffer through create-only upload to one deterministic distinct Ready/Board Ready row/item linked to source row/version/hash; post-ingestion readback verifies normalized governed Word content so SharePoint repackaging is accepted while changed/invalid content, claim recovery, actor attribution, and exact cleanup ownership fail closed. |
| `pre-site-visit/proposal-core-service.js` / `artifact-service.js` / `docx-renderer.js` / `reopen-service.js` | none | reads `akoya_request`, applicant `account` (`akoya_aka`, `name`, city/state), Co-PI junction, exact Proposal Narrative, governed prompt, and Pre-Site registry/pointer state; POST writes governed run/document/pointer/SharePoint state; GET status writes nothing; reopen writes one successor row/item under literal-on Wave 20 readiness | **[PRODUCTION-PROVED 2026-08-23.]** Request `1002379` previously proved initial generation, exact Ready retry, and Ready/Review handoff. After exact owner approval, guarded reopen preserved and superseded that Review source, created current Ready/Draft successor `888982b6-0a9f-f111-b8dc-7ced8d3d15a6` plus one distinct SharePoint copy, and moved the request pointer. Exact unchanged retry reused the same row/item; Dataverse/Graph postcheck proved one cycle row and exact copied bytes. The producer's resilience, correction-cycle, lease, cleanup, actor-redaction, and fail-closed contracts remain as documented in the service catalog and Request Document Atlas page. |
| `pre-site-visit/distribution-service.js` / `distribution-store.js` | `pre_site_distribution_attempts` (R/W; migrations 034–035 live with base and calendar/material `sent` proofs) | reads current `akoya_request`/`wmkf_requestdocument` and optional `wmkf_sitevisit`; creates retained snapshot rows and granular Dynamics email/attachment/send activity | **[PRODUCTION-PROVED BASE AND CALENDAR/MATERIAL EXTENSION 2026-08-25.]** Request `1002379`, PDF-only operation `85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`, retained Ready/Board Ready DOCX and PDF rows and sent the selected 133,265-byte PDF to `jgallivan@wmkeck.org`. The ledger reached `sent`; Dynamics activity `33ce6346-d89f-f111-b8db-6045bd07a06d` read back Sent with actor attribution and exactly one attachment matching SHA-256 `574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`. Migration 035 adds exact material-link and informational-calendar snapshots, hashes, Site Visit ETag fencing, and a separate calendar-attachment receipt. Calendar/material operation `f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with one material, the saved Site Visit, and no final error. Both receipts prove Dynamics transport acceptance; inbox/calendar-client delivery is unverified. |
| `scheduled-email-service.js` / `scheduled-email-store.js` | `scheduled_email_messages` (R/W; migration 036 source-built, not applied) | reads fresh `wmkf_granteedeliverable`, mints grantee token only at send, creates/recovers Dynamics email activity, sends as the assigned PD, and finalizes Reminder Sent + `wmkf_remindeddate` | **[SOURCE-BUILT + UNIT-TESTED 2026-08-26; NOT LIVE.]** One row freezes the exact subject/body/signature/recipients and day-12 send time, freezes `approval_required` from the PD's review-all override + VIP flags, records edit/approve/stop actions with optimistic versioning, and stores send leases, digest FYI receipts, and transport receipts. The due-send claim refuses unapproved approval-required rows (PD send-now is the only bypass); due sends recheck source eligibility before transport; sent-but-unfinalized rows repair Dataverse without re-sending. ALL rows enter this path — the legacy direct route is deleted (**[SOURCE-BUILT 2026-08-26]** per `docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`). |
| `site-visit/logistics-service.js` / `recipient-directory-service.js` | `user_profiles` and `expertise_roster` (read; roster preferred email written by the existing Expertise Finder editor) | reads/writes one request-bound `wmkf_sitevisit`; reads `systemusers`, current Pre-Site state, and governed material rows | **[PRODUCTION-PROVED 2026-08-25.]** Requires Ready/Review Pre-Site state, literal schema readiness, server-resolved organizer/attendees, one active Site Visit, and ETag concurrency. Signed-in Request `1002379` save/readback confirmed one active request-bound row, persisted logistics fields, and five parties. Unchanged parties use parent PATCH; changed party roles use a sandbox-proved atomic delete/create of the same Activity GUID because direct ActivityParty writes are unsupported. |
| `site-visit/curated-recipient-service.js` | `user_profiles` (read only) | reads enabled `systemusers`, existing `contacts`, and `wmkf_appsystemsettings`; superuser save writes only `site_visit.distribution_recipient_directory` | **[VERIFIED IN SOURCE + LIVE FIELD-METADATA PROBE 2026-08-29.]** A capped versioned configuration stores only active profile IDs, Contact GUIDs, and consultant/board categories. Names and email addresses resolve live; unavailable identities remain visible to Admin for removal but are omitted from Workbench options. Contact search/read never creates or edits a Contact. The setting's value field is a 100,000-character Memo, comfortably above the capped reference payload. Attribute-level auditing is enabled, but entity-level auditing is currently disabled, so this feature does not claim captured Dataverse audit history. |
| `reviewer-finder/load-proposal-service.js` | none | `akoya_request` and SharePoint `akoya_request` | default ingestion prefers exactly one active `Reviewer Materials/Proposal_{Request#}.pdf`, then falls back only to exactly one active current-cycle `Phase I/ProjectDescription.pdf`; neither/ambiguity fails before download/Blob write and returns the server-listed picker data. Explicit server-listed `fileKey` supports deliberate historical/ad-hoc staff override. This Reviewer Finder compatibility rule does not change external reviewer-material visibility or governed Initial Assessment input. |
| `claude-reviewer-service.js` | none | none | legacy; new code uses `llm-client.js` |
| `discovery-service.js` external clients (`pubmed-service.js`, `openalex-service.js`, `arxiv-service.js`, `biorxiv-service.js`, `chemrxiv-service.js`, `orcid-service.js`, `serp-contact-service.js`) | none | none | external research-DB clients |
| `literature-search-service.js` | none | none | shared search shim |

## Endpoint inventory

For per-endpoint persistence info, see **`docs/API_ROUTE_SECURITY_MATRIX.md`**. The matrix has a registered structural check and is the canonical endpoint list; that check is run manually and by selected hooks/session workflows, but is not presently part of `.github/workflows/test.yml`. The Atlas defers to it rather than duplicating a count or route table. ~~**Atlas v1 gap:** the matrix doesn't yet annotate "writes Postgres `<table>` / Dataverse `<entity>`."~~ **Closed S141 (2026-05-08):** the matrix has a Persistence column for every registered route (PG = Postgres, DV = Dataverse). The current code-derived route-file count is maintained in [Canonical Counts](CANONICAL_COUNTS.md#api-route-file-count).

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
| `wmkf_appreviewersuggestion.wmkf_reviewsharepointfolder` | SharePoint beneath `akoya_request/{requestNumber}_{guidNoHyphensUpper}`: uploaded source review attempts use `Reviewer_Uploads/{reviewerSubfolder}`; generated structured copies use request-level `Reviews` | `lib/services/review-upload.js` writes uploaded source-review pointers; `lib/services/review-documents/individual-file-service.js` writes generated-copy pointers with filename `Review-<request>-<sanitized reviewer name>.docx`. Complete existing pointers always win, including legacy generated paths. Any plan that touches reviewer suggestions must preserve both pointer contracts or orphan SharePoint files. |
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
