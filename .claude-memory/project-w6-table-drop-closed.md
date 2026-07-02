---
name: project-w6-table-drop-closed
description: "CLOSED — the reviewer-finder Postgres drain tables (researchers, researcher_keywords, publications, proposal_searches, + reviewer_suggestions) were DROPPED 2026-06-04 via tracked migration 018, ahead of the original ≥2026-07-01 trigger. search_cache kept. Historical checklist retained below; no longer actionable."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6f66eb83-87a2-47a6-b4be-21f06cbadf1a
  status: closed
  scope: dataverse
  last_verified: 2026-06-04 — DONE early (S219): all 5 tables dropped via migration 018; verified gone from pg catalog
---

> **CLOSED — DROPPED EARLY 2026-06-04 (S219), ahead of the 2026-07-01 trigger.** Justin directed the cleanup now (he'd already removed reviewer-finder/review-manager from other users' visibility and stopped using them). Scope EXPANDED beyond the original 4 to **5 tables** — `researchers`, `researcher_keywords`, `publications`, `proposal_searches`, **+ `reviewer_suggestions`** — once a live FK probe showed `reviewer_suggestions.researcher_id → researchers` and re-verification confirmed `reviewer_suggestions` had no live app SQL (admin/migration scripts only). Dropping it too made the FK wrinkle vanish (nothing outside the set references any drop-target → no constraint surgery). **`search_cache` was EXCLUDED** — despite 0 rows it has LIVE callers (`DatabaseService.checkCache`/`cacheSearch` in pubmed/biorxiv/arxiv/chemrxiv + `/api/cron/maintenance`). Mechanism = a tracked migration (`018_drop_reviewer_finder_postgres_tables.sql`), matching the Wave 1 precedent (007), NOT the raw one-shot script this memory originally specified. Pre-drop backups (researchers 331 / researcher_keywords 1028 / reviewer_suggestions 337) → local JSONL + Vercel Blob `cleanup-backup/2026-06-04/` (`scripts/w6-drop-backup.js` + `scripts/w6-drop-restore.js`). Neon PITR 7-day = secondary restore. Atlas pages + CLAUDE.md schema table reconciled. The historical checklist below is retained for record; it is no longer actionable.

## Recall Rule

Read this when: you need the history of the reviewer-finder Postgres table drop (it is DONE — closed 2026-06-04). The action below is HISTORICAL; do not re-run it.

Done (2026-06-04, S219):
- All 5 tables dropped via tracked migration 018 (verified gone from the pg catalog); `search_cache` kept.
- Backups taken (local JSONL + Blob `cleanup-backup/2026-06-04/`); restore = `scripts/w6-drop-restore.js` or Neon PITR.

Do not:
- Re-create the dropped tables, or treat the checklist below as a pending action — it executed.
- Drop `search_cache` (live callers) or `grant_cycles` (still draining) without their own verification.

Ground truth: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (post-pilot row §801), `docs/atlas/postgres-researchers.md`, `docs/atlas/postgres-other-reviewer-tables.md`. Related: [[project-reviewer-postgres-to-dataverse-migration]].

**Trigger — SATISFIED / DO NOT RE-FIRE.** The original trigger was "any session on/after 2026-07-01 **while these tables still exist in Postgres**." The tables no longer exist — they were dropped 2026-06-04 (S219) via migration 018, so the "still exist" precondition is false and the trigger is closed. A stale calendar reminder for 2026-07-01 may still fire externally; if it does, this is already DONE — do NOT surface it as a P0 item or run the historical checklist below. (If you hit this and want to confirm: `ls lib/db/migrations/018_drop_reviewer_finder_postgres_tables.sql` and the DROPPED banners in `docs/atlas/postgres-researchers.md` / `postgres-reviewer-suggestions.md`.)

**Why deferred (decided 2026-05-12, Session 147):** Plan §799 originally specified a dry-run cleanup cron + restore script. Codex recommended deferring per the Wave 1 precedent — Wave 1's drain-only tables (`system_settings`, `user_app_access`, `user_preferences`) were dropped with a one-shot DELETE on 2026-05-12 without ceremony, and it worked. Building a cron that sits in dry-run during an active pilot is maintained surface for noise nobody reads. The actual deletion path is short enough to write at table-drop time with the row format in front of you.

**The checklist (canonical version in `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` post-pilot row §801):**

1. **Staleness probe.** For each drain-only table, confirm no recent writes:
   ```sql
   SELECT 'researchers' AS tbl, MAX(last_updated) FROM researchers
   UNION ALL SELECT 'researcher_keywords', MAX(created_at) FROM researcher_keywords
   UNION ALL SELECT 'publications', MAX(created_at) FROM publications
   UNION ALL SELECT 'proposal_searches', MAX(created_at) FROM proposal_searches;
   ```
   Every `MAX(...)` should be ≥ 14 days old. If any is recent, **stop** — there's a writer the W6 retirement missed. Investigate before deleting.

2. **Backup as JSONL to Vercel Blob.** One-shot, no cron:
   ```sql
   DELETE FROM researchers RETURNING *;
   ```
   Pipe `RETURNING *` rows into a JSONL file per table, upload to Blob with a path like `cleanup-backup/2026-07-XX/researchers.jsonl`. Tools-of-choice: a thin Node script under `scripts/`, name it `scripts/drain-only-table-drop.js`. Write the restore script (~30 lines, reads JSONL, INSERTs back) alongside it before running for real.

3. **DROP TABLE in dependency order.** `researcher_keywords` (FK to `researchers`) first, then `researchers`. `publications` and `proposal_searches` are independent. Be aware of the `proposal_searches` JOIN site that was in `pages/api/reviewer-finder/grant-cycles.js`; grep `proposal_searches` in that file and re-read `docs/atlas/postgres-other-reviewer-tables.md` to verify the JOIN was killed in W3 before dropping the table.

4. **Update Atlas pages** to remove the dropped tables: `docs/atlas/postgres-researchers.md`, `docs/atlas/postgres-other-reviewer-tables.md`. Add a one-line history note in the plan's "Spec'd vs. built" table.

5. **Re-run CI gates.** `npm run check:atlas` should still pass — atlas-coverage is based on what's referenced in source, and we removed source readers in W5/W6.

**Related memory:** [[project-reviewer-postgres-to-dataverse-migration]] — strategic context for the whole migration.

**Cancel condition:** If the pilot was rolled back, or if a post-pilot review found a dead-code reader these tables actually serve, surface that fact rather than proceeding. The trigger is "date passed" not "drop these now no matter what."
