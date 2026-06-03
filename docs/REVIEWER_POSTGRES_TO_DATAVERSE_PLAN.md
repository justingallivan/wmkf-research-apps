# Reviewer Postgres → Dataverse Migration Plan (Wave 2)

> **⚠ S213 (2026-06-02): the `wmkf_appresearcher` sidecar described throughout this doc as a Dataverse write target was COLLAPSED onto `wmkf_potentialreviewers` and DROPPED.** Anywhere below that says "write/upsert to `wmkf_appresearcher`," read it as "write the bibliometric fields directly on `wmkf_potentialreviewer`." Do NOT re-create the sidecar pattern in any remaining/future work here. As-executed record: `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`.

**Created:** 2026-05-06 (Session 136)
**Last revision:** 2026-05-25 (S188) — stale W3-W5 forward-tense language reconciled across §"Endpoint rewrite scope", §"Dependency-ordered queue", and the W3-W7 schedule table. Whole-doc one-pass sweep, not site-by-site patches.
**Status:** **Active build, late shipping.** Schema deployed (`wmkf_potentialreviewer` extended with the S213 bibliometric fields, `wmkf_appreviewersuggestion`, `wmkf_apprequestperson`, `wmkf_appgrantcycle`; the former `wmkf_appresearcher` sidecar was dropped S213). `save-candidates` / `my-candidates` / `load-proposal` / `contact-history` live in prod. W3 grant-cycle cutover, W4 reviewer-suggestion data alignment, and the full W5 reader-cutover wave (generate-emails, my-proposals, extract-summary retirement, maintenance blob-scanner) all shipped. W6 step 1 — `researchers.js` retirement + Database tab UI removal — shipped 2026-05-12. Remaining: post-pilot one-shot cleanup/drop script; restore-from-backup script **(⚠️ was double-booked for two unrelated restores; RESOLVED S164 → distinct filenames — see the `restore-reviewer-suggestion-cleanup-backup.js` row in the "Spec'd vs. built" table)**; match-on-discovery wiring + UI (post-pilot); `add-candidate-manual` (post-pilot). See "Spec'd vs. built" table below for the line-by-line state.
**Priority:** Top (historical) — was the gate for the intake portal pilot; the reviewer migration shipped W3–W6 2026-05-12, and that pilot is superseded (the live direction is a single Phase I intake for the next cycle — see `docs/SYSTEM_MODEL.md`).
**Target environment:** Prod (Dataverse Wave 2 schema is live)

## Read this first: ground truth lives in the Atlas

For live state of any entity/table this plan touches, the canonical reference is the **Application State Atlas** (`docs/APPLICATION_STATE_ATLAS.md` + per-entity pages under `docs/atlas/`). Verified 2026-05-07 via `scripts/audit-postgres-state.js` + `scripts/audit-dataverse-state.js`. When this plan and an Atlas page disagree, the Atlas is authoritative — this plan describes the *target* state and the migration *steps*; the Atlas describes *current* state.

## Spec'd vs. built (verified 2026-05-07)

Refreshed 2026-05-12. Several artifacts have shipped since the plan was locked; the table below is line-by-line accurate against `git log` and the live repo state.

**Verification requirement (per Codex W4-closing review Q1/Q5):** before each W-cycle build starts, cross-check this table against `git log --all --grep=<artifact-name>` for any row marked "BUILT" (or stronger). Past drift surfaced at W4 build time: the junction backfill was marked "not yet executed" but had been executed 2026-05-07 (commit `8b9b287`). Treat plan text as advisory; Atlas + git log + live `--dry-run` is authoritative. When a row is updated, append a commit-hash citation so staleness is visible without re-running probes.

| Artifact | Status | Notes |
|---|---|---|
| `scripts/backfill-reviewer-suggestions-parity.js` | **BUILT** (S136) | Dry-run classification of all 337 Postgres rows |
| `scripts/audit-postgres-state.js`, `scripts/audit-dataverse-state.js` | **BUILT** (S136/S137) | Live-state probes; re-run before any migration work |
| `wmkf_apprequestperson` junction entity | **BUILT + DEPLOYED to prod** (S139, commit `c8cbfe1`) | Schema-as-code at `lib/dataverse/schema/wave2/wmkf_app_request_person.json`; alt key on `(wmkf_request, wmkf_contact, wmkf_role)` enforced |
| `scripts/backfill-request-person-junction.js` | **BUILT + EXECUTED** | ~14 KB, dedup-guarded against existing junction rows. Executed in commit mode 2026-05-07 (commit 8b9b287) writing 5,561 rows from akoya_request slot fields. Earlier drafts of this plan claimed "not yet executed" — that was stale. Re-running in dry-run confirms 0 to insert as of 2026-05-12 (W4 Day 4 re-verification). |
| `pages/api/reviewer-finder/contact-history.js` | **BUILT** (S139, commit `b23586c`) | UNION read strategy across junction + `_wmkf_projectleader_value`. **Both paths are steady-state per S136 (§"Junction read strategy") — `_wmkf_projectleader_value` stays authoritative for the lead PI; the junction is the additive source for co-PIs.** Smoke at `scripts/smoke-contact-history.js`. |
| `scripts/backfill-reviewer-suggestions-to-dataverse.js` | spec'd | Idempotent commit-mode backfill of the 8-row Postgres-only delta. **Triage these 8 rows first** (per Codex 3b 2026-05-12): determine whether each is a genuine missed sync or a legitimate Postgres-only row (e.g., proposal not yet in Dataverse) before committing. |
| `pages/api/reviewer-finder/add-candidate-manual.js` | spec'd | Net-new "add candidate by hand" endpoint, replaces retired Database tab. Writes to `wmkf_potentialreviewer` (identity + bibliometrics on the person, post-S213) and `wmkf_appreviewersuggestion` via existing adapters. |
| `lib/services/contact-history-service.js` | spec'd | Match-on-discovery aggregation helper. **Distinct from the existing endpoint** — the endpoint serves a batched Dataverse lookup; this service would consume it from `discovery-service.js` during candidate enrichment. |
| Match-on-discovery wiring in `lib/services/discovery-service.js` + history-badge UI in `pages/reviewer-finder.js` | spec'd | First-class new scope. Badge sources: 🔁 reviewed (from `wmkf_appreviewersuggestion` rows linked to the contact via slot's `wmkf_contact`); 🚫 declined (from `wmkf_appreviewersuggestion.wmkf_responsetype`); 💰 funded PI (from `wmkf_apprequestperson` junction + `_wmkf_projectleader_value` on `akoya_request` — the same UNION the contact-history endpoint already returns). |
| `wmkf_appgrantcycle` entity | **DEPLOYED, DATAVERSE-PRIMARY** (11 custom attrs live + 2 alt-keys, 10 rows post-W3 cutover 2026-05-12) | The entity is the live source of truth for cycle data. The three fields originally flagged as missing (`wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`) were patched 2026-05-12 (W3 preflight) and are now in both schema-as-code and prod; `grant-cycles-dataverse.js` selects all three on every read (live evidence). See `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md`. |
| `grant_cycles` endpoint cutover | **SHIPPED W3 (2026-05-12)** | `pages/api/reviewer-finder/grant-cycles.js`, `pages/api/review-manager/render-emails.js`, `pages/api/review-manager/send-emails.js`, and `lib/services/maintenance-service.js` blob-cleanup all read cycle data from Dataverse via `lib/services/grant-cycles-dataverse`. Postgres `grant_cycles` is drain-only. |
| Post-pilot one-shot cleanup script | spec'd | Drops unengaged `wmkf_appreviewersuggestion` rows post meeting + 14 days, fired from the W6/post-pilot table-drop path. **Predicate locked S136 2026-05-06** (8 signals). |
| `scripts/restore-reviewer-suggestion-cleanup-backup.js` | **BUILT 2026-05-18 (S164) — for the Rollback §3 / line-32 path ONLY** | ⚠️ **The plan _previously_ double-booked this filename for two unrelated restores (RESOLVED S164 — see below).** **(A) BUILT S164:** the Rollback §3 / line-32 restore — reverses the *Dataverse* `wmkf_appreviewersuggestion` unengaged-row cleanup; reads a JSON backup envelope (contract v1 defined in the script header), re-creates rows via `reviewerSuggestionAdapter.upsert` (re-runnable find-then-update/create — NOT a true alt-key PATCH, NOT concurrent-safe), dry-run default + non-zero exit on failure. Dry-run verified live read-only S164 (both WOULD-CREATE/WOULD-UPDATE branches). **(B) NOT built:** the line-801 post-pilot-table-drop checklist originally reused this *same filename* for a *different* restore (the double-booking) — "~30 lines, reads **JSONL → INSERT**" back into the dropped *Postgres* drain-only tables (`researchers`/`researcher_keywords`/`publications`/`proposal_searches`). Different datastore, format, and mechanism; (A) cannot restore (B) or vice-versa. **"Built S164" does NOT satisfy the line-801 P0 table-drop prerequisite.** **RESOLUTION DONE (S164, Codex-recommended — distinct filenames, NOT multi-mode):** (A) = this script `scripts/restore-reviewer-suggestion-cleanup-backup.js` (built); (B) = `scripts/restore-postgres-drain-table-backup.js` (line-801 checklist, NOT built). S164 also fixed a `selected`-default BLOCKER (missing/non-boolean `selected` now hard-SKIPs instead of silently defaulting an engaged-signal to `true`) + corrected the idempotency wording (find-then-update/create, not a true alt-key PATCH); Codex-reviewed. NOTE: line 801's cited memory `[[w6-table-drop-pending]]` does not exist (phantom ref, same class as others found S164). |
| `scripts/repair-divergence-postflip.js` | spec'd | Replay Dataverse-window writes back into Postgres if a flag-flip rolls back. Only relevant if `WAVE2_BACKEND_*` flags are built. |
| `scripts/reconcile-reviewer-migration.js` | spec'd | Pre/post-cutover reconciliation report. Run before declaring any drain target retired. |
| `WAVE2_BACKEND_*` env-flag dispatch in services | spec'd — **decision pending** | See "Rollback strategy" below for the tradeoff. Zero matches in code today. |

### Drain-target endpoint inventory (verified 2026-05-12 via `git grep`)

Every application file holding a live Postgres read/write against a Wave 2 drain table. **This is the actual scope of "cutover" work** — not just the two endpoints originally cited (`render-emails.js` / `send-emails.js`).

> **Status banner (2026-05-19, S167 ground-truth verification):** Independent code grep (Codex-verified) confirms **zero live SQL** against `researchers`, `publications`, `researcher_keywords`, `reviewer_suggestions`, `grant_cycles`, `proposal_searches` anywhere under `pages/api/`, `lib/services/`, `lib/dataverse/`, or `shared/`. The cutover is complete at the application runtime layer. Every row below is historical; the "shipped" annotations are now baked into the source files themselves (see file headers). Only `scripts/*` admin tools still SQL these tables.

| File | Drain tables touched (pre-cutover) | Status | Notes |
|---|---|---|---|
| `pages/api/reviewer-finder/grant-cycles.js` | `grant_cycles`, `proposal_searches`, `reviewer_suggestions` | **SHIPPED W3 (2026-05-12), Dataverse-only** | Imports `lib/services/grant-cycles-dataverse`; loud-fail guard if `WAVE2_BACKEND_GRANT_CYCLES=postgres`. |
| `pages/api/reviewer-finder/generate-emails.js` | `reviewer_suggestions` | **SHIPPED W5 (2026-05-12)** | Now uses `lib/dataverse/adapters/reviewer-suggestion`. |
| `pages/api/reviewer-finder/my-proposals.js` | `reviewer_suggestions` | **SHIPPED W5 (2026-05-12)** | Uses suggestion adapter via Dynamics. |
| `pages/api/reviewer-finder/extract-summary.js` | `proposal_searches` (read), `reviewer_suggestions` (UPDATE) | **RETIRED W5** | Endpoint removed; UI caller in `pages/reviewer-finder.js` updated. |
| ~~`pages/api/reviewer-finder/researchers.js`~~ | `researchers`, `researcher_keywords`, `reviewer_suggestions`, `grant_cycles` | **RETIRED 2026-05-12 (W6 step 1)** | Endpoint deleted; Database tab UI removed from `pages/reviewer-finder.js`. |
| `pages/api/review-manager/render-emails.js` | `grant_cycles` | **SHIPPED W3 (2026-05-12)** | `loadCycleConfigs()` now reads Dataverse via `grant-cycles-dataverse`. |
| `pages/api/review-manager/send-emails.js` | `grant_cycles` | **SHIPPED W3 (2026-05-12)** | Same `loadCycleConfigs()` path; also promotes recipient to CRM `contact`. |
| `lib/services/database-service.js` | `researchers`, `publications`, `researcher_keywords`, `reviewer_suggestions` | **METHODS REMOVED (W5–W6)** | Reviewer-domain methods deleted; comments at lines 21-25 / 132-135 redirect to Dataverse adapters. File still SQL-touches `search_cache`, `user_profiles`, `user_preferences` (unrelated). |
| `lib/services/maintenance-service.js` | `proposal_searches`, `grant_cycles`, `reviewer_suggestions` | **SHIPPED W5 (post-W5 cutover noted in source)** | `cleanupBlobs()` reads Dataverse `wmkf_appgrantcycle.wmkf_reviewtemplateurl` and `wmkf_appreviewersuggestion` blob URLs; PG `proposal_searches.full_proposal_blob_url` intentionally omitted (table is empty). |

**Not in scope** (Postgres tables that stay permanently): `user_profiles`, `api_usage_log`, `system_alerts`, `health_check_history`, `maintenance_runs`, `dynamics_query_log`, plus the per-app stores listed in "Out of scope" above.

## What this doc supersedes

The Wave 2 spec in `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` (Session 106) was written assuming a **researcher-pool model** (free-standing `wmkf_app_researcher` rows accumulated across cycles, optional `wmkf_contact` lookup at promotion). What actually got built first was different: a **1:1 sidecar model** — `wmkf_appresearcher` existed 1:1 with `wmkf_potentialreviewer`, which is itself a global per-person row keyed on email. **S213 then collapsed that sidecar onto the person and dropped it**, leaving `wmkf_potentialreviewer` + `wmkf_appreviewersuggestion` as the reviewer-domain core. See §"Data model: 1:1 sidecar" below for the historical cardinality definition and S213 update.

