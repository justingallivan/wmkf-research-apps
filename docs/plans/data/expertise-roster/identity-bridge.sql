-- DRAFT INERT DDL: outside lib/db/migrations intentionally; NOT provisioned.
-- Allocate a numbered migration only after checking all branches + live ledger.
-- No ID defaults/sequences, population, existing-FK changes, or cutover effects.
CREATE TABLE expertise_roster_identity (
  id INTEGER PRIMARY KEY CHECK (id > 0)
);
CREATE TABLE expertise_roster_binding (
  roster_id INTEGER NOT NULL REFERENCES expertise_roster_identity(id) ON DELETE RESTRICT,
  target_host TEXT NOT NULL CHECK (
    target_host = lower(target_host) AND target_host !~ '[/ :]' AND length(target_host) <= 253
  ),
  dataverse_profile_guid UUID NOT NULL,
  PRIMARY KEY (roster_id, target_host),
  UNIQUE (target_host, dataverse_profile_guid)
);
-- Host registry allowlisting remains mandatory at the application boundary.
-- The gated operational cutover separately initializes the allocator after
-- freezing old writers, and retargets consultant_feedback's FK only after parity.
