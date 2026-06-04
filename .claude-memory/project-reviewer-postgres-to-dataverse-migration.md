---
name: Reviewer Postgres → Dataverse migration plan locked (S136)
description: Migration scope, model decisions, and feature scope locked 2026-05-06. Most "migration" is drain, not move. Match-on-discovery + history badges are first-class scope.
type: project
originSessionId: 064dffdf-ba31-44c3-81f2-73bf4d3b908f
status: active
scope: reviewer
last_verified: 2026-05-14 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: working on the reviewer Postgres→Dataverse migration, the 1:1 model, or match-on-discovery / history badges.

Do:
- Treat the migration as SHIPPED (W3–W6, 2026-05-12); most Postgres tables drain, only `grant_cycles` migrated.
- Read `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (not the stale Wave 1 doc); re-run `scripts/audit-postgres-state.js` before any further migration work.
- Use engagement-history (`wmkf_appreviewersuggestion` linked via `wmkf_potentialreviewer.wmkf_contact`) as per-contact reviewer history.

Do not:
- Re-litigate locked decisions (1:1 model, no new role child entity, `wmkf_app<name>` naming, no denormalized reviewer flag).
- Drop Postgres reviewer tables ad hoc. (The 5-table reviewer-finder drain set — researchers, researcher_keywords, publications, proposal_searches, reviewer_suggestions — was DROPPED 2026-06-04 via migration 018; see [[project-w6-table-drop-pending]]. `search_cache` stays — it has live callers. This rule now protects only `grant_cycles` and any future drain tables.)

Ground truth: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`, `scripts/audit-postgres-state.js`, `lib/dataverse/adapters/`, [[project-appresearcher-collapse-post-pilot]], [[project-w6-table-drop-pending]], [[project-system-model]].

**Status as of 2026-05-06 (S136)**: Plan rewritten against ground truth. Authoritative doc: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`. (The reviewer migration shipped W3–W6 2026-05-12; the "mid-June 2026 pilot deadline" rationale is superseded — that intake pilot was cancelled, see [[project-system-model]].)

## Ground truth (what's already done)

Significant migration was already shipped before S136. Live in Dataverse:
- `wmkf_potentialreviewer` (global per-person record, 1 row per real human, dedup'd on email — NOT a per-proposal slot; corrected S196 from earlier wording)
- `wmkf_appresearcher` (1:1 bibliometric sidecar — **this is the S136 pre-collapse snapshot; the sidecar was COLLAPSED onto the person + DROPPED S213, 2026-06-03**, see [[project-appresearcher-collapse-post-pilot]])
- `wmkf_appreviewersuggestion` (per-(person, request) engagement junction — the lifecycle ledger)
- Adapters in `lib/dataverse/adapters/`
- Endpoints fully migrated: `save-candidates`, `my-candidates`, `load-proposal`, all of Review Manager

## Locked decisions (don't re-litigate)

1. **1:1 model was correct as a transitional state, slated for collapse.** Researchers are cycle-bounded transient candidate scratch (~25/proposal). Permanent reviewer identity lives in `contact` via promotion. No researcher pool table — Wave 1 doc's pool design is superseded. **S196 update:** the 1:1 `wmkf_appresearcher` ↔ `wmkf_potentialreviewer` sidecar pattern itself is structural redundancy; collapse into a single `wmkf_potentialreviewer` was EXECUTED S213 (2026-06-03) — the sidecar is dropped. See [[project-appresearcher-collapse-post-pilot]] and `docs/APPRESEARCHER_COLLAPSE_PLAN.md`. The "1:1 not a compromise" framing was right at the time; the live state is now one entity, not two.
2. **No new role-tracking child entity.** Engaged `wmkf_appreviewersuggestion` rows linked via `wmkf_potentialreviewer.wmkf_contact` ARE the per-contact reviewer history. The one-shot cleanup DELETE (cron deferred — see item 3) is what turns the table from "scratch" into "history."
3. **Cleanup cron deferred per Codex recommendation 2026-05-12; tables DROPPED 2026-06-04.** Originally specified as a weekly cron acting twice a year on stale slot rows. The cron was dropped in favor of the Wave 1 precedent, which was itself a tracked migration (007) — and the reviewer tables were ultimately dropped the same way: **tracked migration `018` (2026-06-04)**, NOT a raw one-shot DELETE script. No cron exists; `lib/services/maintenance-service.js` contains no reviewer cleanup.
4. **Postgres tables drain, mostly don't migrate.** Real numbers (verified 2026-05-06 via `scripts/db-row-counts.js`): publications=0 (dead writer), proposal_searches=0, researchers=331, researcher_keywords=1028, reviewer_suggestions=337, grant_cycles=13. All <12 months old. Only `grant_cycles` migrates (→ `wmkf_appgrantcycle`, 10 rows live as of 2026-05-14 audit); the rest were drained then **DROPPED 2026-06-04 via tracked migration 018** (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`, `reviewer_suggestions`) — NOT the "one-shot DELETE script" mechanism items 3–4 originally specified; that approach was superseded by a guarded migration matching the Wave 1 precedent (007). `grant_cycles` continues to drain.
5. **Naming follows live convention** `wmkf_app<name>` (no underscore), NOT the Wave 1 doc's proposed `wmkf_app_<name>`.

