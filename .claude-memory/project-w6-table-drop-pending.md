---
name: w6-table-drop-pending
description: "After ~2026-07-01, run the Wave 2 W6 Postgres table-drop checklist for drain-only reviewer tables (researchers, researcher_keywords, publications, proposal_searches). Built per Codex's recommendation to defer cleanup-cron in favor of one-shot DELETE matching Wave 1 precedent."
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

Read this when: a session starts on or after 2026-07-01 and the drain-only reviewer Postgres tables still exist.

Do:
- Surface this as a P0 `/start` item if past the date threshold and tables still present.
- Run the staleness probe first (every `MAX(...)` should be ≥14 days old); STOP if any is recent.
- Back up to JSONL on Blob + write the restore script before any DROP; drop in dependency order (`researcher_keywords` before `researchers`); update Atlas pages + re-run `check:atlas`.

Do not:
- Build a cleanup cron — the decision was a one-shot DELETE per Wave 1 precedent.
- Proceed if the pilot was rolled back or a live reader is found — the trigger is "date passed," not "drop no matter what."

Ground truth: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` (post-pilot row §801), `docs/atlas/postgres-researchers.md`, `docs/atlas/postgres-other-reviewer-tables.md`. Related: [[project-reviewer-postgres-to-dataverse-migration]].

**Trigger:** any session that starts on or after **2026-07-01**, while these tables still exist in Postgres.

If the current date is past that threshold and the tables still exist, surface this as a P0 start-of-session item alongside the rest of the `/start` digest. Do NOT silently proceed with other work — the user is likely expecting this to come up.

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
