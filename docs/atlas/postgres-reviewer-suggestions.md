# Atlas: `reviewer_suggestions` (Postgres — DROPPED 2026-06-04)

<!-- drain-table:file-purpose=atlas-state-page -->

> **DROPPED 2026-06-04 (S219)** via
> `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`. The table
> no longer exists in Postgres. Per-(person,request) reviewer engagement state
> lives in Dataverse `wmkf_appreviewersuggestion` (source of truth). The
> 337-row pre-drop snapshot was archived to local JSONL and Vercel Blob at
> `cleanup-backup/2026-06-04/reviewer_suggestions.jsonl`. That backup and the
> then-current restore tooling are historical recovery evidence, not current
> operating guidance.

**Last verified:** schema/row-count 2026-05-07 via `scripts/audit-postgres-state.js` + `scripts/backfill-reviewer-suggestions-parity.js`; **read/write path lists re-derived 2026-05-18 (S164)** via full codebase grep + per-site SQL-verb classification (see "Read / write paths" below)
**Final row count before drop:** 337

## Source of truth

**Historical.** Postgres held the legacy historical record before the 2026-06-04 drop. Dataverse `wmkf_appreviewersuggestion` now holds the active per-proposal lifecycle (710 rows as of the 2026-07-21 memory-drift probe). The old parity probe showed ~99% of Postgres rows were stale duplicates of Dataverse rows.

## Historical schema at drop (37 columns)

Identity: `id`, `proposal_id` (varchar(100) — title-prefix, NOT a cycle code), `proposal_title`, `researcher_id` (FK), `request_number` (varchar — natural join key to `akoya_request.akoya_requestnum`).

Scoring/match: `relevance_score`, `match_reason`, `sources` (text[]), `proposal_abstract`, `proposal_authors`, `proposal_institution`, `co_investigators`, `co_investigator_count`.

Lifecycle bools: `selected` (337/100%), `invited` (337/100%), `accepted` (29/9%), `declined` (337/100%).

Outreach timestamps: `email_sent_at` (43/13%), `email_opened_at` (0%), `response_received_at` (22/7%), `response_type` (22/7%; `accepted | declined | no_response`), `materials_sent_at` (19/6%), `reminder_sent_at` (1/0%), `reminder_count` (337/100%), `review_received_at` (1/0%), `review_blob_url` (1/0%), `review_filename` (1/0%), `thankyou_sent_at` (1/0%), `review_status` (20/6%).

External-reviewer intake: `proposal_url` (16/5%), `proposal_password` (16/5%).

Blob attachments: `summary_blob_url` (184/337 = 55% populated) — historical
Vercel Blob URL of extracted summary pages. It was written by the retired
`extract-summary` route and was load-bearing for the deprecated
`generate-emails` flow. It has no current persistence contract.

User scoping: `user_profile_id` (337/100%), `program_area` (337/100%), `grant_cycle_id` (337/100%, FK grant_cycles.id).

UNIQUE constraint: `(proposal_id, researcher_id)`.

## Final pre-drop snapshot

- **`request_number` was populated on 333 / 337 rows (99%)** — added
  retroactively for the Dataverse cutover.
- Four rows missing `request_number` were pre-J26 (from before the
  `akoya_requestnum` field was tracked).
- Cycle distribution (top 5): J26 program area title prefixes `qua/con/vis/res/fro/evo/mol/dea/cir/in-/ele/dec/die/mea/unc/gut/lin/fie/lig/all/non` — so `proposal_id` prefix is the proposal title's first 3 chars, not a structured code.
- **97.6% of rows are stale duplicates** of existing `wmkf_appreviewersuggestion` rows per parity probe. [VERIFIED 2026-05-06 via `scripts/backfill-reviewer-suggestions-parity.js`]
- **All 337 rows had `selected=true`** [VERIFIED 2026-05-07 via
  `scripts/audit-postgres-state.js`] — the "transient unselected scratch"
  pattern did not appear in the final snapshot.