## First-class new scope: match-on-discovery + history badges

The visible payoff of finishing the migration. Not optional UX polish — it's the user-facing reason to do this.

- **Match-on-discovery** (not just match-on-promote): during Reviewer Finder discovery, after enrichment, look up each candidate against `contact.emailaddress1` then `contact.wmkf_orcid`. Skip name+affiliation fuzzy at discovery time.
- **History lookup** for matched candidates: reviewer history (`wmkf_appreviewersuggestion` linked through `wmkf_potentialreviewer.wmkf_contact eq <id>` AND engagement) + PI/co-PI history (`akoya_request._wmkf_projectleader_value` OR `_wmkf_copi1_value..5`).
- **Badges on each candidate card**: 🔁 reviewed (recency-colored), 🚫 declined (separate signal), 💰 funded PI. Click → modal with full history.
- **Lookup**: endpoint `/api/reviewer-finder/contact-history` shipped as **GET single-contact** (not POST batched as originally planned — see `pages/api/reviewer-finder/contact-history.js:4`). POST-batched shape was deferred to post-pilot per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:557`. UI currently calls once per candidate; batch-`$batch` enhancement is post-pilot work.
- Justin's framing (S136): *"We don't want to wear out our welcome."* PD sees recency at a glance, decides whether to invite.

## Codex stress-test addressed (S136 evening)

Codex review found three top concerns + many smaller gaps. Plan rewritten end-to-end:
- Reviewer-suggestions backfill: three-group classification (Group A already-in-DV / Group B active-Postgres-only / Group C closed-discard); parity report; idempotent UPSERT; `--commit` gated.
- Grant-cycle field mapping: full Postgres-to-Dataverse mapping (probed live schema 2026-05-06; corrected `meeting_date`/`fiscal_year` not in Postgres, `is_archived` doesn't exist, `review_deadline` not `review_return_deadline`).
- Schema ownership corrected: reviewer-portal data is on `wmkf_appreviewersuggestion` per `wmkf_appreviewersuggestion-extensions.json`, NOT `wmkf_potentialreviewer`. Plan and engaged-predicate updated.
- Other gaps closed: SSE in-flight handling, rollback triggers (quantitative thresholds), maintenance-service blob-scanner cutover dependency, picklist value mapping, per-user scoping intentional model change documented, cross-user-isolation test rewrite plan.

## Open Connor questions resolved S136 (locked)

| Q | Resolution |
|---|---|
| Cleanup predicate (S136-locked; cron later deferred — see item 3; tables ultimately DROPPED wholesale via migration 018) | 8 signals across slot + suggestion: contact, emailsentat, responsetype, selected, ExternalTokenIssued, ProposalFirstAccessed, ReviewSharePointFolder, any review-form picklist. The predicate was moot in the end — the whole drained tables were dropped 2026-06-04 via tracked migration 018, not row-filtered (the rows had already drained to Dataverse). |
| Grace period | **14 days** (matches Wave 1 stability-clock pattern) |
| `researchers.js` | **Retire**. Database tab loses meaning under 1:1 model. Replaced by net-new "Add candidate by hand" feature in My Candidates tab |
| New suggestion fields | Add `wmkf_DeclineReason` (text) + `wmkf_ResponseReceivedAt` (datetime). Late/on-time + response-latency derive |
| Contact form "Reviewer history" view | **Add to pilot** (separate Connor ask; pilot's account-form work doesn't touch contact form) |
| PI/co-PI lookup | **`wmkf_apprequestperson` junction** (PI \| copi roles). One-time backfill ~3K rows; PA flow for ongoing sync; OR-clause fallback during pilot |
| `is_archived` on grant_cycles | Doesn't exist in Postgres (probed live); spec corrected |

## Two narrow questions left for Connor (Justin asking 2026-05-07)

Both nested under junction implementation:
1. Existing PA flow on `akoya_request` create/update we can extend, or net-new?
2. Junction-table preference — extends to indexes against vendor data, or only net-new app tables?

## Out-of-scope but flagged

- UI cleanup pass on Reviewer Finder + Review Manager (stale `.eml` references, etc.) — its own session, not migration scope.

## Live Postgres state probed S136 (`scripts/audit-postgres-state.js`) — HISTORICAL SNAPSHOT

**Note (2026-05-14):** the row counts and population stats below are S136 snapshot, pre-W3/W4/W5/W6 cutovers. Subsequent migrations (grant-cycle cutover W3, reviewer-suggestion reader cutover W4, `extract-summary` retirement W5, `researchers.js` retirement W6) changed live state significantly. Atlas `docs/atlas/postgres-grant-cycles.md` previously said Dataverse counterpart had 0 rows; current probe shows **10 rows in `wmkf_appgrantcycles`** with live reads via the W3 cutover path. Re-run `scripts/audit-postgres-state.js` before any further migration work.

Plan was updated against live data, not assumptions. Key findings:

- **`reviewer_suggestions` has 37 columns**, not the ~15 I originally listed. Crucially, `request_number` is 99% populated — directly joins to `akoya_request.akoya_requestnum`, so active/closed determination doesn't need to parse `proposal_id` (whose first chars are the proposal *title*, not a cycle code).
- **`researchers` bibliometric data is 0% populated** for h_index, i10_index, total_citations. Infrastructure exists, was never wired up. Match-on-discovery history badges should not promise rich bibliometrics — we don't capture them. Engagement history (invited, accepted, reviewed) IS captured and IS the right basis.
- **`grant_cycles` is sparser than schema suggests**: only 5 of 13 columns populated. JSON columns (`additional_attachments`, `custom_fields`), `review_deadline`, `review_template_blob_url`, `review_template_filename` all 0%. Migration spec simplified accordingly.
- **`maintenance-service.js` blob-scanner concern partially evaporates** — only `reviewer_suggestions.summary_blob_url` (55%) is a real source today. Still rewrite for cutover, lower urgency.
- **Cleanup is forward-looking only** — every existing `reviewer_suggestions` row has `selected=true`. The "transient unselected scratch" pattern doesn't appear in live data; the cleanup predicate's value is future code paths (and it now runs as the deferred one-shot DELETE per item 3, not a cron).
- All data 2026-01-03 → 2026-04-30; matches "<12 months old" claim.

## How to apply

- Treat the Wave 1 doc's "Wave 2 — preview spec" as historical. Live model differs structurally (1:1 vs. pool) and naming-wise (no underscore). Read `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` instead.
- When working on Reviewer Finder code: confirm live state matches what the plan doc says. If something on the Postgres-only list got migrated independently, update both this memory and the plan.
- Don't propose adding a `wmkf_iscontactreviewer` boolean or similar denormalized role flag. Decision is engaged-slot-history; flags lose data the history preserves.
- The 5-table reviewer-finder drain set was DROPPED 2026-06-04 via migration `018_drop_reviewer_finder_postgres_tables.sql` (done early, ahead of the ≥2026-07-01 trigger, at Justin's direction) — see `project-w6-table-drop-pending.md`. Don't propose re-creating them or dropping `search_cache` (live cache) or `grant_cycles` (still draining) ad hoc.
- **Re-run `scripts/audit-postgres-state.js` before any migration work begins** to confirm state hasn't drifted from S136 ground truth.

## RR program code (probed S136)

`akoya_program = "Research Reviewer"`, `wmkf_code = "RR"`, GUID `7e744a42-37eb-f011-8543-6045bd02b4cc`. **Exists but unused.** No contact has it (no `_akoya_program_value` field on contact at all). Zero requests use it. No N:N table. **No existing convention to follow** for tagging contacts as reviewers — engagement-history approach is the answer, not a flag.
