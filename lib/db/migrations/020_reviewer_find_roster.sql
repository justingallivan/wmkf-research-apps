-- Migration 020: Per-request reviewer-search candidate roster (Find-tab dedup + exclude/promote)
-- See docs/atlas/postgres-reviewer-find-roster.md for the full Atlas page.
--
-- Backs the Workbench Reviewers→Find tab's durable per-request candidate roster.
-- A literature search surfaces candidates that today live only in React state and
-- vanish on reload; this table makes them durable PER REQUEST so that:
--   1. Re-running a search SUPPRESSES already-surfaced names (cross-run dedup),
--      enforced server-side in /api/reviewer-finder/discover BEFORE the
--      per-candidate Claude reasoning call — so a re-run finds new people instead
--      of re-spending tokens re-surfacing the same set.
--   2. Staff can EXCLUDE a candidate (conflict / inappropriate) without deleting
--      it: it collapses into a recoverable "Excluded" section and can be promoted
--      back to the active list.
--
-- IMPORTANT — this is NOT a regression of the S219/migration-018 Postgres→Dataverse
-- cutover. Migration 018 dropped the CANONICAL reviewer-identity tables (researchers,
-- publications, reviewer_suggestions, …), whose source of truth is now Dataverse
-- (wmkf_potentialreviewer / wmkf_appreviewersuggestion). THIS table holds OPERATIONAL,
-- pre-save, per-request working state (un-vetted search discoveries + their render
-- blobs) — the same class as `search_cache`, which migration 018 deliberately KEPT in
-- Postgres. The canonical saved pool still lives in Dataverse, untouched. Search
-- candidates are name-based and frequently email-less at surface time, while the
-- canonical pool is email-keyed, so a name-keyed Postgres roster is the right home.
--
-- One row per (request_id, normalized_name) — the unique index IS the dedup key and
-- matches normalizeReviewerName()/filterExcluded()'s exact-normalized match. Status:
--   active   — surfaced and available → rendered in the selectable list
--   excluded — set aside by staff → rendered in the collapsed "Excluded (N)" section
--   saved    — graduated to the Dataverse pool (Candidates/Invite tabs); not rendered
--              on Find, but kept so a re-search still dedups against it.
-- recordSurfaced never downgrades excluded/saved back to active (curation wins), and
-- enforces a per-request row cap (oldest active/saved evicted; never excluded).

CREATE TABLE IF NOT EXISTS reviewer_find_roster (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id      UUID NOT NULL,                 -- akoya_request GUID
  normalized_name TEXT NOT NULL,                 -- normalizeReviewerName(candidate.name)
  display_name    TEXT NOT NULL,                 -- surface-time candidate.name (for re-render)
  status          TEXT NOT NULL,                 -- 'active' | 'excluded' | 'saved'
  candidate       JSONB NOT NULL,                -- pruned render DTO (CandidateCard fields only)
  source_kind     TEXT,                          -- 'claude_verified' | 'database'
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reviewer_find_roster_status_chk CHECK (status IN ('active','excluded','saved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviewer_find_roster_req_name
  ON reviewer_find_roster (request_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_reviewer_find_roster_req_status
  ON reviewer_find_roster (request_id, status);
