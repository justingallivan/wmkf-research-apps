---
name: Reviewer Postgres → Dataverse migration plan locked (S136)
description: Migration scope, model decisions, and feature scope locked 2026-05-06. Most "migration" is drain, not move. Match-on-discovery + history badges are first-class scope.
type: project
originSessionId: 064dffdf-ba31-44c3-81f2-73bf4d3b908f
---
**Status as of 2026-05-06 (S136)**: Plan rewritten against ground truth. Authoritative doc: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`. Pilot deadline mid-June 2026 stands.

## Ground truth (what's already done)

Significant migration was already shipped before S136. Live in Dataverse:
- `wmkf_potentialreviewer` (per-proposal slot)
- `wmkf_appresearcher` (1:1 sidecar with the slot)
- `wmkf_appreviewersuggestion`
- Adapters in `lib/dataverse/adapters/`
- Endpoints fully migrated: `save-candidates`, `my-candidates`, `load-proposal`, all of Review Manager

## Locked decisions (don't re-litigate)

1. **1:1 model is correct, not a compromise.** Researchers are cycle-bounded transient candidate scratch (~25/proposal). Permanent reviewer identity lives in `contact` via promotion. No researcher pool table — Wave 1 doc's pool design is superseded.
2. **No new role-tracking child entity.** Engaged `wmkf_appreviewersuggestion` rows linked via `wmkf_potentialreviewer.wmkf_contact` ARE the per-contact reviewer history. The one-shot cleanup DELETE (cron deferred — see item 3) is what turns the table from "scratch" into "history."
3. **Cleanup cron deferred per Codex recommendation 2026-05-12.** Originally specified as a weekly cron acting twice a year on stale slot rows. Replaced with one-shot DELETE matching Wave 1 precedent — see `project_w6_table_drop_pending.md`. No cron exists or is planned; `lib/services/maintenance-service.js` contains no reviewer cleanup. Cascade-drop logic moves into the one-shot script when fired.
4. **Postgres tables drain, mostly don't migrate.** Real numbers (verified 2026-05-06 via `scripts/db-row-counts.js`): publications=0 (dead writer), proposal_searches=0, researchers=331, researcher_keywords=1028, reviewer_suggestions=337, grant_cycles=13. All <12 months old. Only `grant_cycles` migrates (→ `wmkf_appgrantcycle`, 10 rows live as of 2026-05-14 audit); rest drain via one-shot DELETE post-pilot (cleanup cron deferred per item 3) + cycle close.
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
| Cleanup predicate (S136-locked; cron later deferred — see item 3, now a one-shot DELETE) | 8 signals across slot + suggestion: contact, emailsentat, responsetype, selected, ExternalTokenIssued, ProposalFirstAccessed, ReviewSharePointFolder, any review-form picklist. The predicate logic is still authoritative; only the delivery mechanism changed (cron → one-shot DELETE in `project_w6_table_drop_pending.md`). |
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
- Don't propose dropping Postgres reviewer tables ad hoc. The drain is intentional and gated on the post-pilot one-shot DELETE path documented in `project_w6_table_drop_pending.md` (trigger ≥ 2026-07-01), not a cron.
- **Re-run `scripts/audit-postgres-state.js` before any migration work begins** to confirm state hasn't drifted from S136 ground truth.

## RR program code (probed S136)

`akoya_program = "Research Reviewer"`, `wmkf_code = "RR"`, GUID `7e744a42-37eb-f011-8543-6045bd02b4cc`. **Exists but unused.** No contact has it (no `_akoya_program_value` field on contact at all). Zero requests use it. No N:N table. **No existing convention to follow** for tagging contacts as reviewers — engagement-history approach is the answer, not a flag.