Connor (2026-05-06) confirmed the underlying intuition: researcher rows are **cycle-bounded transient candidate scratch**, not a permanent bibliometric pool. The 1:1 model coincidentally got this right. This doc operationalizes the migration around that ground truth.

## Out of scope (Postgres tables this migration does NOT touch)

To prevent scope creep — destructive carryover items that name "drop Postgres tables" must explicitly exclude:

| Table | Why it stays | Owner |
|---|---|---|
| `retractions` | 63K+ rows, GIN-indexed array search; load-bearing for Integrity Screener | Wave 3 (separate plan) |
| `integrity_screenings`, `screening_dismissals` | Per-user history for Integrity Screener | Wave 3 |
| `dynamics_feedback` | Dynamics Explorer thumbs/auto-detected failures | Wave 5 |
| `expertise_roster`, `expertise_matches` | Expertise Finder roster + history | Wave 4 |
| `panel_reviews`, `panel_review_items` | Virtual Review Panel persistence | Wave 4 |
| `intake_drafts`, `intake_audit` | Applicant intake portal (separate workstream) | Pilot scope, not migration |
| `system_alerts`, `health_check_history`, `maintenance_runs` | Time-series monitoring; correctly stays in Postgres per Wave 1 doc | Stays Postgres permanently |
| `api_usage_log`, `dynamics_query_log` | High-volume audit logs; correctly stays in Postgres per Wave 1 doc | Stays Postgres permanently |
| `user_profiles` | Stays Postgres permanently (identity bridge to Dynamics `systemuser`) | Stays Postgres |
| `user_preferences`, `user_app_access`, `system_settings` | Wave 1 — fully migrated + Postgres tables DROPPED 2026-05-12 | Done |

**Rule**: any decommission script in this migration explicitly enumerates the Postgres tables it drops; never wildcards. See "Pre-drop grep gates" under Rollback Strategy.

## Where the migration actually stands today

> **HISTORICAL — supersede with the spec-vs-built table (line 13) + ground-truth banner (line 42) for current state.** The W3-W6 cutovers shipped 2026-05-12 (W3 grant cycles; W4 reviewer-suggestion alignment; W5 reader cutover incl. `generate-emails.js` / `my-proposals.js` / `extract-summary.js` retirement / `maintenance-service.js` blob-scanner / `database-service.js` gut; W6 step 1 `researchers.js` retirement). Body of this section was written pre-cutover; the "Migrate", "rewriting endpoints", "Review Manager is mostly Dataverse but partially Postgres" framings are the planning state, not the live state. Drop-pending tail items still real: post-pilot one-shot Postgres table drop, restore script, match-on-discovery, add-candidate-manual.

**Already in Dataverse (live)** — reviewer-person extension + lifecycle entity (historically three custom entities + extensions before S213):

- `wmkf_potentialreviewer` — global per-person identity (by email). One person across N proposals = ONE row. Source: pre-existing entity, extended per `lib/dataverse/schema/wave2-existing/wmkf_potentialreviewers-extensions.json`.
- ~~`wmkf_appresearcher`~~ — **DROPPED S213**; its bibliometric fields now live directly on `wmkf_potentialreviewer`.
- `wmkf_appreviewersuggestion` — per-(person, request) lifecycle ledger. Extended per `wave2-existing/wmkf_appreviewersuggestion-extensions.json` with token fields, review-form picklists, and SharePoint folder.
- Adapters: `lib/dataverse/adapters/{contact, potential-reviewer, researcher, reviewer-suggestion}.js`
- Endpoints fully on Dataverse: `save-candidates.js`, `my-candidates.js`, `load-proposal.js`
- **Review Manager is mostly Dataverse but partially Postgres**: `reviewers.js` reads/writes Dataverse for the per-proposal lifecycle, but `render-emails.js` and `send-emails.js` both call `loadCycleConfigs()` which reads Postgres `grant_cycles`. (Surfaced by grep gate 2026-05-06; was incorrectly described as "fully Dataverse" in earlier revisions of this plan.)

**Pre-existing schema-as-code (mixed deployment status — verify per-file before consuming):**

The `lib/dataverse/schema/wave2/` directory held six schema-as-code files written in an earlier session that designed the original Wave 2 entities. **S213 update — only three remain deployed:** `wmkf_appgrantcycle`, `wmkf_appreviewersuggestion`, and `wmkf_appproposalsearch` (S185; entity-set `wmkf_appproposalsearchs`, empty). The other three — **`wmkf_appresearcher`, `wmkf_apppublication`, and `wmkf_apppublicationauthor` — were DROPPED S213** (the sidecar collapsed onto `wmkf_potentialreviewers`; the two publication entities were empty and went down with it; their schema-as-code files were deleted). See `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`. Historically all six encoded the **1:1 sidecar model** (not the pool model the Wave 1 design doc text implied):

- `wmkf_app_grant_cycle.json` — `wmkf_AppGrantCycle` entity, OrganizationOwned, alt-keyed on `wmkf_FiscalYearCode`
- `wmkf_app_proposal_search.json` — `wmkf_AppProposalSearch` entity, UserOwned per-search analysis log
- `wmkf_app_publication.json` — `wmkf_AppPublication` entity, OrganizationOwned, alt-keyed on DOI; `authorsRaw` text + junction for tracked authors
- `wmkf_app_researcher.json` — `wmkf_AppResearcher`, **described in the file as "1:1 sidecar to wmkf_potentialreviewers"**
- `wmkf_app_reviewer_suggestion.json` — `wmkf_AppReviewerSuggestion`, UserOwned lifecycle ledger
- `wmkf_app_z_publication_author.json` — junction (the `z_` prefix is for create-order; junctions need both endpoints created first)

**Important**: filenames use snake_case for human readability; schemaName uses PascalCase (`wmkf_AppGrantCycle`); deployed logical names would be lowercase concatenated (`wmkf_appgrantcycle`). All three are internally consistent with the live entities' deployed naming. There is no "naming convention divergence" — earlier drafts of this plan claimed there was one, that was a misreading.

The migration question is therefore **"do we deploy what's already designed, or modify the designs first?"**, not "what should we design?" Most of the Wave 2 design work happened months ago.

**Postgres data still load-bearing:**

