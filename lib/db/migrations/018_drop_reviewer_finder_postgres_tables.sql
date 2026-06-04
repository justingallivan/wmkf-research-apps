-- Migration 018: Drop the reviewer-finder Postgres drain tables
--   researchers, researcher_keywords, publications, proposal_searches, reviewer_suggestions
--
-- Closes out the reviewer-finder Postgres → Dataverse migration (W3–W6, 2026-05-12).
-- The reviewer pool, per-person bibliometrics, and per-(person,request) engagement
-- state now live in Dataverse (wmkf_potentialreviewer, wmkf_appreviewersuggestion);
-- these Postgres tables are drained leftovers. Verified 2026-06-04 (S219):
--   - No live application readers/writers in pages/ or lib/ (grep): every remaining
--     reference is an admin/migration SCRIPT or an in-memory JS variable. The W5/W6
--     cutovers gutted DatabaseService's reviewer writes and deleted researchers.js +
--     extract-summary.js. The grant-cycles.js JOIN on proposal_searches went
--     Dataverse-only in W3.
--   - Last writes 2026-05-01 (34 days stale; > the 14-day staleness gate).
--   - publications + proposal_searches are empty (0 rows).
--   - No table OUTSIDE this set has a foreign key INTO any of them, so no constraint
--     surgery is needed — every FK is internal to the set or points OUTWARD to a
--     kept table (grant_cycles, user_profiles) and is dropped automatically with its
--     child. Drop order below is children-of-researchers first, then researchers.
--
-- NOT dropped: search_cache — excluded deliberately. Despite 0 rows it has LIVE
-- callers (DatabaseService.checkCache/cacheSearch in pubmed/biorxiv/arxiv/chemrxiv
-- services + the /api/cron/maintenance cleanupExpiredCache cron). Dropping it would
-- throw at runtime. It is a different (literature-search cache) concern.
--
-- BACKUP: scripts/w6-drop-backup.js dumped researchers (331), researcher_keywords
-- (1028), reviewer_suggestions (337) to local JSONL + Vercel Blob
-- (cleanup-backup/2026-06-04/) on 2026-06-04 before this migration. Restore via
-- scripts/w6-drop-restore.js (recreate tables first) or — preferred within 7 days —
-- Neon PITR, which restores tables+data atomically. Record project_id / branch /
-- connection string / exact UTC run time before applying, per the Wave 1 precedent
-- (migration 007).
--
-- GUARD LIMITATION (same as 007): the DO-block below detects writes via timestamp
-- columns. It does NOT detect raw DELETEs (which leave no timestamp). The grep +
-- staleness verification above is the real safety; this guard is a backstop against
-- an env/flag regression that re-enabled a writer since the 2026-05-15 baseline.

BEGIN;

-- Refuse to run if anything was written to a non-empty table since the baseline
-- (2026-05-15 UTC — comfortably after the 2026-05-12 W6 cutover; the last real
-- write was 2026-05-01). A post-baseline write means a writer we believe retired
-- is still live — stop and investigate before dropping.
DO $$
DECLARE
  r_post  BIGINT;
  rk_post BIGINT;
  rs_post BIGINT;
BEGIN
  SELECT count(*) INTO r_post  FROM researchers
    WHERE last_updated >= '2026-05-15 00:00:00+00';

  SELECT count(*) INTO rk_post FROM researcher_keywords
    WHERE created_at  >= '2026-05-15 00:00:00+00';

  -- reviewer_suggestions rows mutate via several activity timestamps without
  -- touching suggested_at, so check the latest of all of them.
  SELECT count(*) INTO rs_post FROM reviewer_suggestions
    WHERE GREATEST(
      COALESCE(suggested_at,        '1970-01-01'),
      COALESCE(email_sent_at,       '1970-01-01'),
      COALESCE(email_opened_at,     '1970-01-01'),
      COALESCE(response_received_at, '1970-01-01'),
      COALESCE(materials_sent_at,   '1970-01-01'),
      COALESCE(reminder_sent_at,    '1970-01-01'),
      COALESCE(review_received_at,  '1970-01-01'),
      COALESCE(thankyou_sent_at,    '1970-01-01')
    ) >= '2026-05-15 00:00:00+00';

  IF r_post > 0 OR rk_post > 0 OR rs_post > 0 THEN
    RAISE EXCEPTION
      'Migration 018 aborted: post-baseline writes detected (researchers=%, researcher_keywords=%, reviewer_suggestions=%). '
      'Baseline is 2026-05-15 UTC. A write after that means a reviewer-finder Postgres writer is still live — '
      'verify the W3–W6 Dataverse cutover is in effect everywhere before applying.',
      r_post, rk_post, rs_post;
  END IF;
END$$;

-- Drop children of `researchers` first (publications, researcher_keywords,
-- reviewer_suggestions all FK researchers.id), then the independent table, then
-- researchers itself. No ALTER ... DROP CONSTRAINT needed — nothing outside the
-- set references these tables.
DROP TABLE IF EXISTS researcher_keywords;
DROP TABLE IF EXISTS publications;
DROP TABLE IF EXISTS reviewer_suggestions;
DROP TABLE IF EXISTS proposal_searches;
DROP TABLE IF EXISTS researchers;

COMMIT;
