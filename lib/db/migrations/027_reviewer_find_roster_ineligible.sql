-- Add the durable non-selectable status used for direct, identity-bound
-- deceased evidence. `ineligible` stays in the request's allNames dedup union
-- and renders separately from active/excluded candidates.

ALTER TABLE reviewer_find_roster
  DROP CONSTRAINT IF EXISTS reviewer_find_roster_status_chk;

ALTER TABLE reviewer_find_roster
  ADD CONSTRAINT reviewer_find_roster_status_chk
  CHECK (status IN ('active','excluded','saved','coi_dropped','ineligible'));