- **Pre-J26 historical data-quality caveat:** the tool was first used in J26
  and adoption was uneven; pre-J26 proposals had no rows. Those historical
  zeros mean "unknown", not "0 invited." [Source:
  `project_reviewer_history_data_quality.md`]

## Historical read/write-path closeout

> The "16 read / 10 write files" lists captured 2026-05-07 are **superseded**. Re-derived from a full literal grep of `lib/`, `pages/`, `scripts/` for `reviewer_suggestions` + per-site SQL-verb classification. [VERIFIED 2026-05-18 (S164)]

**Closeout result:** zero runtime application code touched the table before
migration 018 dropped it. Reviewer Finder and Review Manager had already moved
to the Dataverse adapter chain. Current references to
`reviewer_suggestions` in retained migration or archaeology material do not
make it a current script-only or drain-only store.

**Historical schema/DDL references:**
- `lib/db/schema.sql` (legacy v1 — historical only), `lib/db/migrations/002_contact_enrichment.sql` (ALTER — contact-enrichment columns). `lib/db/schema-v2.sql` was deleted S188 (B2-F2 closeout — was orphaned, never referenced from executable code).
- `scripts/setup-database.js` — CREATE TABLE + ALTER + migration-step DELETE/UPDATE (V-steps ≈ lines 815/841/844/853)

The audit/backfill/cleanup scripts named in the 2026-05-18 census were
pre-drop tooling. Their retained SQL is not evidence that the table exists and
must not be copied as a current operational procedure.

Not a path: `scripts/seed-reviewer-finder-prompts.js` (comment only), `scripts/README.md` (doc).

**No `pages/api/review-manager/*` Postgres readers OR writers.** The prior claim "Review Manager reads `grant_cycles` from Postgres" is **stale**: Review Manager reads grant cycles from **Dataverse** via `lib/services/grant-cycles-dataverse` and writes reviewer lifecycle to Dataverse `wmkf_appreviewersuggestion` via the adapter. The Review Manager request path's only remaining Postgres touch is the shared cross-app auth gate (`requireAppAccess` → `user_profiles` / `dynamics_user_roles`) — identity infrastructure shared by API routes, not reviewer-domain data. [VERIFIED 2026-05-18 (S164) via transitive import grep of `pages/api/review-manager/*` + the full service chain]

## Historical cross-system mapping

| Postgres | Dataverse `wmkf_appreviewersuggestion` |
|---|---|
| `(researcher_id → researchers.email)` + `request_number` | `(_wmkf_potentialreviewer_value, _wmkf_request_value)` (alt-key) |
| `selected`, `invited`, `accepted`, `declined` | identical booleans |
| `email_sent_at`, `response_received_at`, `materials_sent_at`, `reminder_sent_at`, `reminder_count`, `review_received_at`, `thankyou_sent_at`, `email_opened_at` | identical timestamps |
| `response_type` (string) | `wmkf_responsetype` (picklist; map in `lib/dataverse/adapters/reviewer-suggestion.js`) |
| `review_status` (string) | `wmkf_reviewstatus` (picklist) |
| `match_reason`, `relevance_score`, `sources`, `proposal_abstract`, `proposal_url`, `proposal_password`, `notes` | direct fields |

## Completed migration disposition

- **Cutover and drop complete.** Dataverse `wmkf_appreviewersuggestion` is the
  live source of truth; the Postgres table no longer exists.
- Backfill landed (was 97.6% parity at S136); residual delta and orphans handled at cutover.
- The earlier cleanup-cron and one-shot-delete proposals are superseded. There
  is no pending cleanup or drop action for this table.

## Historical gotchas

- `proposal_id` was a title-prefix, not a cycle-prefix; the historical backfill
  used `(researcher_email, request_number)` rather than
  `(proposal_id, researcher_id)`.
- Four final-snapshot rows lacked `request_number`; that is historical cutover
  evidence, not pending cleanup work.
