# Atlas: `reviewer_suggestions` (Postgres — DROPPED 2026-06-04)

<!-- drain-table:file-purpose=atlas-state-page -->

> **DROPPED 2026-06-04 (S219)** via `lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql`. The table no longer exists in Postgres. Per-(person,request) reviewer engagement state lives in Dataverse `wmkf_appreviewersuggestion` (source of truth). Pre-drop data (337 rows) backed up to local JSONL + Vercel Blob `cleanup-backup/2026-06-04/reviewer_suggestions.jsonl`; restore via `scripts/w6-drop-restore.js` or Neon PITR (7-day). Verified 2026-06-04: no live app SQL readers/writers (only admin/migration scripts). Page retained as historical record.

**Last verified:** schema/row-count 2026-05-07 via `scripts/audit-postgres-state.js` + `scripts/backfill-reviewer-suggestions-parity.js`; **read/write path lists re-derived 2026-05-18 (S164)** via full codebase grep + per-site SQL-verb classification (see "Read / write paths" below)
**Final row count before drop:** 337

## Source of truth

**Mixed and shifting.** Postgres holds the legacy historical record. Dataverse `wmkf_appreviewersuggestion` (336 rows) holds the active per-proposal lifecycle. Parity probe shows ~99% of Postgres rows are stale duplicates of Dataverse rows.

## Schema (live, 37 columns)

Identity: `id`, `proposal_id` (varchar(100) — title-prefix, NOT a cycle code), `proposal_title`, `researcher_id` (FK), `request_number` (varchar — natural join key to `akoya_request.akoya_requestnum`).

Scoring/match: `relevance_score`, `match_reason`, `sources` (text[]), `proposal_abstract`, `proposal_authors`, `proposal_institution`, `co_investigators`, `co_investigator_count`.

Lifecycle bools: `selected` (337/100%), `invited` (337/100%), `accepted` (29/9%), `declined` (337/100%).

Outreach timestamps: `email_sent_at` (43/13%), `email_opened_at` (0%), `response_received_at` (22/7%), `response_type` (22/7%; `accepted | declined | no_response`), `materials_sent_at` (19/6%), `reminder_sent_at` (1/0%), `reminder_count` (337/100%), `review_received_at` (1/0%), `review_blob_url` (1/0%), `review_filename` (1/0%), `thankyou_sent_at` (1/0%), `review_status` (20/6%).

External-reviewer intake: `proposal_url` (16/5%), `proposal_password` (16/5%).

Blob attachments: `summary_blob_url` (184/337 = 55% populated) — Vercel Blob URL of the extracted summary page(s). Written by `pages/api/reviewer-finder/extract-summary.js` as part of save-candidates. **Legacy field** — was load-bearing for the deprecated `generate-emails` flow; the active `pages/api/review-manager/send-emails.js` flow attaches `grant_cycles.review_template_blob_url` (379) instead. Migration can drop this column safely once `generate-emails` is retired.

User scoping: `user_profile_id` (337/100%), `program_area` (337/100%), `grant_cycle_id` (337/100%, FK grant_cycles.id).

UNIQUE constraint: `(proposal_id, researcher_id)`.

## Live state notes

- **`request_number` populated on 333 / 337 (99%)** — added retroactively via `scripts/backfill-request-numbers.js`. Critical for the Dataverse cutover (joins to `akoya_request`).
- 4 rows missing `request_number` are pre-J26 (from before the `akoya_requestnum` field was tracked).
- Cycle distribution (top 5): J26 program area title prefixes `qua/con/vis/res/fro/evo/mol/dea/cir/in-/ele/dec/die/mea/unc/gut/lin/fie/lig/all/non` — so `proposal_id` prefix is the proposal title's first 3 chars, not a structured code.
- **97.6% of rows are stale duplicates** of existing `wmkf_appreviewersuggestion` rows per parity probe. [VERIFIED 2026-05-06 via `scripts/backfill-reviewer-suggestions-parity.js`]
- **All 337 rows have `selected=true`** [VERIFIED 2026-05-07 via `scripts/audit-postgres-state.js`] — the "transient unselected scratch" pattern does not appear in live data. The Wave 2 cleanup-cron predicate is forward-looking only.
- **Pre-J26 data-quality caveat:** the tool that writes here was first used in J26 cycle and adoption was uneven; pre-J26 proposals (J25, J24, ...) have **no rows here** — picker falls back to `akoya_request.wmkf_potentialreviewer1..5` slot population. Pre-J26 zeros mean "unknown", NOT "0 invited". [Source: `project_reviewer_history_data_quality.md`]

## Read / write paths — RE-DERIVED 2026-05-18 (S164)

> The "16 read / 10 write files" lists captured 2026-05-07 are **superseded**. Re-derived from a full literal grep of `lib/`, `pages/`, `scripts/` for `reviewer_suggestions` + per-site SQL-verb classification. [VERIFIED 2026-05-18 (S164)]

**Headline: zero runtime application code touches this table.** No `lib/services/**` and no `pages/api/**` file references `reviewer_suggestions`. The prior list's `lib/services/database-service.js` (gutted W5, commit `0c58da4`), `lib/services/maintenance-service.js`, and every `pages/api/reviewer-finder/*` entry (incl. the W6-deleted `researchers.js`) are all stale — Reviewer Finder + Review Manager are fully on the Dataverse adapter chain. `lib/dataverse/adapters/reviewer-suggestion.js` mentions the name in a migration **comment** only (no Postgres access). The table is now **script-only**, consistent with the drain-only disposition below.

