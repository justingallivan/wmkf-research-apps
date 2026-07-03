-- Migration 023: add a non-selectable institution-COI drop ledger status.
--
-- `coi_dropped` records candidates removed by the discovery-time Contract 5
-- institution-COI hard drop. It reuses the existing reviewer_find_roster table
-- and status column; no new table is needed. The roster read path keeps this
-- status out of active/excluded render buckets while allNames still dedups it.

ALTER TABLE reviewer_find_roster
  DROP CONSTRAINT IF EXISTS reviewer_find_roster_status_chk;

ALTER TABLE reviewer_find_roster
  ADD CONSTRAINT reviewer_find_roster_status_chk
  CHECK (status IN ('active','excluded','saved','coi_dropped'));
