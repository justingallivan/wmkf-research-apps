-- Migration 029: terminal promotion block for applicant-excluded collisions.
--
-- A candidate that resolves to an applicant-excluded suggestion cannot be
-- promoted while that authoritative disposition remains in place. Persisting
-- the terminal state keeps the Find UI from offering an action that can only
-- fail, while retaining the row for audit and cross-run dedup.

ALTER TABLE reviewer_find_roster
  DROP CONSTRAINT IF EXISTS reviewer_find_roster_status_chk;

ALTER TABLE reviewer_find_roster
  ADD CONSTRAINT reviewer_find_roster_status_chk
  CHECK (status IN ('active','excluded','saved','coi_dropped','ineligible','blocked'));