**Schema / DDL (define the table — not an app path):**
- `lib/db/schema.sql` (legacy v1 — historical only), `lib/db/migrations/002_contact_enrichment.sql` (ALTER — contact-enrichment columns). `lib/db/schema-v2.sql` was deleted S188 (B2-F2 closeout — was orphaned, never referenced from executable code).
- `scripts/setup-database.js` — CREATE TABLE + ALTER + migration-step DELETE/UPDATE (V-steps ≈ lines 815/841/844/853)

**Read-only scripts (SELECT/COUNT):** `audit-postgres-state.js`, `db-row-counts.js`, `inspect-reviewer-suggestions.js`, `inspect-reviewer-suggestions-pt2.js`, `audit-grant-cycle-duplicate-fk-refs.js`, `backfill-reviewer-suggestions-parity.js`, `reconcile-reviewer-migration.js`, `export-proposals-for-migration.js`, `probe-w4-1002285.js`, `acceptance-w3.js`, `cleanup-database.js` (direct SELECT COUNT; deletes `researchers` → `reviewer_suggestions` removed via FK CASCADE, not a direct write), and the three PG→Dataverse backfills `backfill-postgres-to-dataverse.js` / `backfill-reviewer-suggestions-to-dataverse.js` / `backfill-summary-blob-url-to-dataverse.js` (Postgres side read-only; write target is Dataverse).

**Write scripts (direct INSERT/UPDATE/DELETE):** `clear-all-database.js` (DELETE — full wipe), `backfill-request-numbers.js` (UPDATE `request_number`), `cleanup-duplicate-cycles.js` (UPDATE re-point FK), `assign-orphan-records.js` (UPDATE `user_profile_id`; also reads), `import-user-assignments.js` (UPDATE), `setup-database.js` (migration-step DELETE/UPDATE; see DDL above).

Not a path: `scripts/seed-reviewer-finder-prompts.js` (comment only), `scripts/README.md` (doc).

**No `pages/api/review-manager/*` Postgres readers OR writers.** The prior claim "Review Manager reads `grant_cycles` from Postgres" is **stale**: Review Manager reads grant cycles from **Dataverse** via `lib/services/grant-cycles-dataverse` and writes reviewer lifecycle to Dataverse `wmkf_appreviewersuggestion` via the adapter. The Review Manager request path's only remaining Postgres touch is the shared cross-app auth gate (`requireAppAccess` → `user_profiles` / `dynamics_user_roles`) — identity infrastructure shared by all ~[113](../CANONICAL_COUNTS.md#api-route-file-count) route files, not reviewer-domain data. [VERIFIED 2026-05-18 (S164) via transitive import grep of `pages/api/review-manager/*` + the full service chain]

## Cross-system

| Postgres | Dataverse `wmkf_appreviewersuggestion` |
|---|---|
| `(researcher_id → researchers.email)` + `request_number` | `(_wmkf_potentialreviewer_value, _wmkf_request_value)` (alt-key) |
| `selected`, `invited`, `accepted`, `declined` | identical booleans |
| `email_sent_at`, `response_received_at`, `materials_sent_at`, `reminder_sent_at`, `reminder_count`, `review_received_at`, `thankyou_sent_at`, `email_opened_at` | identical timestamps |
| `response_type` (string) | `wmkf_responsetype` (picklist; map in `lib/dataverse/adapters/reviewer-suggestion.js`) |
| `review_status` (string) | `wmkf_reviewstatus` (picklist) |
| `match_reason`, `relevance_score`, `sources`, `proposal_abstract`, `proposal_url`, `proposal_password`, `notes` | direct fields |

## Migration disposition (post-W3-W6 cutover 2026-05-12)

- **Cutover complete.** Postgres `reviewer_suggestions` is drain-only; live source of truth is Dataverse `wmkf_appreviewersuggestion` (W5 reader cutover 2026-05-12).
- Backfill landed (was 97.6% parity at S136); residual delta and orphans handled at cutover.
- **No cleanup cron exists** — the cleanup-cron plan was replaced post-Codex-review with a one-shot post-pilot DELETE script (see `.claude-memory/project_w6_table_drop_pending.md`). The locked predicate (S136) for that one-shot drop: rows where `wmkf_meetingdate < today - 30 days` AND none of 8 engagement signals on the linked `wmkf_appreviewersuggestion` are populated: `wmkf_contact`, `wmkf_emailsentat`, `wmkf_responsetype`, `wmkf_selected`, `wmkf_externaltokenissued`, `wmkf_proposalfirstaccessed`, `wmkf_reviewsharepointfolder`, any review-form picklist (`wmkf_revieweraffiliation`, `wmkf_reviewerimpact`, `wmkf_reviewerrisk`, `wmkf_revieweroverallrating`). One-shot drop is destructive-carryover-gated (≥2026-07-01; requires `scripts/restore-postgres-drain-table-backup.js` to be built first — not yet built).

## Open questions / gotchas

- `proposal_id` is title-prefix, not cycle-prefix. Idempotency on backfill must use `(researcher_email, request_number)`, NOT `(proposal_id, researcher_id)`. [VERIFIED via S136 Codex round 1 + parity probe]
- 4 rows lack `request_number` — handle as orphaned during cleanup. [VERIFIED 2026-05-07 via audit script]
