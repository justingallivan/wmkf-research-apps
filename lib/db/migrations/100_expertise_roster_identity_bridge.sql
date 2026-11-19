-- Expertise roster numeric identity bridge (inert, additive).
--
-- Plan: docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md.
-- Creates two EMPTY tables. Applying this file changes no behaviour: nothing reads
-- them until EXPERTISE_ROSTER_BACKEND=dataverse is set, and the legacy cutover
-- marker (roster-cutover-marker.cjs) only freezes legacy roster writes once a
-- Production-host binding row exists. Population, the consultant_feedback FK
-- retarget and the switch are the separately authorized operator cutover, not
-- this migration. No triggers, defaults, sequences or FK changes here.
--
-- expertise_roster_identity: one row per numeric roster ID ever issued; the
-- future consultant_feedback FK target. New IDs come from the legacy
-- expertise_roster_id_seq.
-- expertise_roster_binding: which Dataverse profile GUID a numeric ID means on
-- a given Dataverse host. Holds no names, emails or expertise copies.
CREATE TABLE IF NOT EXISTS expertise_roster_identity (
  id INTEGER PRIMARY KEY CHECK (id > 0)
);

CREATE TABLE IF NOT EXISTS expertise_roster_binding (
  roster_id INTEGER NOT NULL REFERENCES expertise_roster_identity(id) ON DELETE RESTRICT,
  target_host TEXT NOT NULL CHECK (
    target_host = lower(target_host) AND target_host !~ '[/ :]' AND length(target_host) <= 253
  ),
  dataverse_profile_guid UUID NOT NULL,
  PRIMARY KEY (roster_id, target_host),
  UNIQUE (target_host, dataverse_profile_guid)
);
