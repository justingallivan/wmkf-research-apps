# Atlas: `akoya_request` (Dataverse, vendor entity + WMKF extensions)

<!-- drain-table:file-purpose=atlas-state-page -->

**Last verified:** live shape 2026-05-07 via `scripts/audit-dataverse-state.js`; discriminator/era distributions 2026-05-15 via `scripts/probe-akoya-request-discriminators.js`; application routing 2026-07-27 via source and caller inspection; automatic review-synthesis lifecycle 2026-07-28 via the controlled Production smoke and exact cleanup; writeup document-authority/search interpretation reconciled 2026-07-28 against the governed artifact contract and Graph tenant probe; Initial Assessment canonical pointer provisioned and count-probed 2026-07-30
**Live row count:** **~25,561** (FetchXML aggregate, 2026-05-15). ⚠️ OData `/$count` returns **5,000** — Dataverse caps `$count` at 5,000; the "5,000" figure is the cap, not the total. Use FetchXML aggregate / RetrieveTotalRecordCount for the true count.
**Entity set:** `akoya_requests`

> ✅ **Label collision resolved 2026-05-26 (Connor walkthrough).** Set D now exclusively means PD Assignment (canonical: `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md`). The `wmkf_ai_fitassessment` + `wmkf_ai_fitrationale` pair has been relabeled to Set E — fields and deployment unchanged. Cross-doc references updated in this session; `check:memory-drift` should clear on next run.

## Source of truth

**Master grant-request record.** AkoyaGO-vendor-owned core fields + WMKF-added `wmkf_*` extension fields. The lifecycle pivot for proposals — Reviewer Finder, Review Manager, Phase I/II Summaries, Grant Reporting all read here.

**Application adapter:** `lib/dataverse/adapters/grant-request.js`. Domain routes call
services, and those services use the grant-request adapter for normal request reads
and writes. `DynamicsService` remains the underlying transport; Dynamics Explorer
uses its generic query surface rather than the domain adapter.

## Key fields (live, sample-probed 2026-05-07)

Identity / status:
- `akoya_requestid` (PK)
- `akoya_requestnum` (e.g. `1002787`) — natural join key; the dropped historical
  Postgres `reviewer_suggestions.request_number` column used it before the Dataverse cutover
- `akoya_title`
- `akoya_requeststatus` (String — `Concept Pending | Phase I Pending | Phase II Pending | Approved | Closed | Phase I Declined | ...`; there is **no live `Accepted`** value — an earlier draft listed one in error. Full live distribution + the decided-state class map are below.)
- `akoya_requesttype` (Picklist), `wmkf_request_type` (Picklist)
- `akoya_fiscalyear` (e.g. `December 2026`) — joins to `grant_cycles.short_code` via `cycle-code.js`
- `wmkf_meetingdate` (DateOnly)

Money / dates:
- `akoya_request` (requested amount), `akoya_paid`, `akoya_expenses`
- `akoya_loireceived`, `akoya_loiacknowledged`, `akoya_loirequestedamount`
- `akoya_begindate`, `akoya_enddate`
- `akoya_submitdate`, `akoya_submitdatetime`

People (lookups):
- `akoya_applicantid` → `accounts`
- `akoya_payee` → `accounts`
- `akoya_primarycontactid` → `contacts`
- `wmkf_projectleader`, `wmkf_researchleader`, `wmkf_ceo` → `contacts`
- `wmkf_copi1..5` → `contacts` (legacy 5-slot Co-PI roster — superseded by `wmkf_apprequestperson` junction since S139; intake portal pilot will extend that junction with `wmkf_effortpct` / `wmkf_biosketchurl` / `wmkf_lineorder` and expand `wmkf_role` to PI / Co-PI / Senior Personnel / Key Personnel / Other per 2026-05-14 schema review)
- `wmkf_potentialreviewer1..5` → `wmkf_potentialreviewers` (legacy slots — actual reviewer state lives in `wmkf_appreviewersuggestion`)
- `wmkf_programdirector` (lead PD), `wmkf_programdirector2` (secondary, no reviewer assignment role) → `systemusers`
- `wmkf_programcoordinator` → `systemusers`
- `wmkf_grantprogram`, `wmkf_programareaserved` → vendor program entities
- `wmkf_type` → vendor type entity

Content / abstract:
- `wmkf_abstract` (full proposal abstract; added by WMKF, not in vendor schema)
- `wmkf_excludedreviewers` (free-form names)

Governed artifact pointers:
- `wmkf_currentinitialassessment` (Lookup →
  `wmkf_requestdocument`; relationship
  `wmkf_request_currentinitialassessment`) — **LIVE in Production 2026-07-30
  via Wave 16 apply and idempotent metadata readback.** This is the canonical
  Initial Assessment pointer and shared request-level ETag fence. The
  controlled production pilot populated it for Request `1002788` with registry
  row `fb995f0f-628c-f111-ab0f-6045bd018a07`; same-input retry preserved that
  pointer and row. The proposal source was later identified as an old Phase I
  document, so this proves pointer/idempotency mechanics but not approved
  Phase II semantics.

