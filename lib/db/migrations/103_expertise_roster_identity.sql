-- Additive, empty identity bridge. Does NOT retarget feedback or freeze writers.
CREATE TABLE IF NOT EXISTS expertise_roster_identity (
  id INTEGER PRIMARY KEY CHECK (id > 0)
);
CREATE TABLE IF NOT EXISTS expertise_roster_binding (
  roster_id INTEGER NOT NULL REFERENCES expertise_roster_identity(id),
  target_host TEXT NOT NULL CHECK (target_host = lower(target_host)),
  dataverse_profile_guid UUID NOT NULL,
  PRIMARY KEY (roster_id, target_host),
  UNIQUE (target_host, dataverse_profile_guid)
);
COMMENT ON TABLE expertise_roster_identity IS 'Numeric roster identities retained for feedback and saved recipient references; no roster content.';
COMMENT ON TABLE expertise_roster_binding IS 'Numeric identity to target-specific Dataverse profile; first production binding freezes legacy roster writers.';