| Table | Rows (verified 2026-05-12) | Disposition |
|---|---|---|
| `publications` | 0 | **Retired** (deploy decision: skip). Writer is dead and reader `DatabaseService.getRecentPublications` (line 313) has **zero external callers** (verified 2026-05-07 via repo-wide grep — Codex R3 #7 resolved). The Dataverse counterparts `wmkf_apppublication` and the junction `wmkf_apppublicationauthor` were both deployed empty (0 rows) and **DROPPED S213** in the appresearcher collapse (`docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`). Reviewer Finder discovery already rescrapes per-search; no need for a cached table. |
| `proposal_searches` | 0 | **Drain (no app readers remain).** `pages/api/reviewer-finder/extract-summary.js` retired W5 (2026-05-12) per row 49 above + `docs/atlas/postgres-other-reviewer-tables.md:25`. The W3 grant-cycles JOIN dropped at the same cutover. Remaining touches are admin scripts only. The Dataverse counterpart `wmkf_appproposalsearch` IS deployed (S185, 0 rows, entity-set `wmkf_appproposalsearchs`) and sits empty awaiting a future feature need. Postgres table drop unblocked. |
| `researchers` | 331 | **Drain.** Don't migrate. `researchers.js` admin UI retired 2026-05-12 (W6 step 1); no live application readers/writers remain. The post-pilot one-shot DELETE/table-drop path handles cleanup after the staleness probe passes (≥2026-07-01), matching the W6 row below. |
| `researcher_keywords` | 1,028 | **Drain.** Coverage moves to `wmkf_potentialreviewers.wmkf_keywords` for new rows (S213: folded onto the person; the `wmkf_appresearcher` sidecar was dropped). Live readers/writers gone with `researchers.js` retirement (W6 step 1). |
| `reviewer_suggestions` | 337 | **Backfill spec needed** — see "Reviewer suggestions backfill" section below. Naive "active-cycle migrate, closed-cycle discard" is not enough. |
| `grant_cycles` | 13 | **Migrate** to net-new `wmkf_appgrantcycle`. Field-by-field mapping in "Grant cycle field mapping" section below — Postgres has more fields than the original §1 spec captured. |

Total live data is ~1,700 rows. The "migration" is mostly **letting Postgres data drain** as J26 closes, plus rewriting the few endpoints that still talk to Postgres.

### Verified live state (2026-05-06, `scripts/audit-postgres-state.js`)

Per-column population probed against live Neon Postgres. Highlights driving plan decisions:

**`reviewer_suggestions` (337 rows, 37 columns)** — richer than originally documented:
- 100% populated: `proposal_id`, `proposal_title`, `researcher_id`, `relevance_score`, `match_reason`, `sources`, `suggested_at`, `selected`, `invited`, `declined`, `grant_cycle_id`, `program_area`, `user_profile_id`, `proposal_authors`, `proposal_institution`, `reminder_count`
- 99%: `request_number` ← **direct join to `akoya_request.akoya_requestnum`**; basis for active/closed determination
- 97%: `proposal_abstract`
- 55%: `summary_blob_url`
- 13%: `email_sent_at` (43 invitations sent)
- 7%: `response_received_at`, `response_type` (22 responses)
- 6%: `materials_sent_at`, `review_status`
- 5%: `proposal_url`, `proposal_password`
- 1%: `review_received_at`, `review_blob_url`, `review_filename`, `thankyou_sent_at`, `notes`
- 0%: `co_investigators`, `co_investigator_count`, `email_opened_at`

**`researchers` (331 rows)** — bibliometric infrastructure was built but **never wired up**:
- 100%: `name`, `normalized_name`
- 99%: `email`
- 97%: `primary_affiliation`
- 42%: `website`
- 4%: `email_source`
- 2%: `contact_enriched_at`
- 1%: `orcid`, `google_scholar_id`, `orcid_url`, `google_scholar_url`, `metrics_updated_at`
- **0%: `h_index`, `i10_index`, `total_citations`, `last_checked`, `email_year`, `email_verified_at`, `faculty_page_url`, `contact_enrichment_source`, `notes`, `department` (1%)**

**Historical pre-S213 implication:** the sidecar's bibliometric metrics (`wmkf_hindex`, `wmkf_i10index`, `wmkf_totalcitations`, `wmkf_lastchecked`) were effectively empty in the old Postgres-derived pool. S213 moved the bibliometric fields onto `wmkf_potentialreviewer`; any history-badge design still should not assume rich historical h-index data. What badges CAN show reliably is engagement history (saved, invited, accepted, declined, reviewed) — which IS captured.

**`grant_cycles` (13 rows, 10 active)** — sparser than schema suggests:
- 100%: `name`, `short_code`, `program_name`, `summary_pages`, `is_active`
- **0%: `review_deadline`, `review_template_blob_url`, `review_template_filename`, `additional_attachments`, `custom_fields`**

So the "JSON validation" and "blob URL reachability" gymnastics in the plan can be simplified — those columns have no data to migrate. They remain in the Dataverse schema for forward compatibility.

**Cycles enumerated**: J26, D25, J25, D24, J24, D23, J23, D26, J27, D27 active; rows 11–13 are inactive duplicates of D26/J27/D27 (data hygiene cleanup, not load-bearing).

**Per-cycle suggestion volume**: ~10–30 rows per cycle prefix, all with `selected = true`. The "transient unselected scratch" the cleanup path was originally framed against does not appear in live Postgres data — every Postgres `reviewer_suggestion` row is already a "saved" candidate. The one-shot cleanup's value remains forward-looking (future cycles, future code paths), not retroactive housekeeping.

## Locked decisions

### Data model: 1:1 sidecar (consistent across schema-as-code and live deployment)

The model:

- `wmkf_potentialreviewer` is **global per-person**, identified by email. `getByEmail(email)` returns one row. One person across N proposals = ONE potentialreviewer.
- `wmkf_appresearcher` was **1:1 with `wmkf_potentialreviewer`** (per-person bibliometric snapshot — h_index, ORCID, Scholar). **S213: this sidecar was collapsed — its bibliometric fields now live directly on `wmkf_potentialreviewers`, and the sidecar entity was dropped.** Read the "+ 1 `wmkf_appresearcher`" below as "those fields on the person."
- `wmkf_appreviewersuggestion` is **per-(person, request)** — the lifecycle ledger. `findByPotentialReviewerAndRequest(prId, requestId)`.

So one John Smith on 5 proposals = 1 `wmkf_potentialreviewer` (now carrying his bibliometrics) + 5 `wmkf_appreviewersuggestion` (pre-S213 this also had 1 `wmkf_appresearcher` sidecar).

This model is **consistent across both** the live deployed entities AND the schema-as-code in `wave2/`. Earlier drafts of this plan framed a "pool vs 1:1" decision as an open fork — that was based on misreading the Wave 1 design doc's text rather than checking the schema-as-code in the repo. The schema-as-code already has the 1:1 design. There was never a real fork.

**Cleanup implications** (corrected from "slot" framing in earlier drafts; delivery later changed from cron to one-shot DELETE):
- Drops `wmkf_appreviewersuggestion` rows (per-proposal scratch), NOT `wmkf_potentialreviewer` rows. Dropping a potentialreviewer would erase the whole person.
- The 1:1 sidecar is between potentialreviewer and appresearcher, NOT between either of those and a proposal.
- Orphan-potentialreviewer policy (a person with zero remaining suggestions): defer; persist as stub for future re-suggestion.

Rationale: Reviewer Finder surfaces ~25 candidates per proposal. Selected reviewers promote to `contact` (permanent record). Per-proposal scratch (suggestions for proposals we never invited them to) post-adjudication has no value. Historical lookups about "have we worked with this person before" go through `contact` and the surviving `wmkf_appreviewersuggestion` rows linked to that person's potentialreviewer.

### W3 cutover method: Option B (hard cutover) with loud-fail guard

**Locked S147 2026-05-12 after Codex review.** For W3 specifically, Option B (hard cutover, Dataverse-only, rollback via `git revert` + redeploy) is the chosen method. Rationale: W3 scope is exactly 3 files (`grant-cycles.js`, `render-emails.js`, `send-emails.js`), and the Wave 1 dispatcher footgun (services defaulting to postgres when `WAVE1_BACKEND_*` unset → silent reads from soon-to-be-dropped tables) was the most painful Codex finding of S146. Three-file blast radius doesn't justify the dispatcher overhead.

**Loud-fail guard required.** The rewritten endpoints must throw if `WAVE2_BACKEND_GRANT_CYCLES=postgres` is set in env — mirroring the Wave 1 prefs "explicit postgres fails loudly" posture in `lib/services/database-service.js:27-31`. This prevents an operator setting the flag in good faith and getting silent legacy behavior.

**Rollback contract under Option B:** revert the cutover commit, redeploy. Effective rollback time ~10 min vs. Option A's ~1 min flag-flip. Acceptable for W3's blast radius; revisit per-table for W4+ drain targets.

**For W4+ tables (drain targets), the A vs B decision remains open** — those have different blast radius and may warrant flags. Decide at the start of each weekly window, not as a blanket call.

### Post-pilot one-shot cleanup

Cleanup runs as a one-shot script in the W6/post-pilot table-drop path, not as a scheduled cron. It only fires after the pilot succeeds and the post-pilot checklist reaches the drain-only table drop gate (≥2026-07-01).

**Logic** (corrected 2026-05-07: drops suggestion rows, not potentialreviewer rows):

```
For each akoya_request where wmkf_meetingdate < (today - 14 days):
  For each wmkf_appreviewersuggestion row linked to that request:
    If the suggestion is "engaged" (defined below): keep
    Otherwise: delete the suggestion row only.
    Do NOT delete the linked wmkf_potentialreviewer (global per-person).
    No linked wmkf_appresearcher remains post-S213; bibliometrics live on the global person.
```

**"Engaged" predicate** — keep any `wmkf_appreviewersuggestion` row where any of these signals is populated. Either via the suggestion itself or via the linked `wmkf_potentialreviewer` (global per-person):

On the suggestion (`wmkf_appreviewersuggestion`):
- `wmkf_selected = true`
- `wmkf_emailsentat` populated (we sent invitation/materials)
- `wmkf_responsetype` populated (they responded)
- `wmkf_ExternalTokenIssued` populated (we issued a magic link)
- `wmkf_ProposalFirstAccessed` populated (they engaged with the link)
- `wmkf_ReviewSharePointFolder` populated (review folder was created)
- Any of `wmkf_ReviewerImpact`, `wmkf_ReviewerRisk`, `wmkf_ReviewerOverallRating` populated (they submitted a review form)

On the linked `wmkf_potentialreviewer` (global per-person):
- `wmkf_contact` populated (contact promotion happened — applies to ANY suggestion this person has)

If the linked potentialreviewer has `wmkf_contact` populated (e.g., they accepted on a different proposal), keep the suggestion regardless of its own state — that's a "this person became engaged with us at some point" signal worth preserving for cross-proposal history.

The 14-day grace lets staff dip back into the unselected pool if late acceptances fall through. Reading `wmkf_meetingdate` at cleanup time handles board-moves-the-meeting cases automatically.

**Orphan potentialreviewer policy** (open follow-up): after cleanup runs, some `wmkf_potentialreviewer` rows may have zero remaining `wmkf_appreviewersuggestion` rows. Decision deferred — initial implementation leaves them as stubs. If they accumulate, a separate orphan-cleanup pass can be added later.

**Pre-delete backup**: before any delete, the one-shot script exports the doomed rows (suggestion only) to a JSON blob in Vercel Blob storage with 30-day retention. Provides a manual-restore path if a predicate-bug deletes wrongly. Restore script (`scripts/restore-reviewer-suggestion-cleanup-backup.js`) reads the blob and re-CREATEs the suggestion via `reviewerSuggestionAdapter.upsert`. Re-runnable via the adapter's find-then-update/create (sequential single-instance reruns safe; NOT concurrent-safe; NOT a true Dataverse alternate-key PATCH).

### Engaged suggestion rows = de facto reviewer-history child entity

We don't need a new role-tracking entity. The set of `wmkf_appreviewersuggestion` rows that survive cleanup IS the per-contact reviewer history. Each row carries the lifecycle fields (`wmkf_emailsentat`, `wmkf_responsetype`, `wmkf_reviewreceivedat`, decline reason, response-received-at, review form fields). The post-pilot one-shot cleanup is what turns the table from "current cycle scratch" into "permanent history of engaged reviewers."

The reviewer-history surface for a contact is `wmkf_appreviewersuggestion` rows whose slot (`wmkf_potentialreviewer`) is linked to that contact via `wmkf_contact`. The slot is the join point; the lifecycle data lives on the suggestion. See §"Reviewer-portal data lives on `wmkf_appreviewersuggestion`" below for the field-by-field rationale.

### Reviewer-portal data lives on `wmkf_appreviewersuggestion` (NOT `wmkf_potentialreviewer`)

**Correction from earlier draft.** Reviewer-portal field design is already partly built out as extensions to `wmkf_appreviewersuggestion` — see `lib/dataverse/schema/wave2-existing/wmkf_appreviewersuggestion-extensions.json`. That file already defines:

- External-token lifecycle: `wmkf_ExternalTokenHash`, `wmkf_ExternalTokenIssued`, `wmkf_ExternalTokenExpires`, `wmkf_ExternalTokenRevoked`
- Engagement timestamps: `wmkf_ProposalFirstAccessed`
- Review delivery: `wmkf_ReviewSharePointFolder`, `wmkf_ReviewUploadedByStaff`
- Review form responses: `wmkf_ReviewerAffiliation`, `wmkf_ReviewerImpact`, `wmkf_ReviewerRisk`, `wmkf_ReviewerOverallRating` (with sentinel `99 = unable to answer` on each picklist)

**Implications:**
- The "engagement predicate" for the post-pilot one-shot cleanup reads signals from both sides: (a) suggestion-side signals on `wmkf_appreviewersuggestion` (`wmkf_ExternalTokenIssued`, `wmkf_ProposalFirstAccessed`, any review-form picklist, `wmkf_emailsentat`, `wmkf_responsetype`); and (b) slot-side signals on `wmkf_potentialreviewer` (`wmkf_contact` populated indicates the person was promoted to a contact at some point — a cross-proposal "this person is engaged with us" signal). The keep decision is the union of both — see §"Engaged predicate" above for the full enumerated signal list. Cleanup acts on suggestion rows; the slot itself is never deleted by the script.
- Match-on-discovery's "reviewer history" lookup walks `wmkf_appreviewersuggestion` rows linked through the slot's contact, not just `wmkf_potentialreviewer` rows. The richer suggestion fields (overall rating, response time derived from issued vs. first-accessed) are what surface in the history modal.
- **Net-new columns to add to extensions** (locked S136 2026-05-06):
  - `wmkf_DeclineReason` — multi-line text, optional. Captured at decline-time (magic-link landing page; or staff-entered if reviewer told us by email).
  - `wmkf_ResponseReceivedAt` — datetime, set when `wmkf_responsetype` flips from null to a value. Required for response-latency computation; without it the metric isn't derivable.
- **Derivable, no schema change**:
  - Late/on-time flag = `wmkf_reviewreceivedat` vs. cycle's `wmkf_reviewreturndeadline`.
  - Response latency hours = `wmkf_emailsentat` vs. `wmkf_ResponseReceivedAt`.

## New work in scope

> **§1 below is HISTORICAL — SHIPPED W3 2026-05-12.** The schema patch (`wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`), the preference-shape migration (Postgres integer ID → `wmkf_shortcode`), the alt-keys, and all three-file endpoint rewrites (`grant-cycles.js`, `render-emails.js`, `send-emails.js`) all shipped at W3 cutover. Sections §2–§6 below ("Match-on-discovery", "Contact form view", "Add candidate by hand", "wmkf_apprequestperson junction", "Reviewer-portal field audit") remain in-scope as planned post-pilot or in-cycle work.

### 1. `wmkf_appgrantcycle` entity — preflight, patch schema-as-code, then deploy (HISTORICAL — SHIPPED W3)

**Status (verified 2026-05-07 via `scripts/audit-dataverse-state.js` + EntityDefinitions metadata probe):** the entity IS already deployed (10 custom attrs live), but **with 0 rows and a partial schema** — see [`docs/atlas/postgres-grant-cycles.md`](atlas/postgres-grant-cycles.md) and [`docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md`](atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md). This work is NOT a fresh deploy of the schema-as-code; it's a **schema patch** to add fields the deployed entity is missing.

The schema-as-code file `lib/dataverse/schema/wave2/wmkf_app_grant_cycle.json` defines **11 attributes** (`wmkf_FiscalYearCode`, `wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`, `wmkf_MeetingDate`, `wmkf_SummaryPages`, `wmkf_ReviewReturnDeadline`, `wmkf_ReviewTemplateUrl`, `wmkf_ReviewTemplateFilename`, `wmkf_AdditionalAttachments`, `wmkf_IsActive`) plus the primary name `wmkf_DisplayName`. **Patched into the deployed entity 2026-05-12 (W3 preflight)**: `wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields` — these were originally absent and are now present in both schema-as-code and prod. Both alt-keys declared (`wmkf_fiscalyearcode` and `wmkf_shortcode`); the latter supports cross-table joins from `wmkf_appreviewersuggestion.wmkf_grantcyclecode`.

**Preflight (BLOCKER per Codex S147) — must run BEFORE the schema patch:**

1. **Duplicate-domain audit.** Run a script that enumerates Postgres `grant_cycles.short_code` (incl. `is_active=false` rows) and live `wmkf_appreviewersuggestion.wmkf_grantcyclecode` distinct values. The plan notes inactive duplicate cycle rows for D26/J27/D27 — if duplicates exist within the active set OR across the union, decide collapse strategy first (keep active row, archive duplicates, or rename one). Adding the `wmkf_shortcode` alt-key on a table containing pre-backfilled duplicates would fail; auditing the duplicate domain before deploy avoids that.
2. **Preference-shape migration ships first (BLOCKER per Codex S147 Q4).** The live Reviewer Finder cycle preference (`reviewer_finder_current_cycle_id` in `shared/config/reviewerFinderPreferences.js:7-12`, parsed with `parseInt` in `shared/components/SettingsModal.js:101-103` and `pages/reviewer-finder.js:748-756`) expects a Postgres integer ID. A Dataverse GUID will not survive `parseInt`. Before the schema patch (or at minimum before the endpoint cutover), migrate the preference storage to use `wmkf_shortcode` (string) and rewrite the three consumer sites to resolve cycles by shortcode-alt-key, not numeric ID. Ship as its own commit so the preference layer is GUID-safe before any backend swap.

**Rollout-safety policy for the preference-shape migration (Codex S147 re-review #2).** Because some users will have an integer-shaped cycle pref stored at the moment the new code deploys, the rewrite must tolerate both shapes for one release window. **The policy must apply to BOTH preference backends:**

- `PREFERENCE_KEYS.CURRENT_CYCLE_ID` — server-side Dataverse `wmkf_appuserpreferences` row.
- `STORAGE_KEYS.CURRENT_CYCLE` — client-side localStorage legacy fallback (still live; `SettingsModal.js:173` migrates this into Dataverse on first profile selection).

**Writer policy (applies to both backends):** write shortcode only (new shape) — `String` like `"J26"`, never a number.

**Reader policy (applies to both backends):** accept either shape on read. If `parseInt(stored)` produces `NaN`, treat the stored value as a shortcode and resolve via `wmkf_shortcode` alt-key. If `parseInt(stored)` succeeds, look up the cycle by Postgres `id`, then resolve the corresponding `wmkf_shortcode`, then opportunistically write-back the shortcode form to the same backend (turn the legacy value into the new shape on next access). If neither lookup resolves, fall back to the default-active cycle and clear the stored value.

**localStorage→Dataverse migration normalization (`SettingsModal.js:173`).** The existing first-time-profile-selection migration step that copies `STORAGE_KEYS.CURRENT_CYCLE` into Dataverse **must normalize integer values to shortcode before calling `setPreference`** — never copy the legacy integer verbatim. Implementation: pass the value through the reader policy above to resolve to shortcode, THEN write the shortcode-shaped value to Dataverse. Without this, the localStorage→Dataverse promotion would silently re-introduce integer-shaped values on the Dataverse side.

**Per-component coverage:**

- **`pages/reviewer-finder.js:748-756`** — already has graceful-degradation by accident: `parseInt('J26', 10)` → `NaN` → `find` returns `undefined` → `relevantCycles[0]` default-active fallback at line 756. Still, the new reader policy must replace the parseInt-only branch so opportunistic write-back and proper shortcode-resolve happen.
- **`shared/components/SettingsModal.js:101`** — currently assigns the stored value to `currentCycleId` at line 138 with **no `NaN` guard**. Stale clients receiving shortcode-shaped values would show no current-cycle selection in the settings UI (not graceful-fallback-to-default; this is a distinct failure mode from the main page). Fix: NaN-guard at line 138 must route through the reader policy and fall back to the default-active cycle if neither shape resolves.
- **`shared/config/reviewerFinderPreferences.js`** — the central reader helper (if added) should encapsulate the tolerant-read + write-back logic so all three consumers route through it.

**Deploy ordering:** new (tolerant) reader and shortcode-only writer ship in the same commit since both touch the same files. There is no two-deploy sequence required. The "tolerant reader" branch can be removed in a follow-up commit ≥1 week after deploy, once telemetry confirms no remaining integer-shaped values in stored prefs (sample Dataverse `wmkf_appuserpreferences` rows + a brief localStorage telemetry log on read).

**Stale-client behavior during deploy window:** `pages/reviewer-finder.js` degrades gracefully (default-active fallback per the existing parseInt→NaN→find-miss path). **`SettingsModal` does NOT degrade gracefully under stale code** — until the user reloads to the new bundle, the settings UI may show no current-cycle selection if the shortcode-shaped value has already been written by the new code on another session. Acceptable since the user can still pick a cycle manually in the UI; surface this in the W3 release notes.

**W3 schema-patch task (after preflight):** patch `lib/dataverse/schema/wave2/wmkf_app_grant_cycle.json` to add the three missing attributes AND a second alt-key entry for `wmkf_shortcode`, then re-run `apply-dataverse-schema.js`. After patch the deployment will catch up. Verify both alt-keys (`wmkf_fiscalyearcode`, `wmkf_shortcode`) are present and indexed via EntityDefinitions probe before proceeding.

The full field mapping below names every Postgres column. Postgres columns marked **0% populated** in live data are non-blocking — schema captured for forward compatibility, no data to migrate.

**Full field mapping** (every Postgres column accounted for):

| Postgres column | Dataverse column | Type | Notes |
|---|---|---|---|
| `id` (int PK) | `wmkf_appgrantcycleid` (GUID, native) | — | Postgres ID does not migrate — references rewrite to GUID. |
| `short_code` | `wmkf_shortcode` | Text (10) | **Alternate key.** Matches the cycle codes from `cycle-code.js` (J26, D23). Used in cross-table joins from `wmkf_appreviewersuggestion.wmkf_grantcyclecode` (text). |
| `name` | `wmkf_displayname` | Text (255) | Primary name attribute. e.g., `"June 2026 Board Meeting"`. |
| `program_name` | `wmkf_programname` | Text (100) | Friendly program label per cycle. |
| `summary_pages` | `wmkf_summarypages` | Text (50) | Per-cycle reviewer summary length config (e.g. `"2"`, `"1,2"`). |
| `review_deadline` | `wmkf_reviewreturndeadline` | Date | **0% populated in live data.** Optional. Renamed to `wmkf_reviewreturndeadline` to match deployed entity. |
| `review_template_blob_url`, `review_template_filename` | `wmkf_reviewtemplateurl`, `wmkf_reviewtemplatefilename` | Text (500) | Vercel Blob URL + filename. **0% populated in live data.** Schema captured for forward compatibility; no data to migrate. |
| `additional_attachments` | `wmkf_additionalattachments` | Multi-line text | JSONB → JSON-as-text. **0% populated in live data (verified 2026-05-06).** Optional column; no migration logic needed. |
| `custom_fields` | `wmkf_customfields` | Multi-line text | JSONB → JSON-as-text. **0% populated in live data.** Optional column. |
| `is_active` | `wmkf_isactive` | Yes/No | Drives the active-vs-archived distinction; **Postgres has no `is_archived` column**, the original Codex-flagged concern was unfounded. |
| `created_at`, `updated_at` | native `createdon`, `modifiedon` | DateTime | Built-in. |

**Derived (not in Postgres `grant_cycles`)** — populated from joins to `akoya_request`:

| Dataverse column | Source | Notes |
|---|---|---|
| `wmkf_meetingdate` | `akoya_request.wmkf_meetingdate` for the matching cycle | Denormalized for query speed; drift watched by reconciliation report. |
| `wmkf_fiscalyearcode` | `akoya_request.akoya_fiscalyear` for the matching cycle (e.g., `"June 2026"`) | Used for joins from `akoya_request`. |

**Counts (derived, not stored)**: pre-W3 `grant-cycles.js` JOINed `proposal_searches` and `reviewer_suggestions` for per-cycle proposal/candidate counts. SHIPPED W3 cutover (2026-05-12) — the rewritten endpoint queries Dataverse: `akoya_request` filtered by `akoya_fiscalyear = <code>` for proposal count; `wmkf_appreviewersuggestion` filtered by `wmkf_grantcyclecode = <shortcode>` for candidate count.

**Per-user current-cycle preference** (today held in Dataverse `wmkf_appuserpreferences` via the `database-service.js` dispatcher; Postgres `user_preferences` dropped 2026-05-12). New code reads cycle GUID OR shortcode from prefs and resolves via alt-key.

Naming follows live convention `wmkf_app<name>` (no underscore — matches existing live entities, **not** the Wave 1 doc's proposed `wmkf_app_<name>`).

### 2. Match-on-discovery + history badges

The most visible payoff of the migration. Surfaces "have we worked with this person before" at the moment a PD is choosing candidates.

**Match-on-discovery** — runs in the discovery flow after contact enrichment, before ranking:

For each candidate with email or ORCID:
1. Lookup contact via `contact.emailaddress1` (exact, normalized) → `contact.wmkf_orcid` (exact). Skip name+affiliation fuzzy at discovery time; that's expensive and noisier.
2. If matched, attach `contactId` to the candidate record.

**History lookup** — for matched candidates, two queries:

- **Reviewer history**: `wmkf_appreviewersuggestion` rows whose slot (`wmkf_potentialreviewer`) has `wmkf_contact eq <id>` AND the suggestion has an engagement signal (any of `wmkf_emailsentat`, `wmkf_responsetype`, `wmkf_reviewreceivedat`, or `wmkf_externaltokenissued` populated). Returns: request number, meeting date (→ cycle code via `cycle-code.js`), response type, dates, decline reason, review form fields.
- **PI/co-PI history**: UNION of (a) `akoya_request` rows where `_wmkf_projectleader_value eq <id>` and (b) `wmkf_apprequestperson` rows where `wmkf_contact eq <id>`. Steady-state per §"Junction read strategy" — projectleader stays authoritative for lead PI, junction is additive for co-PIs.

**Batching** — 25 candidates × 2 queries = 50 round trips per discovery run. Use `$batch` or pre-fetch in two queries (`wmkf_contact in (...)` and `_wmkf_projectleader_value in (...)`). Latency matters; PDs are at the screen waiting.

**UI badges on each candidate card**:

- **🔁 Reviewed 2× (last J26)** — recency-colored: green > 2 cycles ago, amber 1 cycle ago, red current cycle (the latter would be a bug, surface it as a warning)
- **🚫 Declined 3×** — separate badge; "they're saying not interested"
- **💰 Funded PI 1× (D23)** — past-grantee signal; potential COI flag if recent or topically related

Click any badge → modal with the full history list.

### 3. Contact form "Reviewer history" view

A "Reviewer history" subgrid (or tab) on the standard `contact` form. Lists `wmkf_appreviewersuggestion` rows linked to this contact via the slot's `wmkf_contact`. Columns: cycle code (derived from request's `wmkf_meetingdate`), request number (clickable), response type, materials sent date, review submission date, overall rating (when populated). Read-only.

Same data as the picker-side history modal (§2), surfaced from the contact side for staff who open a contact in Dynamics directly.

**Not bundled with pilot account-form work.** The pilot adds AO/Liaison lookups + institutional file fields to `account`, NOT to `contact`. So this is a separate ask for Connor — net-new contact-form change. Locked S136 2026-05-06: Justin opted to ask now rather than defer post-pilot, since the picker modal alone wasn't a sufficient reason to delay native contact-form access.

Optionally (later, not in pilot scope): derived summary fields on contact, recomputed on a cron — `wmkf_lastreviewedcycle`, `wmkf_avgresponsetimehours`, `wmkf_declinecount`. Nice-to-haves.

### 4. "Add candidate by hand" (net-new, replaces retired Database tab)

Today the Reviewer Finder Database tab has a "Create researcher" button that adds a row to the legacy Postgres `researchers` pool. Justin's actual usage was **adding reviewers PDs already knew about**, not browsing the pool. Under the 1:1 model the seed-the-pool target goes away, so this becomes a net-new feature attached to a specific proposal.

**UX**: a button on the My Candidates tab (per-proposal scope) — "Add candidate by hand." Opens a small modal:

| Field | Required | Notes |
|---|---|---|
| Name | yes | |
| Email | yes | Same email-required gate as save-candidates uses; required for match-on-promote later. |
| Affiliation | yes | |
| Expertise / why chosen | yes | Free text, mirrors `wmkf_appreviewersuggestion.wmkf_matchreason`. |
| ORCID | no | If supplied, used for match-on-discovery against existing contacts before write. |

**Write path**: identical to `save-candidates.js` for a single candidate — `potentialReviewerAdapter.upsertByEmail` + `researcherAdapter.upsertByPotentialReviewer` (with whatever bibliometric fields the user supplied; mostly null) + `reviewerSuggestionAdapter.upsert` with `wmkf_selected = true`. Match-on-discovery still runs (against contact) so we don't create dupes.

**Endpoint**: `POST /api/reviewer-finder/add-candidate-manual`. Same auth as `save-candidates.js` (`requireAppAccess('reviewer-finder')`). Single-candidate variant of the existing flow; ~half-day implementation.

### 5. `wmkf_apprequestperson` junction (PI + co-PI history)

Net-new junction table to support the PI/co-PI history badge. Locked S136 2026-05-06 — Connor's preference for junctions + cleaner long-term shape.

**Read strategy** (revised 2026-05-07 after Codex review): the junction supersedes the **co-PI** half of the legacy query (`_wmkf_copi1..5_value`) but **not** the PI half. Since `_wmkf_projectleader_value` stays live and is used by other flows that are not aware of the junction, the contact-history endpoint must read it as an authoritative parallel source — **not** treat it as a fallback that gets suppressed when the junction has any rows. Effective query:

```
junction rows for contact (role = pi OR copi)
  UNION
akoya_request rows where _wmkf_projectleader_value = contact
```

This avoids both transition-window failure modes Codex flagged: (a) backfill ran, PA dual-write hasn't, projectleader changes silently disappear from history; (b) PA misses an update, junction `pi` row goes stale, projectleader is right but ignored.

Pre-junction-deploy (today): the 6-OR query continues to work. Post-junction-deploy, pre-PA-flow-cutover: the UNION above. Post-PA-flow-cutover: same UNION (PA dual-writes; either source is authoritative for PI; junction is sole source for co-PI).

| Column | Type | Notes |
|---|---|---|
| `wmkf_request` | Lookup → akoya_request | |
| `wmkf_contact` | Lookup → contact | |
| `wmkf_role` | Choice | `pi \| copi`. Reviewers stay on `wmkf_potentialreviewer`; AO/Liaison are account-level per pilot scope — out of this junction. |
| `wmkf_authorposition` | Whole number, optional | 0 for PI, 1–5 for co-PI slot. |

Alt key: `(wmkf_request, wmkf_contact, wmkf_role)`.

**Population:**

1. **One-time backfill** (`scripts/backfill-request-person-junction.js`) — walks every `akoya_request`, writes one row per populated PI/co-PI lookup. ~1,000 requests × ~3 populated avg ≈ ~3,000 rows. **Sequential writes** (the built script logs every 100 rows; an earlier draft of this plan said "single `$batch` op" which is wrong — Dataverse `$batch` caps at 1000 requests anyway, and the script implements per-row writes with dedup-guard). If a future optimization wants `$batch`, chunk at ≤1000.
2. **Ongoing sync** — PA flow on `akoya_request` create/update reads PI + co-PI 1–5, upsert/delete junction rows. **Connor's territory.**
3. **Read-side strategy (revised 2026-05-07)** — `/api/reviewer-finder/contact-history` does the UNION described in **Read strategy** above (junction OR `_wmkf_projectleader_value`). Not a fallback — projectleader stays authoritative for PI in parallel with the junction. This is the steady-state read; nothing to remove post-pilot.

**Resolved 2026-05-07** (both open Connor questions, jointly):
- Junction-table preference **does** extend to vendor-indexed data — `wmkf_apprequestperson` proceeds as spec'd.
- Ongoing sync is **net-new PA flows**, not an extension. Connor will build PA flows on `akoya_request` create/update that (a) create `contact` records as needed and (b) write junction rows directly.
- **`_wmkf_projectleader_value` (PI lookup) stays live** — used by other flows unrelated to reviewers; PA flows dual-write (projectleader field + junction `pi` row). Only the **co-PI slots** (`_wmkf_copi1..5_value`) become obsolete read-only legacy data once backfill + PA flows are live.
- Backfill script remains Justin/Claude's job.

### 6. Reviewer-portal field audit

Confirm `wmkf_appreviewersuggestion` (where reviewer-portal data lives — see "Reviewer-portal data lives on `wmkf_appreviewersuggestion`" section above) has columns for everything the portal will capture. Net-new fields locked S136: `wmkf_DeclineReason`, `wmkf_ResponseReceivedAt`. Late/on-time and response-latency derive from existing timestamps. Connor coordination only on whether anything else surfaces during portal build that isn't in the extensions JSON.

## Reviewer suggestions backfill

> **HISTORICAL — backfill, reconciliation, and W5 reader cutover all SHIPPED 2026-05-12.** The parity probe, anomaly triage, identity contract, and execution model below describe the planned approach; the work has run and the readers (`generate-emails.js`, `my-proposals.js`, `database-service.js`) are all Dataverse-only per the spec-vs-built table at top.

### Parity probe result (2026-05-06 baseline, REFRESH AT W4 START)

The Wave 2 backfill was a known forward task per memory entry `project_reviewer_history_data_quality.md`, which previously cited *"the Wave 2 backfill (333 Postgres rows → Dataverse)"*. The parity probe confirms what that memory implied — most rows already match.

**W4 must re-run this script as Day 1 step 1.** The numbers below are S136 baseline; W3 acceptance gate 6/7/8 (2026-05-12) surfaced an additional 2-row J26 PG↔DV drift not present in the S136 dry-run, so the live anomaly queue is **10+ rows, not 8**. Treat the table below as historical baseline only — actual W4 triage queue comes from the re-run.

`scripts/backfill-reviewer-suggestions-parity.js` ran a dry-run classification of all 337 Postgres `reviewer_suggestions` rows against live Dataverse. **Result (S136 baseline):**

```
A   already in Dataverse (matching wmkf_appreviewersuggestion):  329 rows  (97.6%)
B   active cycle, would backfill:                                  0 rows
C2  closed cycle + engagement, backfill for history:               0 rows
C1  closed cycle, no engagement, discard:                          0 rows
Anomaly:                                                           8 rows
```

**The backfill workstream collapses to anomaly triage.** No Group B or Group C2 rows means there is nothing meaningful to copy from Postgres → Dataverse beyond the 8 anomalies. The 329 Postgres rows in Group A are stale duplicates of already-existing Dataverse rows; dropping the Postgres table at decommission loses no data.

The 8 anomalies trace cleanly to known data-quality gaps in the audit:
- 4 rows missing email (exactly the 4 `researchers` rows where email is null)
- 4 rows missing `request_number` (exactly the 4 `reviewer_suggestions` with null request_number)
- All 8 are J26 (current cycle); zero overlap between the two anomaly types

**Action**: triage the 8 anomalies manually before decommission. Most likely: the 4 missing-email rows are saved candidates whose email failed enrichment but who never got invited (no engagement signals on any of them, verifiable in raw data); the 4 missing-`request_number` rows pre-date the addition of the `request_number` column. Either fix or accept loss; document each.

### Why this collapse is real

`pages/api/reviewer-finder/save-candidates.js` writes Dataverse-only today, but at some prior point it wrote both Postgres and Dataverse — the 97.6% Group A overlap is consistent with sustained dual-write history rather than recent Dataverse adoption. The Postgres-only window must have been brief.

**Operational implication**: the original "reviewer-suggestions backfill is a large blocker" framing is wrong. 329/337 rows already match Dataverse; only 8 anomalies need triage. The backfill commit-mode run is scheduled in W4 per the refreshed schedule below; endpoint rewrites for `reviewer_suggestions` readers (`generate-emails.js`, `my-proposals.js`, `maintenance-service.js`, `database-service.js`) are in W5. `extract-summary.js` retires entirely in W5 step 5 — no rewrite, no Dataverse counterpart.

### Patch precedence (residual, only matters if anomaly triage finds anything migrate-worthy)

In the unlikely case that any of the 8 anomalies turns out to be a real Postgres-only row that should land in Dataverse, the patch precedence rules below apply. Otherwise these are vestigial.

### Identity contract (resolves Codex BLOCKER)

The backfill writer must establish three precise mappings before writing any Dataverse row. **No `(proposal_id, email)` shortcut** — Postgres `proposal_id` is the first chars of the proposal title, NOT a cycle code or request identifier.

**1. Postgres `request_number` → Dataverse request GUID**

```
SELECT akoya_requestid FROM akoya_request WHERE akoya_requestnum = $1
```

`reviewer_suggestions.request_number` is 99% populated. For the 1% missing, use `grant_cycle_id → grant_cycles.short_code` to identify the cycle, then **fail with manual-reconciliation flag** rather than guess. Do not auto-resolve ambiguous rows.

**2. Postgres email → Dataverse `wmkf_potentialreviewer` (global per-person)**

```
SELECT wmkf_potentialreviewerid FROM wmkf_potentialreviewer
WHERE wmkf_email = $1
```

`wmkf_potentialreviewer` is global-per-person (one row across N proposals; see §"Data model: 1:1 sidecar"). The per-(person, request) ledger lives on `wmkf_appreviewersuggestion`, not on the potentialreviewer row. Email source: `researchers.email` joined via `reviewer_suggestions.researcher_id` (99% populated). If no matching row exists (Group B/C2 cases), create one via `potentialReviewerAdapter.upsertByEmail` — same code path `save-candidates.js` uses.

**3. Idempotency on Dataverse write**

Use the alt key `(wmkf_request, wmkf_potentialreviewer)` on `wmkf_appreviewersuggestion`. Dataverse adapter `reviewerSuggestionAdapter.upsert` already does this; the backfill calls into it rather than reimplementing.

### Patch precedence (Group A handling)

When a Dataverse row already exists for `(request, slot)`:

| Field type | Rule |
|---|---|
| Lifecycle timestamps (`wmkf_emailsentat`, `wmkf_responsereceivedat`, `wmkf_reviewreceivedat`, etc.) | Patch only if Dataverse field is null AND Postgres has a value. Dataverse is authoritative once populated. |
| `wmkf_responsetype`, `wmkf_reviewstatus` | Same as above. Picklist values mapped per "Picklist value mapping" section. |
| `wmkf_summaryblobeurl`, `wmkf_reviewblobeurl` | Patch only if Dataverse null. URL validation: `HEAD` request must return 200; if 404, log as anomaly and skip the field. |
| `wmkf_selected`, `wmkf_invited`, `wmkf_declined`, `wmkf_accepted` (legacy booleans) | Patch only if Dataverse null. |
| Any field already populated in Dataverse | **Never overwrite.** Log as `PRESERVED_DV` in parity report. |

### Backfill execution model + partial-failure repair

`scripts/backfill-reviewer-suggestions-to-dataverse.js`:

1. **Build parity report (dry-run, no writes)**:
   ```
      Group A (in DV, may need gap-patch):    N rows
      Group B (active, full backfill):        M rows
      Group C1 (closed, no engagement, discard): K1 rows
      Group C2 (closed, has engagement, backfill for history): K2 rows
      Anomalies (missing request_number, missing email, malformed): X rows  ← STOP if X > 0
   ```
2. **Human review.** Anomalies must be zero before commit.
3. **Commit phase** (`--commit` flag required): processes in batches of 50. After each batch, writes a checkpoint to `backfill-progress.json` recording `{ lastProcessedPostgresId, dataverseGuidsCreated[], errors[] }`.
4. **Failure mid-batch**: rerun resumes from `lastProcessedPostgresId + 1`. Idempotent because of step 3's alt-key UPSERT — re-attempting a created row patches rather than duplicates.
5. **Catastrophic failure (Dataverse outage mid-commit)**: pause the cron and any in-progress cutover (flag-flip under Option A, deploy under Option B), fix Dataverse, rerun. Checkpoint protects forward progress.

**No dual-write window.** The backfill is a one-shot data move, not a sustained dual-write pattern. Once done, cutover swaps source-of-truth atomically — by `WAVE2_BACKEND_*` flag flip (Option A) or by `git revert` + redeploy (Option B). See "No dual-write" subsection under Rollback Strategy below.

### Per-user scoping change

Postgres `reviewer_suggestions` filters by `user_profile_id` in places (e.g., `generate-emails.js:57` enforces "only your own saved candidates"). Dataverse `wmkf_appreviewersuggestion` is org-visible by default. **This is an intentional model change**: post-migration, all PDs see all suggestions; the "my candidates" filter becomes a UX convenience (filter on `_ownerid_value` or `_wmkf_programdirector_value` of the linked request), not a security boundary. Document explicitly so the cross-user-isolation tests can be updated rather than failing silently.

## Picklist value mapping

The `wmkf_appreviewersuggestion` adapter (`reviewer-suggestion.js:57`) **throws on unknown picklist values**. Two existing maps must be respected by anything writing into the entity:

| Postgres `response_type` | Dataverse picklist value |
|---|---|
| `accepted` | (look up in adapter `RESPONSE_TYPE_MAP`) |
| `declined` | (same) |
| `no_response` | (same) |

| Postgres `review_status` | Dataverse picklist value |
|---|---|
| `accepted` | (look up in adapter `REVIEW_STATUS_MAP`) |
| `materials_sent` | (same) |
| `under_review` | (same) |
| `review_received` | (same) |
| `complete` | (same) |

**Net-new picklists from extensions**: `wmkf_ReviewerImpact` (1–4 + 99 sentinel), `wmkf_ReviewerRisk` (1–4 + 99), `wmkf_ReviewerOverallRating` (1–5 + 99). Backfill never writes these — they originate at review submission time. Aggregations always filter `< 99`.

**Validation**: backfill rejects rows with picklist values not in the adapter maps — log to `Anomalies` count, do not coerce.

## Silent truncation gotcha

The `wmkf_potentialreviewer` adapter clamps `wmkf_organizationname` and `wmkf_areaofexpertise` to 100 chars (`lib/dataverse/adapters/potential-reviewer.js:43`). Existing comment is honest: *"speculative caps would silently truncate legitimate values."*

Backfill must:
- Log when truncation occurs with the original full string in the parity report.
- Treat truncation as a yellow flag, not a blocker. (100-char affiliation is rare; expertise often longer.)
- For expertise: if the original is a multi-clause string, truncate at the last `;` or `,` before 100 chars rather than mid-word.

Audit: are there other 100-char (or other) caps elsewhere in the adapter set? Run a one-off scan before pilot.

## Endpoint rewrite scope

> **HISTORICAL — all rewrites in this section shipped W3 + W5 (2026-05-12).** See "Drain-target endpoint inventory" (line 38) and "Spec'd vs. built" (line 13) for the current per-file shipped status. The dispositions below ("Read from X; write Y", "Rewrite all sites", "Retire entirely") describe the intent at planning time; the post-shipping state lives in the inventory table at top.

| Endpoint | Today | Migration work |
|---|---|---|
| `pages/api/reviewer-finder/discover.js` | Cache lookup via `DatabaseService.findResearcher` (Postgres `researchers`) | Replace cache lookup with match-on-discovery against `contact`. Drop Postgres dependency. |
| ~~`pages/api/reviewer-finder/researchers.js`~~ | Admin pool CRUD over `researchers` / `researcher_keywords` / `publications` | **RETIRED 2026-05-12** in W6 step 1 (was locked S136 2026-05-06). Endpoint deleted; Database tab UI removed. Will be replaced post-pilot by net-new "Add candidate by hand" feature. |
| `pages/api/reviewer-finder/generate-emails.js` | Reads `reviewer_suggestions`, writes `email_sent_at` | Read from `wmkf_appreviewersuggestion`; write `wmkf_emailsentat` on `wmkf_appreviewersuggestion`. |
| `pages/api/reviewer-finder/extract-summary.js` | Reads `proposal_searches` as IDOR guard (broken — table empty); writes `reviewer_suggestions` | **RETIRED W5 (2026-05-12).** Endpoint removed; UI caller in `pages/reviewer-finder.js` updated. Original disposition (locked S136): retire entirely rather than rewrite. |
| `pages/api/reviewer-finder/grant-cycles.js` | Direct `sql\`\`` against `grant_cycles` (5+ sites) **plus** `proposal_searches` and `reviewer_suggestions` reads | **SHIPPED W3 cutover (2026-05-12).** All sites rewritten against `wmkf_appgrantcycle` (alt-key by short_code). Scope shipped: (a) per-cycle proposal counts via `akoya_request` filtered on `akoya_fiscalyear`; (b) per-cycle candidate counts via `wmkf_appreviewersuggestion` filtered on `wmkf_grantcyclecode`; (c) unassigned candidate count via null-`wmkf_grantcyclecode` filter; (d) duplicate-check by alt-key collision; (e) soft-delete via PATCH `wmkf_isactive=false`. |
| **`pages/api/review-manager/render-emails.js`** | `loadCycleConfigs()` reads `grant_cycles.{short_code, name, program_name, review_deadline, custom_fields}` | **SHIPPED W3 (2026-05-12).** `loadCycleConfigs()` reads `wmkf_appgrantcycle` via `lib/services/grant-cycles-dataverse`. Was missed in earlier scoping which described Review Manager as fully Dataverse-only. |
| **`pages/api/review-manager/send-emails.js`** (scope addition) | `loadCycleConfigs()` reads `grant_cycles.{short_code, review_template_blob_url, additional_attachments}` | Same rewrite. |
| `pages/api/reviewer-finder/my-proposals.js` | Mixed Postgres + Dataverse | Pick Dataverse; remove Postgres path. |

**Endpoints already built (S139):**

- `pages/api/reviewer-finder/contact-history.js` — **single-contact lookup**. GET query: `?contactId=<guid>`. Returns: `{ reviewerHistory: [...], piHistory: [...] }`. UNION-with-projectleader read strategy. Used by the picker UI to populate badges (consumer wiring is still to build). Earlier drafts of this plan described a batched POST shape — that was never built; batch shape is a post-pilot enhancement (see §"Match-on-discovery + history badges" for the eventual 25-candidate batching need). Codex S147 pre-W4 review Q5 caught the drift 2026-05-12.

**Net-new endpoints still to build:**

- `pages/api/reviewer-finder/add-candidate-manual.js` — net-new "add candidate by hand" feature, replaces retired Database tab. Writes to `wmkf_potentialreviewer` (identity + bibliometrics on the person, post-S213) and `wmkf_appreviewersuggestion` via existing adapters.

**Service-layer rewrites:**

- `lib/services/database-service.js` — researcher/publication/keyword paths gutted; suggestion paths point at `wmkf_appreviewersuggestion`.
- `lib/services/discovery-service.js` — calls `DatabaseService.findResearcher` (1 of 3 callers, verified via Atlas). Replace with match-on-discovery against `contact`.
- `lib/services/deduplication-service.js` — calls `DatabaseService.findResearcher` (2 of 3 callers). Reads candidates from Dataverse instead of Postgres; logic unchanged.
- `lib/services/contact-enrichment-service.js` — **MIGRATED W5 (writeback shipped 2026-05-??).** Writes identity through `potentialReviewerAdapter.upsertByEmail` and bibliometrics through `researcherAdapter.upsertByPotentialReviewer`; post-S213 the researcher adapter targets the person entity set `wmkf_potentialreviewerses`, not a sidecar. The original Postgres-writer scope ("rewrite the writer to upsert against Dataverse") is complete.
- New: `lib/services/contact-history-service.js` — encapsulates the match-on-discovery + history aggregation.

**No change:** `pubmed-service.js`, `arxiv-service.js`, `biorxiv-service.js`, `chemrxiv-service.js`, `orcid-service.js`, `serp-contact-service.js`, `claude-reviewer-service.js`. External-DB clients don't care where we persist.

## UI changes (`pages/reviewer-finder.js`)

31 fetch sites. HTTP contracts mostly unchanged so most call sites don't move. New work:

- **Candidate card** — render history badges. New props: `contactId`, `reviewerHistory`, `piHistory`. Bulk-fetch via `/api/reviewer-finder/contact-history` after discovery returns.
- **History modal component** — clickable badge → modal listing each event with request number link, cycle code, response type / decision, date. Color-code recency.
- **ID format sweep** — Postgres researcher IDs were `INTEGER`; Dataverse equivalents are GUIDs. Audit anywhere a researcher ID is used as a React key, compared with `===`, or coerced via `parseInt`.

## Dependency order

> **HISTORICAL — items 1–11 below all shipped 2026-05-12 (W3 + W4 + W5 + W6 step 1).** The numbered queue describes the original ordering. Tail items still pending: the post-pilot one-shot Postgres table drop + restore script (W6 step 2, deferred per §"Post-pilot one-shot cleanup" at line 191 and the post-pilot row of the schedule below; one-shot script, NOT a cron — earlier framings that called this a cron were wrong) and match-on-discovery / add-candidate-manual / contact-form-subgrid (slip-eligible enhancements, deferred to post-pilot). See "Spec'd vs. built" table at top for current per-deliverable state.

Hard constraints (each blocks the step after it):

1. **Decisions locked** (no longer dependency-order items): `researchers.js` retires; `extract-summary.js` retires entirely; one-shot cleanup predicate; 14-day grace; junction approach; **W3 cutover method = Option B with loud-fail guard (locked S147)**.
2. **W3 preflight (BLOCKER per Codex S147).** Two prerequisites run before the schema patch:
   - **2a. Duplicate-domain audit.** Script enumerates Postgres `grant_cycles.short_code` (active + inactive) and Dataverse `wmkf_appreviewersuggestion.wmkf_grantcyclecode` distinct values; decide collapse strategy for any duplicate set before the alt-key is added.
   - **2b. Preference-shape migration.** Rewrite cycle preference storage to use `wmkf_shortcode` (string) instead of Postgres integer ID. Three consumer sites: `shared/config/reviewerFinderPreferences.js`, `shared/components/SettingsModal.js`, `pages/reviewer-finder.js:748-756`. Ships as its own commit so the preference layer is GUID/shortcode-safe before any backend swap.
3. ~~**Schema patch.**~~ **SHIPPED 2026-05-12 (W3 preflight).** All three previously-missing fields (`wmkf_ShortCode`, `wmkf_ProgramName`, `wmkf_CustomFields`) and the second alt-key (`wmkf_shortcode`) are now defined in `lib/dataverse/schema/wave2/wmkf_app_grant_cycle.json` and deployed to prod. Cycle data uses these fields end-to-end.
4. **`grant_cycles` data backfill.** Idempotent upsert keyed on `wmkf_shortcode` — dry-run first, prints create/update/skip per row, patches only null/empty fields by default, explicit `--overwrite` flag required for non-null existing Dataverse values. Only 13 rows.
5. **`grant_cycles` migration + cutover.** Three-file scope (verified 2026-05-12 grep): `pages/api/reviewer-finder/grant-cycles.js`, `pages/api/review-manager/render-emails.js`, `pages/api/review-manager/send-emails.js`. Cutover method = Option B (hard cutover, see §"W3 cutover method"). Must complete **before email flows are migrated** — `generate-emails.js` reads cycle attachment settings indirectly through `grant-cycles.js`, so cycle data must be Dataverse-resident first. Postgres `grant_cycles` is the only Wave 2 table that actually migrates (the rest drain).
6. **Reviewer-suggestions parity triage** (8-row delta). Per Codex 3b: before commit-mode backfill, decide each row's true status — genuine missed sync vs. legitimate Postgres-only artifact. Then commit-mode the genuine misses. Required before `generate-emails.js` and `my-proposals.js` cutover (lifecycle counts depend on full Dataverse state).
7. **Junction backfill commit-mode run.** Execute `scripts/backfill-request-person-junction.js` against prod (~3,000 rows). After this, the junction holds the canonical co-PI history (additive). Per §"Junction read strategy," both reads are steady-state: projectleader stays authoritative for lead PI, junction is additive for co-PIs. Neither retires post-pilot.
8. **`my-proposals.js` lifecycle counts** (`pages/api/reviewer-finder/my-proposals.js:153`). Cutover after step 6 verifies.
9. **`maintenance-service.js` blob orphan scanner.** **SHIPPED W5 (2026-05-12).** `cleanupBlobs()` reads Dataverse `wmkf_appgrantcycle.wmkf_reviewtemplateurl` and `wmkf_appreviewersuggestion` blob URLs (per row 54 of "Spec'd vs. built"). Original Postgres reads (`proposal_searches`, `grant_cycles`, `reviewer_suggestions`) are gone; `proposal_searches.full_proposal_blob_url` intentionally omitted (table empty).
10. **`lib/services/database-service.js` researcher/publication/keyword methods.** Either gut (if no remaining callers) or rewrite to delegate to Dataverse adapters. Codex 5 — heavy consumer. Reachable from `discovery-service.js`, `deduplication-service.js`, `contact-enrichment-service.js`.
11. **Cleanup predicate + backup contract.** Historical queue item later changed from cron to one-shot DELETE; keep the engaged predicate and backup-on-delete requirement, but execute through the post-pilot table-drop path.
12. **Match-on-discovery service + discovery-service.js wiring.** Read-only; ships anytime after step 7.
13. **`WAVE2_BACKEND_*` decision for W4+ drain targets.** W3 is locked as Option B (see §"W3 cutover method"). For each W4+ table, decide A vs B at the start of its window, not as a blanket call.
14. **Cutover (W4+ drain targets).** Service layer flips per-table. Method depends on step 13 decision.
15. **Cleanup real-mode.** Historical queue item later changed from cron to one-shot DELETE. Earliest 14 days post-cutover. **`scripts/restore-reviewer-suggestion-cleanup-backup.js` must exist before this step.**
16. **Decommission.** Drop Postgres tables after 14+ days clean.

**Post-pilot enhancements (descoped from critical path):**
- History badges UI in Reviewer Finder (additive UX; ships after the data layer is clean).
- `add-candidate-manual.js` endpoint + UI (decision needed: do PDs accept discovery-only candidate entry for pilot? If yes, defers post-pilot; if no, must ship in step 10 window).
- Contact form "Reviewer history" subgrid (Connor's separate build; not in pilot critical path).

**Zero-downtime stance**: this migration is zero-downtime by design. Postgres tables stay readable until step 12, giving us inspection-after-cutover regardless of which Option (A or B) is chosen. Under Option A, per-table `WAVE2_BACKEND_*` flags also allow rapid flip-back. No maintenance window planned. If a step requires one, it's a sign the step should be split.

**In-flight SSE — only relevant under Option A**: `discover.js` and `generate-emails.js` stream via SSE for tens of seconds. If `WAVE2_BACKEND_*` flags are built (Option A), a flag flip mid-stream could send a request through the new code path while later writes go through the old. Mitigation: each SSE handler reads the flag value **once at request start** and uses that for the full request lifetime. Document in service-layer doc; verify in code review of every flag-aware handler. Under Option B (hard cutover), there is no mid-stream-flip scenario — the deploy boundary is the cutover point.

## Open questions for Connor

1. **Cleanup predicate** — **resolved S136 2026-05-06**: locked as-is (8 signals across slot + suggestion: `wmkf_contact`, `wmkf_emailsentat`, `wmkf_responsetype`, `selected`, `ExternalTokenIssued`, `ProposalFirstAccessed`, `ReviewSharePointFolder`, any review-form picklist). Per memory `project_reviewer_postgres_to_dataverse_migration`. Delivery later changed from cron to one-shot DELETE.
2. **14-day grace period** — **resolved S136 2026-05-06**: locked (matches Wave 1 stability-clock pattern).
3. **`researchers.js` admin UI** — **resolved 2026-05-06**: retire. Database tab goes away. Replaced by "Add candidate by hand" feature (§4 above).
4. **Net-new reviewer-portal columns on `wmkf_appreviewersuggestion`** — **resolved 2026-05-06**: add `wmkf_DeclineReason` (multi-line text) + `wmkf_ResponseReceivedAt` (datetime). Late/on-time flag and response-latency hours derive at query time.
5. **Contact form "Reviewer history" view** — **resolved 2026-05-06**: separate ask of Connor (not bundled with pilot's account-form work; pilot doesn't touch the contact form). Justin opted in rather than deferring post-pilot.
6. **PI/co-PI junction (`wmkf_apprequestperson`)** — **fully resolved 2026-05-07**: junction approach locked S136; both implementation questions answered jointly:
   - Junction-table preference extends to vendor-indexed data — proceed.
   - Sync is net-new PA flows (Connor's build), not an extension. PA flows on `akoya_request` create/update will create `contact` records as needed and write junction rows directly.
   - `_wmkf_projectleader_value` (PI lookup) **stays live** — used by other flows unrelated to reviewers. PA flows dual-write (projectleader field + junction `pi` row). Only the co-PI slots (`_wmkf_copi1..5_value`) become obsolete once backfill + PA flows are live.
   - Backfill script (`scripts/backfill-request-person-junction.js`) is Justin/Claude's job.
7. **`is_archived` on `grant_cycles`** — **resolved 2026-05-06**: column does not exist in Postgres; spec corrected (`is_active` handles active/archive distinction). Original Codex concern was a false alarm.

## Rollback strategy

> **HISTORICAL — W3 cutover method was locked as Option B (hard cutover, no flags) per §"W3 cutover method" at line 181; W3–W6 cutovers all shipped 2026-05-12 via Option B with no rollback needed.** The Option A vs Option B decision below is preserved as the planning-time reasoning. Future migration waves (if any) should re-decide per-table at their own start, not consult this section as live guidance.

### No dual-write — single-source-of-truth flips

To be explicit (Codex flagged this as a missing stance): **this migration does not run a dual-write window**. The rollback-safety question is **whether to gate cutovers on per-table `WAVE2_BACKEND_*` env flags or accept hard cutover**. Both are real options; pick one before doing endpoint rewrites.

**Option A — `WAVE2_BACKEND_*` flags (modeled on Wave 1).** Per-table flag dispatches at the service layer. Cutover = flag flip in Vercel env; rollback = flip back. Adds ~50 lines per service module. Necessary if we want a per-request rollback path during cutover.

**Option B — Hard cutover, no flags.** Just rewrite each endpoint to use Dataverse adapters and ship. Rollback = `git revert` + redeploy. Faster to build; rollback is coarser and slower (revert affects the whole endpoint, takes a deploy cycle).

The original plan implicitly assumed Option A. Build-priority discussion 2026-05-12 raised the question of whether Wave 1's flag pattern is actually necessary for Wave 2, since Wave 2 is drain rather than dual-write. Codex 3d (2026-05-12) pointed out that without flags, every cutover is hard.

**W3 decision locked S147 2026-05-12: Option B with loud-fail guard.** See §"W3 cutover method" under Locked decisions. Rationale: 3-file blast radius doesn't justify dispatcher overhead, and Wave 1 dispatcher footgun (silent default-to-Postgres) is the failure mode A would have re-introduced. Rollback contract: `git revert` + redeploy, ~10 min effective.

**W4+ decision still per-table.** Drain targets have different blast radius; choose A vs B at the start of each weekly window, not as a blanket call.

There is no period where both backends are simultaneously authoritative. This avoids the divergence-detection-via-reconciliation trap, but means **a Dataverse write failure in the post-flip window surfaces as a user-visible error**, not silent dual-write success. Rollback = flag flip (Option A) or `git revert` (Option B), not transactional rewind.

### Data-loss risk worth naming explicitly (Codex 7b, corrected 2026-05-12)

The previous framing of this section conflated two separate read paths. Corrected:

- **PI history** comes from `_wmkf_projectleader_value` on `akoya_request` (lead PI) **UNION** the `wmkf_apprequestperson` junction (PI + co-PIs). Both stay live as steady-state per §"Junction read strategy"; nothing retires post-pilot.
- **Reviewer history** comes from `wmkf_appreviewersuggestion` rows linked to a contact. The projectleader fallback **does not rescue** missing reviewer-suggestion rows — these are distinct data paths.

**The actual data-loss risk:** if any Postgres `reviewer_suggestions` row fails to backfill to Dataverse before the Postgres table is dropped, that row's reviewer-history content (decline reason, response timestamp, ack state, etc.) is **permanently lost**. The projectleader path won't recover it because that path serves PI history, not reviewer history.

**Mitigations the plan requires:**
1. **Triage the 8-row Postgres-only delta** (parity script output) before running `scripts/backfill-reviewer-suggestions-to-dataverse.js` in commit mode. For each anomaly, decide: genuine missed sync (must backfill) vs. legitimate Postgres-only artifact (e.g., proposal not yet in Dataverse; safe to discard).
2. **Run `scripts/reconcile-reviewer-migration.js`** after backfill commits and again immediately before any Postgres table drop. Cutover blocks until parity is 0-row drift on active-cycle data.
3. **Postgres tables stay read-only, not dropped, for 14+ days post-cutover.** If divergence surfaces in that window, the original rows are still available for inspection.

### Per step, mostly reversible until cutover

1. Schema creation: delete table from solution; no prod impact.
2. Match-on-discovery + history: read-only; turn off via feature flag (`REVIEWER_FINDER_HISTORY_BADGES=false`) — no data implications.
3. Cleanup one-shot: dry-run mode logs what it would delete without acting. At real-mode time, pre-delete export to blob with 30-day retention provides manual restore path. **Restore script** (`scripts/restore-reviewer-suggestion-cleanup-backup.js`): reads the JSON blob, re-CREATEs the `wmkf_appreviewersuggestion` rows via `reviewerSuggestionAdapter.upsert`. Re-runnable via the adapter's find-then-update/create (sequential single-instance reruns safe; NOT concurrent-safe; NOT a true Dataverse alternate-key PATCH). (Slots and sidecars are never deleted by the one-shot cleanup — only suggestion rows — so the restore path is suggestion-only too.) Half-day to write; **must exist before first real-mode run.**
4. Endpoint rewrites: see Option A vs B above; rollback path differs depending on which.
5. Cutover: Postgres tables set read-only but not dropped. If cutover regresses, re-enable Postgres path, investigate.
6. Decommission: only after 14 days clean. Final blob backup.

### Partial-write recovery (only applies under Option A — flag flips)

This subsection describes recovery from a flag flip-back, which is only possible if Option A (`WAVE2_BACKEND_*` flags) is chosen. **Under Option B (hard cutover), rollback is `git revert` + redeploy — there are no flag-window divergences to repair.** Skip this section if Option B is chosen.

If a flag flip happens, Dataverse takes a few writes, then we discover a problem and flip back to Postgres — those Dataverse-written rows are now divergent from the next Postgres-write attempts.

**Recovery procedure** (`scripts/repair-divergence-postflip.js`, spec'd):

1. **Note the flip-back timestamp.** All Dataverse rows on the affected entity with `createdon > flipForwardTimestamp AND createdon < flipBackTimestamp` are candidates for reconciliation.
2. **Dump the candidates** as JSON via the relevant adapter (`reviewerSuggestionAdapter.findRecent({ since })`).
3. **Replay into Postgres** via the legacy `DatabaseService` write paths. Idempotent on Postgres side via the existing UNIQUE constraints (`(proposal_id, researcher_id)` on `reviewer_suggestions`, etc.).
4. **Re-flip forward** only after reconciliation script reports zero drift between the dumped Dataverse set and the replayed Postgres set.

**Acceptance**: don't re-flip until repair script's parity report shows zero drift. If repair fails (Postgres write rejects, etc.), the Dataverse rows stay; flag stays Postgres; manual triage required before retry.

### Pre-drop grep gates (per CLAUDE.md carryover hygiene)

Before any destructive step, an explicit `rg` check must show zero live callers:

| Step | Grep targets | Pass condition |
|---|---|---|
| Drop `pages/api/reviewer-finder/researchers.js` | `rg "/api/reviewer-finder/researchers"` across `pages/`, `lib/`, `scripts/`, `tests/` | Zero matches |
| Drop Database tab from `pages/reviewer-finder.js` | `rg "fetch.*reviewer-finder/researchers"` in same scope | Zero matches |
| Drop Postgres `researchers` table | `rg "FROM researchers\b\|INTO researchers\b\|UPDATE researchers\b"` in `lib/`, `pages/`, `scripts/` | Zero matches |
| Drop Postgres `researcher_keywords` table | `rg "researcher_keywords"` in same scope | Zero matches |
| Drop Postgres `publications` table | `rg "FROM publications\b\|INTO publications\b\|UPDATE publications\b"` in same scope | Zero matches (verified 2026-05-06: writer is dead) |
| Drop Postgres `proposal_searches` table | `rg "proposal_searches"` in same scope | Zero matches outside ad-hoc scripts |
| Drop Postgres `reviewer_suggestions` table | `rg "FROM reviewer_suggestions\b\|INTO reviewer_suggestions\b\|UPDATE reviewer_suggestions\b"` in same scope | Zero matches |
| Drop Postgres `grant_cycles` table | `rg "FROM grant_cycles\b\|INTO grant_cycles\b\|UPDATE grant_cycles\b"` in same scope | Zero matches |

Each gate runs **immediately before** the destructive command, not at planning time. Output captured in the migration log. If any gate finds a live caller (added since cutover, missed in the rewrite), **stop and re-investigate** — do not proceed with `--force` or equivalent.

### Rollback triggers (when to flip back)

Each cutover (flag flip under Option A, or deploy under Option B) publishes a watch dashboard. Auto-rollback is not built; **manual rollback within 15 minutes** if any of these breach. Rollback mechanics differ by option: Option A is a Vercel env flip (~1 min effective); Option B is a `git revert` + redeploy (~10 min effective):

| Signal | Threshold | Action |
|---|---|---|
| Dataverse write failure rate (5-min window) | > 2% of attempts | Rollback that table (Option A: flip flag back; Option B: `git revert` + redeploy); investigate. |
| Dataverse query P95 latency (5-min window) | > 3× pre-cutover baseline | Same. |
| Email-generation failure rate | > 5% per hour OR any "no candidates found for known PD" 0-row response | Same. Email is high-stakes; staff notice immediately. |
| Suggestion-count drift (Postgres vs. Dataverse) | > 5 rows for an active cycle | Pause the relevant cutover (Option A: hold the flag at Postgres; Option B: revert the cutover commit before merging the next); reconcile before continuing. |
| User-reported regression (Slack / direct message) | 1 confirmed report | Pause; investigate. We don't have enough users for "wait for the second report." |

Pre-cutover baselines captured during W4 dry-run; documented in the watch dashboard.

## Acceptance tests + reconciliation reports

> **HISTORICAL — describes the gates that were planned and have all been passed.** W3/W4/W5/W6-step-1 acceptance tests + reconciliation reports were executed at cutover (2026-05-12). The body below remains useful as a checklist template if a future migration wave needs similar gates, but is not pending work.

Pre-cutover and post-cutover, run a reconciliation script (`scripts/reconcile-reviewer-migration.js`) that produces a parity report. **Cutover blocks until parity is clean** for active-cycle data.

| Check | Postgres source | Dataverse equivalent | Tolerance |
|---|---|---|---|
| Active-cycle suggestion count by request (W4 reconcile — Codex S147 pre-W4 review BLOCKER) | `SELECT COUNT(*) FROM reviewer_suggestions rs JOIN grant_cycles gc ON gc.id=rs.grant_cycle_id WHERE gc.is_active=true GROUP BY rs.request_number` (NOT `proposal_id` — that's a title-slug, not a request identifier; see §"Identity contract") | `wmkf_appreviewersuggestion` filtered by `wmkf_grantcyclecode` then grouped via the linked `akoya_request.akoya_requestnum` (`reconcile-reviewer-migration.js` joins on this) | 0 rows drift on active-cycle data; non-active drift logged as informational |
| Per-suggestion `email_sent_at` | `reviewer_suggestions.email_sent_at` | `wmkf_appreviewersuggestion.wmkf_emailsentat` | exact match for Group A |
| Per-suggestion `response_type` | `reviewer_suggestions.response_type` | `wmkf_appreviewersuggestion.wmkf_responsetype` (mapped) | exact match for Group A |
| Active grant cycle records | `SELECT * FROM grant_cycles WHERE is_active = true` | `wmkf_appgrantcycle` filtered by `wmkf_isactive` | 0 rows drift |
| Per-cycle attachment URLs | `grant_cycles.review_template_blob_url`, `additional_attachments` | `wmkf_appgrantcycle.wmkf_reviewtemplateurl`, `wmkf_additionalattachments` | URLs reachable (HEAD 200 OK) |
| **Email-config parity (W3 acceptance, Codex S147)** | `grant_cycles.{program_name, review_deadline, custom_fields, review_template_blob_url, additional_attachments, summary_pages}` consumed by `render-emails.js` + `send-emails.js` `loadCycleConfigs()` | `wmkf_appgrantcycle` equivalents | Byte-exact .eml output diff vs. pre-cutover baseline for fixture cycle |
| **Meeting-date → shortcode parity (W3 acceptance, Codex S147)** | `meetingDateToCycleCode(wmkf_meetingdate)` used at `render-emails.js:99-103` and `send-emails.js:148-155` | `wmkf_appgrantcycle.wmkf_shortcode` (alt-key resolved from request's meeting date) | For all active-cycle requests, derived code matches the row's `wmkf_shortcode`; 0 drift |
| **Soft-delete behavior (W3 acceptance, Codex S147)** | `UPDATE grant_cycles SET is_active=false` at `grant-cycles.js:355-368` | PATCH `wmkf_appgrantcycle` setting `wmkf_isactive=false` (NOT row delete) | Row remains queryable post-archive; no orphaned suggestion FK |
| **Unassigned-candidate count (W3 acceptance, Codex S147 Q3)** | `reviewer_suggestions WHERE grant_cycle_id IS NULL AND selected=true` at `grant-cycles.js:99-106` | `wmkf_appreviewersuggestion` filtered on null `wmkf_grantcyclecode` AND `wmkf_selected=true` | Count match per PD |
| **Per-cycle proposal count parity (W3 acceptance, Codex S147 re-review)** | `SELECT COUNT(*) FROM proposal_searches WHERE grant_cycle_id=...` (the `grant-cycles.js:64-69` join) | `akoya_request` filtered on matching `akoya_fiscalyear` for each cycle | Per-cycle count match; 0 drift across all active cycles |
| **Per-cycle candidate count parity (W3 acceptance, Codex S147 re-review)** | `SELECT COUNT(*) FROM reviewer_suggestions WHERE grant_cycle_id=... AND selected=true` (the `grant-cycles.js:88-94` join) | `wmkf_appreviewersuggestion` filtered on `wmkf_grantcyclecode=<shortcode>` AND `wmkf_selected=true` | Per-cycle count match; 0 drift across all active cycles |
| **Duplicate-check collision UX (W3 acceptance, Codex S147 re-review #2 + #3 corrections)** | Postgres POST handler at `grant-cycles.js:167-174` returns **`200` with `{ success: true, cycle: { id, name, shortCode }, message: 'Cycle with this shortCode already exists' }`** (NOT a 409) when shortcode already exists. **The `cycle` field is a compact 3-key mapping**, NOT the raw row. | Dataverse POST must preserve the **same 200-success payload shape AND the same compact `{ id, name, shortCode }` `cycle` mapping**. Implementation: explicit pre-read against `wmkf_appgrantcycle` by `wmkf_shortcode` alt-key BEFORE insert; on hit, project the Dataverse row to `{ id: <wmkf_appgrantcycleid>, name: <wmkf_displayname>, shortCode: <wmkf_shortcode> }` and wrap in the same success-with-message envelope. **Do NOT return the raw Dataverse entity.** | Byte-equivalent JSON envelope for collision case; `cycle` object is exactly 3 keys (`id`, `name`, `shortCode`); client code at `pages/reviewer-finder.js` POST consumer behavior unchanged; no stack-trace leak |
| **`SettingsModal` NaN-guard (W3 acceptance, Codex S147 re-review #3)** | N/A — current `SettingsModal.js:138` assigns stored value to `currentCycleId` with no `NaN` guard | After cutover, `SettingsModal` reads tolerate shortcode-shaped values: stale clients receiving `"J26"` from a freshly-written pref must not crash or show stuck-empty cycle UI; instead, fall through to default-active cycle (existing behavior pattern) | Unit/manual test: seed pref with shortcode-shaped value, load SettingsModal under both old and new bundles, verify both render a defined current cycle (default-active under stale bundle, resolved-shortcode under new bundle) |
| **localStorage→Dataverse pref normalization (W3 acceptance, Codex S147 re-review #3)** | `SettingsModal.js:173-177` migrates legacy `STORAGE_KEYS.CURRENT_CYCLE` localStorage value verbatim into Dataverse `wmkf_appuserpreferences` on first profile selection | After cutover, the migration step must pass the legacy value through the reader policy (resolve integer → shortcode) BEFORE calling `setPreference`. Verify no integer-shaped values land in Dataverse | Manual test: seed localStorage with integer-shaped legacy value, run profile-selection flow, inspect Dataverse `wmkf_appuserpreferences` row → must contain shortcode (e.g., `"J26"`), NOT integer (e.g., `"7"`) |
| **Backfill partial-failure recovery (W3 acceptance, Codex S147 re-review)** | N/A (manual SQL today) | `scripts/backfill-grant-cycles-to-dataverse.js` resumes cleanly on second run after a mid-batch failure; rows that succeeded on run 1 produce "skip" decisions on run 2 (idempotent via `wmkf_shortcode` alt-key); rows that failed on run 1 produce "create" or "update" on run 2 | Two-run test: kill mid-batch, rerun, final state matches single-clean-run state |
| `my-proposals` lifecycle counts (PD-scoped) | `fetchReviewerCounts` Postgres query | Equivalent Dataverse aggregate | 0 rows drift, sorted by request_number |
| Email-generation smoke (5 candidates, 1 known PD) | Postgres-backed run | Dataverse-backed run | identical .eml output (modulo whitespace) |

**Cross-user-isolation tests update**: `tests/cross-user-isolation.test.js` encodes Postgres-era "PDs only see their own suggestions" behavior. The intentional model change to org-visible-with-PD-default-filter requires those tests to be **rewritten, not just updated**. New test shape:

- All-PDs query returns all suggestions (org-visible).
- Default `/api/reviewer-finder/my-candidates` query (no `?requestId` etc.) returns suggestions filtered by `_wmkf_programdirector_value` of the linked request.
- Direct override (`?requestId=<guid>`) returns regardless of PD.
- Negative test: an applicant or external token hitting `/api/reviewer-finder/*` is still rejected.

## Dataverse readiness checklist

> **HISTORICAL — all items below shipped or were verified at W3-W6 cutover 2026-05-12.** Pilot-launch readiness items (post-pilot one-shot cleanup real-mode, etc.) live in the W6/post-pilot rows of the schedule table below; everything else here is closed.

Every item below must have a check + date + owner before the relevant cutover step depends on it. Dates aligned to the refreshed W3–W7 schedule below.

| Item | Owner | Due | Verification |
|---|---|---|---|
| ~~`wmkf_appgrantcycle` entity created~~ | DONE (entity exists in prod, partial schema) | — | EntityDefinitions probe confirmed 10 attrs. |
| **Duplicate-domain audit (W3 preflight, Codex S147)** | Justin | W3 | Script enumerates Postgres `grant_cycles.short_code` (active+inactive) ∪ Dataverse `wmkf_appreviewersuggestion.wmkf_grantcyclecode`; any duplicates triaged (collapse plan documented) before alt-key add. |
| **Preference-shape migration (W3 preflight, Codex S147 Q4)** | Justin | W3 | `reviewer_finder_current_cycle_id` consumers (`reviewerFinderPreferences.js`, `SettingsModal.js`, `pages/reviewer-finder.js:748-756`) accept and resolve `wmkf_shortcode` (string) rather than Postgres integer; shipped as standalone commit before any backend swap. |
| `wmkf_appgrantcycle` schema patch (3 missing attrs + `wmkf_shortcode` alt-key entry) | Justin | W3 | `apply-dataverse-schema.js` succeeds; EntityDefinitions shows all 13 attrs AND both alt-keys (`wmkf_fiscalyearcode`, `wmkf_shortcode`). |
| Alt key `wmkf_shortcode` on `wmkf_appgrantcycle` confirmed unique-enforced | Justin | W3 | Manual duplicate-create attempt returns Dataverse alt-key violation. |
| **Idempotent backfill script (W3, Codex S147 Q5)** | Justin | W3 | `scripts/backfill-grant-cycles-to-dataverse.js` runs dry-run first; output shows per-row create/update/skip decision keyed on `wmkf_shortcode`; non-null Dataverse fields preserved unless `--overwrite` passed. |
| **Loud-fail guard on `WAVE2_BACKEND_GRANT_CYCLES=postgres`** | Justin | W3 | After cutover, setting the env var to `postgres` causes the rewritten endpoints to throw at module load or first request, mirroring `lib/services/database-service.js:27-31` posture. |
| ~~`wmkf_appreviewersuggestion` extensions deployed (`wmkf_DeclineReason`, `wmkf_ResponseReceivedAt`)~~ | DONE 2026-05-09 (S143) | — | Live in prod; adapter `select` includes them. |
| ~~`wmkf_apprequestperson` junction created~~ | DONE 2026-05-07 (commit `c8cbfe1`) | — | Schema present in prod; alt key `(wmkf_request, wmkf_contact, wmkf_role)` enforced live. |
| OData filter performance: `wmkf_appreviewersuggestion` filtered by `wmkf_grantcyclecode` | Justin | W4 | Prod query of 100 rows returns < 500ms P95. |
| OData filter performance: `wmkf_potentialreviewer` filtered by `wmkf_contact` | Justin | W4 | Same. |
| OData filter performance: `wmkf_apprequestperson` filtered by `wmkf_contact` | Justin | W4 | Benchmark against the contact-history endpoint's real query shape. |
| ~~`$batch` reviewer-suggestion writes succeed at 50-row batches~~ | DEFERRED (W4 closeout 2026-05-12) | — | Closed-with-rationale: production write path is sequential, not batched. Junction backfill executed 5,561 rows sequentially (commit `8b9b287`); grant-cycles backfill writes 10 rows sequentially (commit `c53f012`). `$batch` shape is unused in current production code; the smoke would test an unused code path. Re-open if a future write path adopts `$batch`. |
| Junction backfill executed in commit mode | Justin | W4 | ~3,000 rows in `wmkf_apprequestperson`; `contact-history` returns junction-sourced results in addition to projectleader. (Schedule-aligned with W4 "data alignment" theme.) |
| Reviewer-suggestions 8-row anomaly triage documented | Justin | W4 | Per-row decision captured in commit message of the backfill commit-mode run. |
| Smoke test: contact history endpoint against junction-backfilled data | Justin | W4 | `scripts/smoke-contact-history.js` (single-contact GET) returns junction-sourced results in addition to projectleader. **Codex S147 pre-W4 review Q1**: the prior "25-contact batch < 1s P95" framing was a plan/impl mismatch — the endpoint is single-contact today, batched shape is post-pilot enhancement. W4 gate is single-contact functional smoke; perf budget tracked separately in the dated perf log. |
| Smoke test: `generate-emails` against migrated suggestion data | Justin | W5 | End-to-end email-generation flow against Dataverse data after `generate-emails.js` cutover. |
| Contact form "Reviewer history" subgrid added | Connor | Post-pilot (no pilot dependency) | Sandbox contact form renders the subgrid. In the Post-pilot row of the schedule. |

**Failure of any item postpones cutover.** No partial passes; if a smoke test reveals a regression, fix before flipping flags.

## Revised pilot timing

**Refreshed 2026-05-12.** Today: 2026-05-12. Pilot: mid-June 2026 (~5 weeks). The original W1–W6 schedule was written 2026-05-06; updated below to reflect what shipped since (S139 build set, Wave 1 closeout, junction backfill script built, contact-history endpoint built).

### State as of 2026-05-12 (was W1+W2 in original schedule)

**Shipped:**
- Junction entity (`wmkf_apprequestperson`) deployed to prod
- `/api/reviewer-finder/contact-history` endpoint (steady-state UNION of junction + projectleader for PI history)
- `scripts/backfill-request-person-junction.js` (built AND executed in commit mode 2026-05-07; 5,561 rows live)
- All four Wave 2 adapters live
- `save-candidates`, `my-candidates`, `load-proposal` fully on Dataverse
- Decline-reason fields + response-received-at on `wmkf_appreviewersuggestion`

**Still pending from W1:**
- ~~`wmkf_appgrantcycle` schema **patch**~~ **SHIPPED 2026-05-12 (W3 preflight)** — 11 attrs live, both alt-keys present.
- Anomaly-triage decisions on the 8 parity outliers

### Updated forward schedule

> **HISTORICAL — W3–W6 (step 1) all SHIPPED 2026-05-12 ahead of original cadence.** W3 grant-cycles + W4 reviewer-suggestion alignment + W5 reader cutover + W6 step 1 (researchers.js retirement) landed together. The "NOT slip-eligible" gate list below was the planning gate list; most of those gates passed at cutover. One gate item is still pending: `scripts/restore-postgres-drain-table-backup.js` must be written before the post-pilot one-shot table drop runs (the drop itself is tracked in the Post-pilot row of the schedule table, not as a slip-eligible-gate). Pilot launch (W7) also remains forward work — mid-June 2026 Phase II Research cycle.

Slip-eligible items (history badges UI, add-candidate-manual, match-on-discovery wiring, contact form subgrid) are explicitly moved to a "Post-pilot enhancements" block below the table so they don't crowd critical-path weeks. The one-shot cleanup/table-drop path is post-pilot regardless. Each week below carries one major theme plus its safety prerequisites.

| Window | Theme | Concrete deliverables |
|---|---|---|
| W3 (2026-05-12 → 2026-05-19) | **Grant cycle migration.** Theme: get `grant_cycles` off Postgres so Review Manager email path is unblocked. | **Step 1 — Preflight (Codex S147 BLOCKERs):** duplicate-domain audit (Postgres `grant_cycles.short_code` ∪ Dataverse `wmkf_appreviewersuggestion.wmkf_grantcyclecode`), then preference-shape migration (integer ID → `wmkf_shortcode`) shipped as its own commit. **Step 2 — Schema patch:** add 3 missing fields + `wmkf_shortcode` alt-key entry to JSON, apply, verify both alt-keys present. **Step 3 — Backfill:** idempotent script keyed on `wmkf_shortcode`, dry-run first, `--overwrite` flag for non-null Dataverse values. **Step 4 — Endpoint rewrites (Option B locked):** `pages/api/reviewer-finder/grant-cycles.js` full scope (per-cycle counts + unassigned counts + duplicate-check + soft-delete-as-PATCH), `render-emails.js` + `send-emails.js` `loadCycleConfigs()` paths. **Step 5 — Loud-fail guard:** rewritten endpoints throw on `WAVE2_BACKEND_GRANT_CYCLES=postgres`. **Step 6 — Acceptance:** all W3-row acceptance gates pass before declaring W3 done. See §"Acceptance tests + reconciliation reports" for the canonical list — at minimum: email-config parity (byte-exact .eml diff), meeting-date→shortcode parity, soft-delete behavior (PATCH not DELETE), unassigned-candidate-count parity, **per-cycle proposal-count parity**, **per-cycle candidate-count parity**, **duplicate-check collision UX (200-success envelope preserved)**, **backfill partial-failure recovery (two-run idempotency test)**, **`SettingsModal` NaN-guard + localStorage→Dataverse normalization verified**. |
| W4 (2026-05-19 → 2026-05-26) | **Reviewer-suggestion data alignment.** Theme: Dataverse holds the complete suggestion ledger before any reader cutover. | **Day 1 (parallel):** (a) re-run `backfill-reviewer-suggestions-parity.js` — S136 numbers stale, real anomaly queue is 10+ not 8; document per-row recover-vs-accept-loss decisions; (b) scope `reconcile-reviewer-migration.js` contract on paper — identity mapping is `PG.request_number → akoya_request.akoya_requestnum → DV._wmkf_request_value`, NOT `proposal_id` (that's title-slug, see §"Identity contract"). **Day 2:** build `scripts/reconcile-reviewer-migration.js` + `scripts/backfill-reviewer-suggestions-to-dataverse.js` (idempotent dry-run-first pattern from W3 grant-cycles backfill). **Day 3:** suggestion backfill commit-mode (small, ~10 rows); re-run reconcile, confirm 0 active-cycle drift. **Day 4:** junction backfill — dry-run, then `--limit 50` execute, then full ~3000-row commit; sequential writes (NOT `$batch`, see §"Junction read strategy"). **Day 5:** closing gates — contact-history smoke against junction set (note: endpoint is single-contact GET today, not 25-batch; smoke validates single-contact path post-junction-backfill, batch shape is post-pilot enhancement); **OData filter perf benchmarks** on `wmkf_appreviewersuggestion`+`wmkf_grantcyclecode`, `wmkf_potentialreviewer`+`wmkf_contact`, `wmkf_apprequestperson`+`wmkf_contact` (warn-but-don't-fail in acceptance script + append dated entry to `docs/perf-log.md`, which the script creates on first run); **~~`$batch` 50-row write smoke~~** DEFERRED at W4 closeout — see readiness-checklist entry for rationale (prod writes are sequential, $batch path unused); `scripts/acceptance-w4.js` sweep. **Descope contingency** (Codex S147 pre-W4 review Q4): slip the junction full-commit to early W5 if **any** of these is true at EOD Day 3: (a) `reconcile-reviewer-migration.js` is not yet implemented and exit-0 against active-cycle data, (b) the suggestion backfill commit-mode run hasn't completed cleanly, (c) any anomaly from the Day-1 parity rerun lacks a documented recover-vs-accept-loss disposition. Junction gates only contact-history / history-badge readiness (post-pilot scope), not the 5 W5 reader rewrites. Hold this as a contingency lever, not a default. |
| W5 (originally 2026-05-26 → 2026-06-02; **SHIPPED 2026-05-12**) | **Reviewer-suggestion reader cutover + service-layer cleanup.** Theme: every Postgres `reviewer_suggestions` read goes to Dataverse. | **SHIPPED 2026-05-12 (full wave landed early).** `pages/api/reviewer-finder/generate-emails.js` rewritten to use `lib/dataverse/adapters/reviewer-suggestion`; `my-proposals.js` rewritten to use the suggestion adapter via Dynamics; `extract-summary.js` retired entirely (caller in `pages/reviewer-finder.js` updated); `lib/services/maintenance-service.js` blob orphan scanner rewritten to read Dataverse; `lib/services/database-service.js` researcher + publication + suggestion methods gutted. `pages/api/reviewer-finder/researchers.js` Postgres reads were intentionally left as out-of-W5-scope and addressed under W6 step 1 below. |
| W6 (2026-06-02 → 2026-06-09) | **`researchers.js` retirement.** Theme: heaviest Postgres consumer goes away. | **Step 1 (SHIPPED 2026-05-12, commit `27931b9`):** retired `pages/api/reviewer-finder/researchers.js` — API removal + Database-tab UI removal + test/doc cleanup; grep gates pass (zero matches in `pages/`, `lib/`, `scripts/`, `shared/`, `tests/`). Drain-only tables now: `researchers`, `researcher_keywords`, `publications`, `proposal_searches`. **Step 2 (post-pilot one-shot cleanup + restore script) — DEFERRED 2026-05-12.** Codex's read: Wave 1 dropped its drain-only tables on 2026-05-12 with a one-shot DELETE, no cron, no restore script — same blast radius, worked cleanly. Building a cron that sits in dry-run during an active pilot is maintained surface for noise nobody reads. Cleanup deferred to the post-pilot checklist (§ below) where the deletion path can be a thin 30-line script written with the actual row format in front of you. |
| W7 (2026-06-09 → 2026-06-16) | **Pilot launch.** Theme: ship. | Pilot launch (mid-June Phase II Research cycle). Dataverse readiness checklist 100% complete before launch. (No cleanup delete in the pilot — see W6 note above.) |
| Post-pilot (2026-06-16 onward) | **Enhancements + decommission.** Theme: visible polish + safe drops. | History badges UI in Reviewer Finder. `add-candidate-manual.js` endpoint + UI. Match-on-discovery service (`lib/services/contact-history-service.js`) + `discovery-service.js` wiring. Contact form "Reviewer history" subgrid (Connor). **W6-step-2-deferred work — drain-only table drop. Fire ≥ 2026-07-01** (≥14 days post-pilot-launch). Checklist: (1) staleness probe (`SELECT MAX(last_updated) FROM researchers UNION ALL ...` over the 4 drain-only tables — every row ≥ 14 days old, else stop and investigate); (2) one-shot `DELETE ... RETURNING *` per table piped to JSONL, uploaded to Vercel Blob under `cleanup-backup/YYYY-MM-DD/<table>.jsonl`; (3) write `scripts/restore-postgres-drain-table-backup.js` (≈30 lines, reads JSONL → INSERT; **distinct** from the Dataverse-suggestion restore — see the "Spec'd vs. built" row; NOT built) *before* step 2 runs; (4) `DROP TABLE` in dependency order (`researcher_keywords` before `researchers`); (5) update `docs/atlas/postgres-researchers.md` + `docs/atlas/postgres-other-reviewer-tables.md` + this plan's "Spec'd vs. built" table; (6) re-run `npm run check:atlas` + `:api-routes`. Memory entry `[[w6-table-drop-pending]]` mirrors this so a future session fires it as a P0 start-of-session item. |

**Slip-eligible** (already moved to "Post-pilot enhancements" row above — these will not gate the mid-June pilot):
- History badges + match-on-discovery wiring (additive UX)
- `add-candidate-manual` endpoint + UI (PDs save via discovery flow only during pilot)
- Contact form "Reviewer history" subgrid (Connor's separate build)
- Post-pilot one-shot Postgres table drop (NOT a cron — see §"Post-pilot one-shot cleanup" at line 191 + Post-pilot row of the schedule above; deferred to post-pilot regardless of W7 timing)

**What's NOT slip-eligible** (gate cutover; must complete by W6):
- 8 parity-anomaly triage decisions documented (recover or accept loss, per row)
- `wmkf_appgrantcycle` schema patch + data backfill
- `grant_cycles` 3-file cutover (`grant-cycles.js`, `render-emails.js`, `send-emails.js`)
- `reviewer_suggestions` reader cutover (`generate-emails.js`, `my-proposals.js`)
- `extract-summary.js` retirement
- `researchers.js` retirement + grep-gated table drop preparation
- `maintenance-service.js` blob-scanner rewrite
- `database-service.js` researcher/publication/suggestion methods gutted-or-rewritten
- `WAVE2_BACKEND_*` Option A vs B decision (made by end of W3)
- Restore script written + tested before any one-shot cleanup real-mode run
- Dataverse readiness checklist 100% complete before pilot launch

## Related

- `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` — Wave 1 (shipped) + the original Wave 2 spec this doc supersedes
- `docs/INTAKE_PORTAL_DESIGN.md` — pilot design; the workstream this gates
- `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` — pilot Dataverse schema audit (sibling)
- `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` — 2026-05-06 walkthrough
- `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md` — reviewer portal field shape
- `lib/dataverse/adapters/{contact, potential-reviewer, researcher, reviewer-suggestion}.js` — live adapter code
- `lib/utils/cycle-code.js` — `meetingDateToCycleCode(d)` for badge rendering
- `scripts/probe-rr-program-tagging.js` — confirms `akoya_program=RR` is unused, no existing convention to follow
- `scripts/db-row-counts.js` — current Postgres row counts
- `.claude-memory/project_reviewer_postgres_to_dataverse_migration.md` — strategic context