WMKF AI writeback fields (canonical: `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md` — v2 is archived, do not use):
- `wmkf_ai_summary` (Memo) — Phase I summary text. **Field Set A: ready, live writeback active.**
- `wmkf_ai_dataextract` (Memo, JSON) — domain tags / structured extract. **Field Set A: ready.**
- `wmkf_ai_complianceissues` (Memo, JSON), `wmkf_ai_compliancesummary` (Memo). **Field Set C: ready.** (v3 also reuses existing `akoya_submissionaccepted`.) Note: live probe shows a numeric `wmkf_ai_compliancecheck` field on the entity; per the v3 spec this is part of an earlier draft that Connor is reconciling — do not write to `compliancecheck`, write to `complianceissues` + `compliancesummary`.
- `wmkf_ai_fitassessment` (Picklist) + `wmkf_ai_fitrationale` (Memo) — **Field Set E: ready**. Relabeled 2026-05-26 (Connor walkthrough) from the prior overloaded "Set D" label; canonical Set D now means PD Assignment only. Written live by the Phase I Dynamics summarize-v2 Executor path.
- `wmkf_ai_fieldprimer` (Memo, JSON, 100000) — **Field live in prod (S258, 2026-06-14, `apply-dataverse-schema --wave=2-fieldprimer`).** Workbench Proposal-tab Field Primer JSON envelope (9 primer sections + OpenAlex expert grounding + provenance). Schema spec: `lib/dataverse/schema/wave2-fieldprimer/akoya_request-fieldprimer.json` (deployed in an isolated wave to avoid re-touching wave2's drifted `wmkf_appreviewersuggestion_honorariumrequest` relationship). **Written by `/api/field-primer/generate` requestId mode (S258)** — explicit `updateRecord` after expert grounding (NOT the Executor raw-output writeback); idempotent (returns stored primer without a paid call unless `regenerate:true`); single-flight via an ETag-conditional generation lease (the field transiently holds a `field-primer/lease` marker — schema `field-primer/v1` is the DONE envelope, see `shared/utils/field-primer-envelope.js`). Read by `/api/workbench/resolve-request` → Proposal tab. Staff orientation only, never a reviewer-candidate source.
- `wmkf_reviewsynthesisjson` (Memo, JSON, 20000) — **PROVISIONED IN PROD 2026-07-03 (workbench Reviews tab Phase 4; live-probed selectable). Governed `review-synthesis.generate` v3 became sole-current on 2026-07-28 with the tracked native JSON schema. Both a direct controlled smoke and the later controlled automatic lifecycle smoke on Request `1002788` persisted valid five-key syntheses on their first semantic attempts. The automatic result remains visible as Stale after exact review cleanup, which proves the read surface preserves a stored synthesis when no submitted reviews remain.** AI synthesis of a proposal's submitted peer reviews (`{consensus, disagreements, keyConcerns, ratingSummaries, overall}`), written by the Executor via the `review-synthesis.generate` prompt (`guard: always-overwrite`; regeneration gated at the calling route, not the Dataverse guard). Schema-as-code: `lib/dataverse/schema/wave11-review-synthesis/` (applied to prod 2026-07-03). Written directly by `POST /api/review-manager/synthesize-reviews` or automatically by the durable `review_synthesis_jobs` drain; read (fail-soft JSON parse) by `GET /api/review-manager/reviewers` → `proposal.reviewSynthesis` → `ReviewsTab`'s Synthesis card. Deploy-order note (historical, satisfied 2026-07-03): the wave had to be applied before deploying the reading code — selecting a not-yet-created column hard-400s (wave10 precedent).

**Workflow-chaining fields (S139, deployed `b536121`)** — cached extractions so downstream prompts don't re-parse the narrative:
- `wmkf_ai_keywords` (Memo, JSON array, 4000), `wmkf_ai_methodologies` (Memo, JSON array, 4000), `wmkf_ai_riskflags` (Memo, JSON array, 4000)
- `wmkf_ai_teaminfo` (Memo, JSON object, 8000), `wmkf_ai_budgetsummary` (Memo, narrative, 8000), `wmkf_ai_timeline` (Memo, narrative, 8000)

**Field Set B (Grant Report) — DEPLOYED (S139, `b536121`).** 22 fields covering counts (postdocs / grad students / undergrads / pubs total / pubs peer-reviewed / pubs non-peer-reviewed / patents awarded / patents submitted), narrative summaries (additional funding, project impacts, awards & honors, implications, outcome summary, notes for staff), per-goal JSON (`wmkf_ai_reportgoalsassessment` at 32000 chars — documented exception to the flat-fields convention), top-2 publication triples (`wmkf_ai_reportpub{1,2}{citation,abstract,source}`), and overall rating (Picklist: Successful / Mixed / Unsuccessful). Schema spec: `lib/dataverse/schema/wave2-existing/akoya_request-ai-extensions.json`. Naming follows the v3 rule (`wmkf_ai_<concept>` with no underscore between concept words — so `wmkf_ai_riskflags`, NOT `wmkf_ai_risk_flags`). Wired up to Grant Reporting writeback when staff is ready; field shapes are stable.

**Workbench triage field (S261).** `wmkf_triagestatus` (Picklist, local option set: `Advancing`=100000000 · `Set aside`=100000001; null/unset = untriaged). **[LIVE in prod (S261, 2026-06-15, `apply-dataverse-schema --wave=2-triagestatus --execute`); D26 backfill applied — 35 Advancing + 170 Set aside (205 rows, `scripts/backfill-d26-triage.mjs --execute`, idempotent). CONSUMED by the dashboard (§3 switch, S261): `/api/workbench/dashboard` now reads this field for visibility — Advancing + Phase II Pending shown, Set aside hidden, untriaged/Concept rows excluded (live-probed: D26 default 35, includeSetAside 205). The dashboard's per-row triage-flip control (S261) WRITES it via `POST /api/workbench/triage` (lead PD / superuser; cosmetic UI gate, hard server gate). §5 allowlist retirement DONE (S261): the cycle picker now derives from the PD's meeting-dated proposals (default = latest); `d26Allowlist.js` is retired from live use (kept as historical record + one-time-backfill source). Triage feature fully shipped.]** Staff winnowing signal that drives the Workbench dashboard going-forward filter (VISIBILITY ONLY, reversible) — replaces the throwaway `shared/config/d26Allowlist.js`. NOT the official Phase I→II status flip, NOT the board "Invited" signal (`wmkf_phaseistatus`), NOT the doc-arrival signal (`akoya_requeststatus='Phase II Pending'`). Schema spec: `lib/dataverse/schema/wave2-triagestatus/akoya_request-triagestatus.json` (isolated wave `--wave=2-triagestatus`, same drift-avoidance reason as wave2-fieldprimer). App-side constants: `shared/config/triageStatus.js`. Written by `POST /api/workbench/triage` (hard manage gate). The 205-row backfill reported 205 written / 0 failed. **PA-trigger risk assessed low + accepted (Justin, S261):** only the new `wmkf_triagestatus` was written — no existing field changed and `akoya_requeststatus` was untouched — so a column-filtered flow (incl. the status-driven intake-recompute flow) cannot fire; the only residual would be an *unfiltered* "any modify" flow on `akoya_request` (run-history not spot-checked). Plan: `docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md`.

**Reviewer-engagement campaign config (S275, 2026-06-21).** Per-request config backing the reviewer-engagement build (`docs/REVIEWER_ENGAGEMENT_SPEC.md`). **[LIVE in prod — provisioned `apply-dataverse-schema --target=prod --wave=7-reviewer-engagement --execute`, published + verified in live metadata 2026-06-21; only newly-created columns, no existing field touched, no Power Automate trigger.]** Discrete columns (NOT a JSON blob) so the Phase-3 reminder cron and Phase-4 quota sweep can OData `$filter` server-side (Codex P2). **Phase 1 LIVE (S275):** `wmkf_respondoffsetdays` + `wmkf_reviewduedate` are WRITTEN on the first invite-batch send (`pages/api/review-manager/send-emails.js`, invitation branch — only when unset, never clobbers a later edit) and are read/edited via `GET|POST /api/review-manager/campaign-config` (the Reviewers-tab "Campaign settings" editor). **Phase 2 LIVE (S275):** `wmkf_reviewduedate` is now also CONSUMED by `render-emails` token-TTL (`computeReviewerTokenExpiry`) — it anchors the non-responder link cap (review-due + 2d) and the accepted long window (review-due + 90d). **Phase 3 LIVE (S275):** the reminder enabled/lead pairs (`wmkf_respondreminderenabled`/`wmkf_respondreminderleaddays` with `wmkf_respondoffsetdays`; `wmkf_reviewduereminderenabled`/`wmkf_reviewduereminderleaddays` with `wmkf_reviewduedate`) are CONSUMED by `/api/cron/reviewer-reminders` (`lib/services/reviewer-reminder-sweep.js`) — each reminder is per-request opt-in. **Phase 4 LIVE (S275; PD email + quota write path S352):** `wmkf_desiredcount` + `wmkf_quotanotifiedat` are CONSUMED by `lib/services/reviewer-quota.js` (called from the acceptance drain `lib/services/reviewer-acceptance-drain.js` after it re-verifies the accept committed — moved off `respond.js` by the S350 accept-fast-response build) — when the accepted count first reaches `wmkf_desiredcount`, a conditional null→set of `wmkf_quotanotifiedat` (If-Match/ETag) notifies the lead PD exactly once; **since S352 that notify actually emails the resolved lead PD** (`emailAdmins: true`, explicit-recipients only, no category fan-out). **`wmkf_desiredcount` WRITERS (S352):** seeded on the first invite-batch send from the admin campaign-timeline default (default 4, `reviewer.campaign_timeline_defaults` — same non-clobbering set-only-if-unset gate as the timing columns, `lib/services/review-manager/send-emails-service.js`), and read/edited via `GET|POST /api/review-manager/campaign-config` (Campaign settings modal, which prefills from the admin defaults). All 8 columns are now consumed:
- `wmkf_respondoffsetdays` (Integer ≥0) — days a panelist is given to respond.
- `wmkf_reviewduedate` (DateTime, **DateOnly**) — review deadline; anchors reminders + token TTL cap.
- `wmkf_respondreminderenabled` (Boolean, default true) / `wmkf_respondreminderleaddays` (Integer ≥0) — respond-by reminder toggle + lead.
- `wmkf_reviewduereminderenabled` (Boolean, default true) / `wmkf_reviewduereminderleaddays` (Integer ≥0) — review-due reminder toggle + lead.
- `wmkf_desiredcount` (Integer ≥0) — PD-confirmed reviewer quota target.
- `wmkf_quotanotifiedat` (DateTime, UserLocal) — Phase-4 concurrency marker (conditional null→set via If-Match/ETag).

Schema spec: `lib/dataverse/schema/wave7-reviewer-engagement/akoya_request-reviewer-engagement.json` (isolated wave, same drift-avoidance reason as wave2-triagestatus). The matching per-reviewer marker `wmkf_respondremindersentat` lives on `wmkf_appreviewersuggestion` (see that Atlas page).

**Wave 18 transition (production-live, 2026-08-11):** this request field
remains the proposal-wide default. The reviewer-due-date feature adds a
nullable `wmkf_appreviewersuggestion.wmkf_reviewduedateoverride`; consumers use
that engagement value first and fall back here. The dedicated accepted-reviewer
writer requires a non-null override to be current/future in the
Foundation-Pacific calendar and strictly after this original date, with no
maximum; null restores this default. [VERIFIED via production create,
entity-scoped publish, typed metadata, and runtime `$select` on 2026-08-11 /
2026-08-12 UTC] the suggestion field is live and EXACT. [VERIFIED via the
non-clobbering extension-body seed, main `8647af33`, Vercel
`dpl_AbTvWvMYb5inwPnYKTK2mkrkNXZz`, and live HTTP checks] the override-first
runtime is production-live. The request campaign
editor continues to own this default and response timing is unchanged.

**Grantee Deliverables Portal abstract fields (S268/S271).** The request keeps only the abstract text
that is semantically part of the award/request record:
- `wmkf_abstractformatted` (Memo, 32000) — AI style-guide abstract drafted FROM the applicant's `wmkf_abstract` (the source above); shown to the grantee to edit/approve. Not overwritten by the grantee edit. **Writers:** `grantee-deliverables/generate` (AI draft) and, S278, `grantee-deliverables/abstract` PUT (PD refine before send — editable in null/Drafted/Invited/Reminder Sent).
- `wmkf_abstractapproved` (Memo, 32000) — grantee-edited/approved abstract (stored separately to preserve the AI-draft provenance). **Writers:** the grantee submit (`grantee-upload`, primary author) and, S278, `grantee-deliverables/abstract` PUT — a PD correction to the *published* version, allowed only post-submission in Submitted/Staff Review (never written when empty, so staff text never precedes a grantee submission). Publish precedence: `wmkf_abstractapproved ?? wmkf_abstractformatted` (`lib/services/grantee-document-assembly.js`).

**Retired from application shape (S271):** lifecycle status, image reference, image caption, invited date,
and reminder date now live on the related `wmkf_granteedeliverable` table, not on `akoya_request`. The
old flat fields `wmkf_granteedeliverablestatus`, `wmkf_granteeimagefileref`, and
`wmkf_granteeimagecaption` may still exist in live Dataverse until a manual admin cleanup, but app code no
longer reads or writes them. Canonical package page: [`dataverse-wmkf-granteedeliverable.md`](dataverse-wmkf-granteedeliverable.md).

No consent field exists by design — the publication-consent waiver is a client-side submit gate (the checkbox
enables submit), not stored; a submitted package IS the consent record. App-side picklist constants:
`shared/config/granteeDeliverableStatus.js`.

**Edited title — `wmkf_wmkfprojectdescription` (S269).** EXISTING field (Memo 2000, "WMKF Project
Description") holding the house-style one-line board-summary objective ("To [verb] …"). Staff curate it
manually today; it populates **late** — empty pre-Invited (probed 0/179 `Pending Committee Review`,
0/202 `Phase I Pending`), filled at/after the `wmkf_phaseistatus=Invited` board flip. The S269
grantee-title generator (`grantee-title.generate`, Sonnet, from `akoya_title` + `wmkf_abstract`) and
its cron (`pages/api/cron/generate-grantee-titles.js`, seasonal `0 6 * 4-6,10-12 *`, **DEPLOYED +
registered in the Vercel cron registry S270**; `grantee-title.generate` prompt **seeded to prod v1 S269**)
write it **only when empty** (write-when-empty, ETag-conditional) for research awardees — never
overwriting manual curation. ✅ **RESOLVED (S270): no AkoyaGO/Power Automate flow fires on a
`wmkf_wmkfprojectdescription` write — safe for the cron to write.** Evidence: field-level audit-trail
analysis across J26/D25/J25/D24 shows the field is **exclusively human-curated** — every dated set-event
is a named staff member (Sarah Hibler, Kevin Moses, Jean Kim, Thomas Rieker, Melissa Gage, Connor Noda),
**no service-principal / application-user / flow writer anywhere**, with human-paced gaps (seconds within
a sitting → days/months across the cycle, multiple editors per cycle, multi-edit revisions) — the
opposite of a flow's single-identity tight burst. No service-account audit follows the human edits
(no read/react trigger-flow). Owner confirmed S270: no trigger-flow watches the field. The cron's
write-when-empty simply does, automatically, what staff do by hand. ⚠️ `wmkf_projecttitle1..3` (String 500, "Project Title
N") is a SEPARATE numbered-slot family with a different hypothesis phrasing (SoCal fills it at concept;
Research late) — **no repo code reads/writes it; do not target.** [VERIFIED S269 via live probe + grep.]

**Cruft / do-not-write fields** [VERIFIED via `project_dynamics_ai_writeback.md`]:
- `wmkf__ai_summary` (double underscore) — exists alongside the real `wmkf_ai_summary`; Connor will delete. Do not target.
- `wmkf_ai_rundatetime` on `wmkf_ai_run` — vestigial; use built-in `createdon` instead.

WMKF status / flags (the long tail):
- `wmkf_phaseistatus` (Picklist), `wmkf_phaseiicheckincomplete` (Picklist), `wmkf_phistaffversioncompleteflag`
- `wmkf_readyforreview`, `wmkf_galreadyforreview`, `wmkf_pcgoverifycomplete` (Picklist)
- `wmkf_vendorverified` (Picklist), `wmkf_rationalesummarycompleted`
- `wmkf_groupexempt`, `wmkf_organizationisgovernmententity`, `wmkf_california`, `wmkf_caftb`, etc. — eligibility booleans

Sample row had **364 total fields** (vendor + WMKF + standard Dataverse audit fields). Most fields are vendor-owned and not touched by app code.

## Read paths (high-traffic)

- `lib/dataverse/adapters/grant-request.js` — domain adapter over the canonical
  `lib/services/dynamics-service.js` transport
- Reviewer Finder services including `load-proposal-service.js`,
  `my-proposals-service.js`, and `my-candidates-service.js`
- Review Manager services for reviewer state, synthesis, and email delivery
- Workbench services for dashboard, request resolution, and triage
- Grant Reporting, Phase I, Expertise Finder, and Grantee Deliverables services
- `pages/api/dynamics-explorer/*` — natural-language queries use the generic
  Dynamics client intentionally
- (NOT `pages/api/integrity-screener/*`, NOT `pages/api/virtual-review-panel.js` — both read no Dataverse. `integrity-service.js` imports only Postgres `sql`; `virtual-review-panel.js` is a single file (not a directory) that's PDF-upload-driven and Postgres-backed via `PanelReviewService`.)
- `lib/dataverse/adapters/reviewer-suggestion.js` `findByPD` — joins requests by lead PD

## Write paths

- `lib/services/phase-i-dynamics/summarize-service.js` — writes ONLY
  `wmkf_ai_summary` through `grantRequestAdapter.updateById`, with a pre-flight
  overwrite guard. The legacy route contract still defers structured extraction;
  do not assume this path writes `wmkf_ai_dataextract`.
- `lib/services/execute-prompt.js` (`persistOutputs()` →
  `grantRequestAdapter.updateById`) — Executor contract writer. **Dynamically
  writes to whichever `akoya_request` field the prompt's `target.field`
  declares.** Used by the Phase I summarize-v2 route. Same skip-if-populated
  overwrite-guard pattern (`preflightGuards()`).
- (Dynamics Explorer does NOT write — its 11 tools are read-only: search, get_entity, get_related, describe_table, query_records, count_records, aggregate, find_reports_due, list_documents, search_documents, export_csv. The `dynamics_restrictions` table exists but no write-tools are wired in.)
- `lib/services/workbench/triage-service.js` — writes ONLY
  `wmkf_triagestatus` through `grantRequestAdapter.updateById`, with the acting
  caller supplied after the route's hard manage gate (superuser or lead PD).
  `scripts/backfill-d26-triage.mjs` also writes `wmkf_triagestatus` in bulk
  (one-time D26 backfill, restriction-bypassed). **[LIVE — field deployed +
  backfilled + read by the dashboard (§3, S261); see Key fields. The route
  remains the authoritative authorization gate.]**

> **Codex R7 corrections (2026-05-07):**
> - `pages/api/grant-reporting/extract.js` historically wrote only the `wmkf_ai_run` audit log row (the line 526 comment *"wmkf_ai_run row is therefore the ONLY durable copy of"* extracted data reflects that prior state). Field Set B fields were DEPLOYED on `akoya_request` 2026-05-07 (22 fields, see `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`); wiring `grant-reporting/extract.js` to write the flat fields is a follow-up.
> - `pages/api/integrity-screener/*` writes screenings to **Postgres** `integrity_screenings` via `IntegrityService.saveScreening`; no `akoya_request` writes exist anywhere in integrity-screener or integrity service files.

All user-driven writes use `MSCRMCallerID` (impersonation contract per `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`); preview + prod flag now ON.

## Junction relationship (S139)

`wmkf_apprequestperson` is the new PI/co-PI history junction (5,561 rows after backfill). UNION-read with `_wmkf_projectleader_value` per `pages/api/reviewer-finder/contact-history.js`. Connor's PA flows (not yet shipped) will dual-write the junction alongside the projectleader lookup on create/update. Until then, the legacy `wmkf_copi1..5` slot lookups remain the only co-PI write path. Full details: [`atlas/dataverse-wmkf-apprequestperson.md`](dataverse-wmkf-apprequestperson.md).

## SharePoint linkage

`sharepointdocumentlocation` rows linked via `_regardingobjectid_value`; folder pattern `{requestNumber}_{guidNoHyphensUpper}`. Multiple libraries: `akoya_request` (active) + `RequestArchive1/2/3` (migrated). See `lib/utils/sharepoint-buckets.js` and `project_dynamics_explorer_archive_libs.md`.

## Cross-system

| Postgres | Dataverse | Notes |
|---|---|---|
| historical `reviewer_suggestions.request_number` (table dropped by migration 018) | `akoya_request.akoya_requestnum` | former natural join key |
| historical `proposal_searches.request_number` (table dropped by migration 018) | same | former join; table was empty |
| `grant_cycles.short_code` | derives from `akoya_request.wmkf_meetingdate` via `cycle-code.js` | not stored on request |

## Polymorphism & era distribution (live-probed 2026-05-15)

> **2026-07-28 document-authority correction for the field-only chronology
> below:** SharePoint Word/PDF bodies are searchable through Microsoft Search;
> the current `GraphService.searchFiles()` path and a read-only tenant probe
> establish that capability. The governed writeup target keeps editable prose
> in SharePoint Word and registers typed identity, workflow state, and
> structured decisions in Dataverse. Later phrases saying “filename/title
> only,” “no content search,” or moving writeup prose onto Dataverse tables are
> superseded; structured decline fields and optional bulk extraction remain
> separate concerns.

`akoya_request` is **polymorphic** — "grant" is a *view* over it, not the entity. No single discriminator; it is a **composite**. ⚠️ **Correction (S157, 2026-05-16, `scripts/probe-akoya-field-dictionary.js` on a verified record):** the S157 composite `wmkf_request_type` × `wmkf_grantprogram` × `akoya_requesttype` **omitted a distinct axis** — the AkoyaGO UI field labelled **"Type"** is **`wmkf_type` (Lookup → `wmkf_type` table)**, *not* the `wmkf_request_type` Picklist. They are different concepts: `wmkf_request_type` (Picklist) = *interaction kind* (Request / Concept / Office Visit / …); `wmkf_type` (Lookup) = *grant type* (e.g. `Discretionary`). The axes are **correlated cross-cutting axes, NOT a flat composite and NOT strictly nested** (S157, `scripts/probe-akoya-wmkf-type-taxonomy.js`, corrected by `scripts/probe-akoya-codex-followups.js` block B): `wmkf_type` is the **coarse class** (`Program` / `Discretionary` / `Site Visit` / `Special Grants` / `Special Projects` / `Individual` / `Miscellaneous`); `wmkf_grantprogram` & `akoya_programid` are **finer program axes that span most `wmkf_type` values, not contained within `wmkf_type=Program`** — the joint group-by shows a program present on **13,754 rows under `wmkf_type=Program` vs 10,991 under other `wmkf_type` values**, so "program ⊂ Program" is false. They are NOT redundant either — joint `wmkf_type`×`wmkf_grantprogram` same-label only 21%, and that 21% is entirely the `Discretionary`×`Discretionary` cell (5,345 = the Puzzle-1 directed/no-ask giving mode; the two axes are the *same population* there — a strong correlation, not a hierarchy). 🔴 **Pervasive-polymorphism invariant:** *every* type-ish axis mixes grant categories with non-grant operational/interaction buckets — `Site Visit`/`Office Visit` in `wmkf_type` *and* `wmkf_request_type`; `Research Reviewer` in `akoya_program`; `Individual` (wmkf_type) ≡ `Research Reviewer` (akoya_program), same Jan-2026 all-native 87-row cohort. Any "real grants" filter must strip operational buckets on **every** axis. **`akoya_programid` ("Internal Program", Lookup → `akoya_program`) is form-required *now*** — the most granular program classifier (816 legacy nulls; better than `wmkf_grantprogram`'s 4,634-null but not guaranteed). Hazard differential: `wmkf_type` has *no* duplicate-name issue + low null (159) — "key by GUID" is a defensive default justified by `akoya_program` specifically, not universal. Business-label → logical map for the program/type cluster: "Type"→`wmkf_type`, "Grant Program"→`wmkf_grantprogram`, "Internal Program"→`akoya_programid` (all Lookups). Counts below are still valid per-field; re-probe `wmkf_type`/`akoya_programid` distributions before relying on the type taxonomy. FetchXML aggregate counts (within the 50k aggregate reliable range):

- `akoya_requesttype` (Picklist): `Grant` 25,473 · `Scholarship` 88 · (`Interfund`/`Program Expense` defined but unused). Too coarse to use alone.
- `wmkf_request_type` (Picklist): `Request` 16,227 · `Concept` 3,273 · `Office Visit` 2,826 · `Site Visit` 1,528 · `Phone Call` 914 · *null* 706 · `Individual` 87. **`Concept` = feedback-only, not a funding ask. Office/Site Visit + Phone Call (~5,268) are interaction logs, not grants.**
- `wmkf_grantprogram` (lookup): `Research` 8,500 · `Discretionary` 5,345 · *null* **4,634** · `Southern California` 4,489 · `Undergraduate Education` 2,017 · `Young Scholars` 326 · `Honorarium` 87 · `Law` 62 · `Strategic Fund` 47 · `Other` 43 · `Emeritus` 7 · `Memorial` 4. **SoCal is its own large separate-process program; Discretionary is high-volume staff-directed giving.** ⚠️ The ~4,634 null is **NOT a real data-quality hole** (Puzzle 3 RESOLVED, S157, `scripts/probe-akoya-grantprogram-gap.js`): within migrated, 4,603 null-`wmkf_grantprogram` but **98% (4,492) have the authoritative `akoya_programid`** — program is known, just in the other axis (dual-field artifact, Puzzle-1 pattern). Only **111 rows (0.5% of migrated)** are genuinely program-less (both fields null); both-null **rate per decision-decade is flat and <1% everywhere** (1980s 0.21% · 1990s 0.53% · 2000s 0.72% · 2010s 0.63% · 2020s 0.03% — `scripts/probe-akoya-codex-substantiation.js` C4, not raw counts) = sporadic data-entry, not systematic. **Always read program from `akoya_programid`, never `wmkf_grantprogram`.**
- `akoya_requeststatus` (String): 24 live values — `Closed` 7,479 · `Phase I Declined` 5,905 · `Concept Done` 3,047 · `Office Visit` 2,826 · `Site Visit` 1,528 · `Phone Call` 914 · `Approved` 766 · `Phase II Declined` 707 · … (interaction types also appear here as status — overlapping/messy). Note the 2026-05-07 "Key fields" line listing `Accepted` is stale — no live `Accepted`; closest is `Approved`.
- `akoya_programid` ("Internal Program", **Lookup → `akoya_program`**, entity set `akoya_programs`) — the granular program axis, **distinct from `wmkf_grantprogram`** (different taxonomy/granularity: `akoya_program` splits Undergraduate Education into *Liberal Arts* 861 + *Science & Engineering* 2,583; `wmkf_grantprogram` has a single `Undergraduate Education` 2,017 — the two do NOT map 1:1). Authoritative taxonomy = **24 programs** (`scripts/probe-akoya-program-taxonomy.js`, 2026-05-16, GUID-keyed). **816 rows null** (form-required *now* but legacy/migrated rows precede that — better than `wmkf_grantprogram`'s 4,634-null but NOT "always populated"; the earlier "required ⇒ ~always" was too strong). Top: `Medical Research` 4,763 · `Science and Engineering Research` 4,632 · `Civic & Community` 2,790 · `Undergraduate Ed - Sci&Eng` 2,583 · `Directors' Directed Grant Program` 1,841 · …. **🔴 Three Track B hazards:** (1) **duplicate name** — `Law and Legal Administration` exists twice (2023-11-30 *Inactive*, 0 requests; 2024-02-15 *Active*, 62) — data is clean (all on the Active GUID) but a name-keyed filter can pick the empty one; filter by GUID. (2) **era-scoped programs** — `Strategic Fund` (created 2024-08-19), `Disaster Relief` (2025-01-23), `Bridge Funding` (2025-09-03), `Research Reviewer` (2026-01-06) have **0 migrated** rows: a pre-creation grant *cannot* be in them; conversely `Undergraduate Education - Liberal Arts` (861, all migrated, 0 native) is legacy-retired. A program filter must be era-aware. (3) **non-grant operational buckets** — `Research Reviewer` (87, all native, created 2026-01) is a reviewer-tracking bucket, not a grant program (polymorphism, like Office-Visit in `wmkf_request_type`). Creation waves: 14 programs 2023-11-30 (founding seed, 3 days before the request import), 6 on 2024-02-15, then incremental — **the taxonomy is living, not static.**
- `statecode`: 0 (active) 25,518 · 1 (inactive) 43.

**Era — boundary is precise and Dataverse-derived (2026-05-16, `scripts/probe-akoya-createdon-2023.js`):** `createdon` by year — **2023: 22,573** · 2024: 1,167 · 2025: 1,376 · 2026: 445. Day-level drill: **100% of the 2023 cohort (22,573 rows) was created on a single date, 2023-12-03**, within one ~43-minute window (`2023-12-03T17:42:10Z … 2023-12-03T18:25:32Z`). Zero native creates anywhere in 2023; the 2,988 native rows are all 2024+ (1,167 + 1,376 + 445 = 2,988; 22,573 + 2,988 = 25,561 ✓). Unambiguous single bulk-import event. **Practical native-vs-migrated classifier (no external dependency): `createdon` on 2023-12-03 ⇒ migrated/historical; `createdon` after 2023-12-03 ⇒ Akoya-native (clean, Connor-authoritative).** The *system* create date of migrated rows is gone — `overriddencreatedon` is **null on 100% of rows (0 / 25,561)** (DISCONFIRMED as an era marker, 2026-05-16 `scripts/probe-akoya-overriddencreatedon.js`, FetchXML aggregates not `$count`). **But the true business history was preserved in a domain field — see below.** Connor / AkoyaGo are a **cross-check on the 2023-12-03 go-live**, no longer a blocker for the era classifier. The earlier "cutover ~2023, confirm with Connor" / "inconclusive `overriddencreatedon`" framings are superseded.

**Era field-shape — what changed Blackbaud→AkoyaGO (2026-05-16; rates are EXACT full-cohort FetchXML aggregates from `scripts/probe-akoya-export-col-rates.js`, migrated tot=22,573 / native tot=2,988).** The prior grant system was **Blackbaud (a.k.a. "Sky")**; the 2023-12-03 import was the cutover. ⚠️ The initial `probe-akoya-era-field-shape.js` n=1,200 GUID-ordered sample was **proven biased** in the migrated cohort (`probe-akoya-era-robustness.js`: `akoya_grant` asc 95% / desc 61%; `grantprogram` asc 58% / desc 99%) — exact rates below supersede it. **Historical key:** `akoya_decisiondate` is **100% migrated / 31% native** with a reproducible realistic spread (1950s:6 · 1980s:1,929 · 2000s:5,249 · 2010s:7,636 · 2020s:3,646; **zero pre-1954** — Keck founded 1954; `probe-akoya-era-robustness.js` block d); the reliable historical-year key for the migrated cohort (mirror `wmkf_meetingdate`), *not* `createdon` (collapsed) or `akoya_datereceived` (7% mig). 🔴 **`createdon`-era ≠ business-era — MANDATORY rule, not advisory (S157 substantiation, `scripts/probe-akoya-codex-substantiation.js` C5, `docs/atlas/evidence/akoya-codex-substantiation-2026-05-16.txt`):** the `createdon`=2023-12-03 split is exact as a *creation-provenance* partition (backfill/net-new/BB-lineage findings are solid) but **168 native rows (18% of the 931 dated native rows) carry `akoya_decisiondate` < 2024-01-01**, 169 (5.66% of native) have some pre-2024 business date — native-created rows about pre-cutover decisions. Slicing *business history* by `createdon`-era is therefore contaminated by ~169 rows: always time-slice on `akoya_decisiondate`, treat migrated/native as a *provenance* dimension not a *period* one, and disclose this cross-contamination when both dimensions appear. **Bound (S157, `scripts/probe-akoya-decline-recording.js`):** presence on *declined* rows is era-dependent — migrated declined = 100% `akoya_decisiondate`, native declined = 10%. The dates remain real (decade spread clean); but a declined row carrying a decision date is a migrated-era property, not era-stable. **Measured ≥97% both cohorts:** `akoya_requestnum` (human Request #), `akoya_requesttype`, `wmkf_request_type` (97/99), `akoya_requeststatus`, `statecode`, `akoya_applicantid` (100/97), `wmkf_meetingdate`, `akoya_fiscalyear`, `akoya_paid` (`akoya_programid` 99/80 just below). **Amount-field gap is field-specific:** `akoya_grant`/`akoya_originalgrantamount` 84% mig / ~32% nat = **strongly-confirmed lifecycle confound, decided class correctly split** (`scripts/probe-akoya-codex-substantiation.js` C3, 2026-05-16, `docs/atlas/evidence/akoya-codex-substantiation-2026-05-16.txt`): native in-flight `Pending*` **0% (0/474)** vs **award-eligible decided (Approved/Active/Closed) 96% (762/796) for `akoya_grant`, 100% (796/796) for `akoya_originalgrantamount`** vs non-award terminal **11% (≈0 by design — declines never carry an amount)**. The earlier blended "decided-terminal 38%/39%" (`probe-akoya-codex-followups.js` block C) is **retired as a mis-cut** — it pooled award-eligible with declines, muddying the denominator; the original `probe-akoya-era-robustness.js` block c decisiondate-presence split was circular. The confound rests on the 0%-vs-96/100% contrast; `akoya_request`/`akoya_expenses` 100% mig / ~46% nat = **migration backfill artifact + request-type mix, NOT a mystery** (`scripts/probe-akoya-request-by-type.js`): migrated 100% even on Office-Visit/Phone-Call rows that can't have a budget ⇒ import backfill, **never export migrated `akoya_request`/`akoya_expenses` as a real amount**; native `Concept` 11% (feedback-only, no budget); native `Request`-type 68% — the 32% with no ask are directed/no-ask awarded giving (`scripts/probe-akoya-native-request-amount.js`: 577/582 `Approved`, 93% awarded, 98% paid; requested-amount N/A by design). **Predominantly but not entirely Discretionary** (`scripts/probe-akoya-codex-followups.js` block A: 492/577 ≈ **85% `wmkf_type=Discretionary`**; ~15% tail across other types — sentinel logic must not assume every no-ask Approved native row is Discretionary). **Puzzle fully resolved, no Connor input needed.** Export rule: requested-amount nulls are class-aware sentinels (migration-backfill / feedback-request / invited-discretionary-award / not-captured), never bare blanks. **Full table + 5-bucket classification + disclosure spec: `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` → "Artifact 3".** **Net-new in AkoyaGO (~28 fields, 0% migrated by nature, not loss):** the GOapply online-intake + review-workflow layer (`akoya_goapply*`, `wmkf_readyforreview`, eligibility/completion flags, `akoya_requestsource`, `akoya_submitdatetime`). **Blackbaud lineage retained as columns:** `wmkf_bbstatus` (BB Status, mig 100/nat 9) + `wmkf_bbstaffid` (BB Staff ID, mig 90/nat 10) — secondary migrated-cohort confirmation; `_wmkf_programlevel2_value` the lone migrated-only field. The earlier "Bucket C = Blackbaud didn't capture this" framing is **retracted** — exact rates (`wmkf_grantprogram` 80/99, `akoya_primarycontactid` 70/77) are substantively present in both eras; the migrated shortfall's cause is not isolated. **Decided-state predicate (2026-05-16, `scripts/probe-akoya-status-predicate.js`):** `akoya_requeststatus` (String, 100% both eras) is the lifecycle field — Pending family `Phase I/II Pending`/`Concept Pending`/`Pending` (native ~474 rows) is a clean undecided signal (100% no decision date, 0% leakage). **`akoya_decisiondate` is NOT a "decided" flag — it is an *approval* stamp** (probe-tested status-class cross-tab, native): `APPROVED` 89% / `CLOSED` 100% carry a date vs `DECLINED/INELIGIBLE` 10% / `CONCEPT DONE` 13% / `PENDING` 0%; **1,490** terminal-decided rows (declined/ineligible/concept-done/closed) carry no date (exact, summed — not inferred). Use the `akoya_requeststatus` class map for "decided," not decision-date presence. **Ambiguous middle behaviorally resolved (S157, `scripts/probe-akoya-ambiguous-status.js`):** `Active` = decided-terminal **funded/active grant** (grant 100% / paid>0 ~99% both eras); `Proposal Not Invited` = decided-terminal **triage-decline at the invite gate** (no award; native-process-only, 0 migrated — era-scoped status); `Withdrawn` = **terminal-non-decision, applicant-initiated** (request present, 0 award/paid; migrated decisiondate=100% vs native 0% = backfill-on-terminal artifact, not a real decision). Connor residual on the three = naming/sign-off only. **Decline-reason recording relocated across the migration (S157, `scripts/probe-akoya-decline-recording.js`; ⚠️ all decline percentages here are WHOLE-ENTITY aggregates — per-program segmentation is an explicit open follow-up, not a closed result, since the finding is research-process-specific):** within declined requests, migrated uses the structured Picklist `akoya_denialreason` (98%, *not* backfill — 0% on Approved both eras), native abandoned it (8%) for free-text Memo `wmkf_denialnotes` (47%). Track B "denial reason" must be era-aware (`akoya_denialreason` migrated / `wmkf_denialnotes` native); a single-field export shows a false post-2023-12-03 cliff. ≤~50% of native declines have a reason in *either* field (Akoya-era data-quality gap). Stage detail (`scripts/probe-akoya-decline-by-stage.js`): Blackbaud enforced structured capture ~97–100% across *all* migrated decline stages; native is sporadic & stage-inconsistent — triage-out unrecorded by process (`Proposal Not Invited` 2%, `Concept Ineligible` 6%), best native = `Phase I Declined` 62% (n=640); NOT a monotonic gradient (Phase II Declined 10% but n=20, weak). ⚠️ **Field-only blind spot (user-provided backstory, S157):** the decline probes measured Dataverse fields only. Research process: Phase I-invited and *all* Phase II declines have the rationale in a **SharePoint Word doc on the request**, not a field — so "≤50% undocumented" really means "≤50% have a reason *in a field*". This rationale is **reachable via existing proven infra** (user-corrected S157 — NOT a scope boundary): `sharepoint-buckets.js::getRequestSharePointBuckets` → `graph-service.js::listFiles/downloadFile` → `file-loader.js::extractTextFromBuffer` (DOCX→text); Dynamics Explorer already does find+download (`pages/api/dynamics-explorer/download-document.js`). Cheap default = detect doc presence + link, but current capability is **filename/title only** (no content search; legibility = staff-naming-dependent, inconsistent) — bulk DOCX→text extraction is real engineering (volume/perf phase). Forward intent (user, S157): move doc-resident knowledge onto Dataverse **tables** (structured/legible/searchable); doc-link surfacing is an interim bridge. Early post-AkoyaGo all Phase I had a rationale doc (field intentionally empty); triaged-Phase-I later went undocumented/shadow-Excel (no enforcement); research is **NOT dropping Phase I** (user-corrected S157) — consolidating to a single-submission model (one robust Phase I replaces the old short-Phase-I→separate-Phase-II-package two-step; advancement to "Phase II" = a **status promotion on the same `akoya_request` record**, original submission migrates, no new doc/package/entity). Decline capture separately moving toward standardized reason options + "Other". 🔴 **"Phase II" is process-era-dependent** (pre-change = separate package; post-change = same record promoted by status) — counting "Phase II proposals" across that boundary conflates two different things. **All S157 decline findings are research-process-specific** — SoCal (own `wmkf_socalreasonsfordecline2`, Virtual) and discretionary are separate processes; decline analysis must be program-segmented. Track B declined-null categories: with-field-reason / triage-no-reason-expected / rationale-in-doc (retrievable via Graph/SharePoint path above — surface a link) / shadow-Excel (irrecoverable) / genuinely-missing. Meta: backfill is field-specific — `akoya_request` was backfilled, `akoya_denialreason` was not; no blanket migrated-high rule.

## Person-role & contact fields — per-program (S162 probes, 2026-05-18; Track B floor-scoping)

Three live probes (read-only FetchXML aggregates / census; dated evidence in `docs/atlas/evidence/`) refined the person/contact + meeting-date picture for the bulk-export filter floor. **Headline: "PI" and "primary contact" are per-program, not entity-global — an entity-wide field→concept map is provably wrong for non-research volume.**

- **`wmkf_meetingdate` is ~universal across every *named* process** (`scripts/probe-akoya-meetingdate-by-type.js`, `akoya-meetingdate-by-type-2026-05-18.txt`): 99.5% overall; ~100% of Program/Discretionary/Site Visit/etc. (Discretionary 1/5,345, that one `Pending`; migrated Discretionary 0/4,749). The ~0.5% no-meeting-date residue is **not** a giving-type hole — it concentrates in already-`wmkf_type`/`wmkf_request_type`-null rows + in-flight `Pending`. Refines the whole-entity "≥97% Bucket A" line above with the program-segmented confirmation: meeting date is a sound fail-safe temporal handle; the off-cycle/no-cycle tail must fail loud, not silently drop.
- **Per-program lead-person mapping** (`scripts/probe-akoya-person-role-by-program.js`, `akoya-person-role-by-program-2026-05-18.txt`; native): **Research** → `wmkf_projectleader` (the PI) + the `wmkf_apprequestperson` junction for co-PIs; **SoCal** → NO project leader (3%), lead = Primary Contact (89%) / `wmkf_ceo` (88%, org exec); **Discretionary** → no grantee lead at all (~15–18%), the "who" is the internal director in `wmkf_donorname`. ⚠️ `DESIGN.md:196` PI "98%/90%" is a *fine `akoya_programid`* cut; the coarse process-family `wmkf_grantprogram=Research` is **61% native** (diluted by concepts/site-visits). Segmentation-sensitive — reconcile which cut any AI-grounding map uses (Connor flag candidate).
- **"Primary contact" is a request-vs-org fan-out** (`scripts/probe-akoya-socal-contacts.js` / `-contact-divergence.js`; Rosetta-anchored on #1001159, native SoCal 500/~681 sample + SoCal-2025 n=268). Label→field, verified: **Request Primary Contact** = `akoya_request.akoya_primarycontactid`; **Org Primary Contact** = `account.primarycontactid` (on the applicant `account` — *not* on the request); **Organization Leader / President/CEO** = `akoya_request.wmkf_ceo`. Native SoCal: both present 84%, of-both same-GUID ~68% / divergent ~32%. ⚠️ GUID-divergence **overstates person-divergence**: duplicate `contact` records (same human, two GUIDs — e.g. Rosalie Brown / Doug Rimerman) inflate it; contact-lookup axes fragment a person across records (name-match ≠ GUID-match — an AI footgun). The two primary-contacts are NOT interchangeable; any contact axis must force the request-vs-org choice.
- **`wmkf_donorname` is a Lookup → `wmkf_donors`** (`probe-akoya-meetingdate-by-type.js` PART 2), **not an external philanthropic donor**: on discretionary requests it is the WMKF board member / staffer who *directed* the gift (samples: Thomas E. Everhart = board, Niloo Hassas = staff). Labeling an axis "Donor" misleads — it is the directed-giving sponsor.

## Migration disposition

Stays as the system of record. WMKF AI fields and lifecycle additions are merged into the vendor entity, not extracted.

## Open questions / gotchas

- **~25,561 rows** (not "5,000" — that is the OData `$count` cap; see header). Many vendor-only fields not in our scope. Don't accidentally touch fields outside the WMKF-owned set.
- The 5-slot `wmkf_copi1..5` and `wmkf_potentialreviewer1..5` patterns are vendor-conceived but feel artificial — they're being phased out via child entities (`wmkf_apprequestperson` extended per 2026-05-14 schema review for roster, `wmkf_appreviewersuggestion` for reviewer state). Code that reads slots directly should be flagged for migration.
