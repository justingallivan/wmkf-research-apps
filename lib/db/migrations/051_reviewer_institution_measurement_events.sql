-- Prospective, non-authoritative Find institution observations. Never used by
-- selection or Dataverse writes. Pseudonymous digests are personal data.
-- Writer: reviewer-institution-measurement.js; reader: operator report.
-- Cleanup: daily maintenance, 90 days and 200,000 rows.
CREATE TABLE IF NOT EXISTS reviewer_institution_measurement_events (
  id BIGSERIAL PRIMARY KEY,
  case_key CHAR(64) NOT NULL,
  card_snapshot_digest CHAR(64) NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'roster_upsert', 'staff_excluded', 'staff_restored',
    'staff_identity_confirmed', 'staff_contact_edited',
    'save_saved', 'save_rejected')),
  capture_source TEXT NOT NULL CHECK (capture_source IN ('server_applicant', 'roster_unverified', 'stored_roster')),
  source_kind TEXT,
  legacy_hold BOOLEAN,
  relationship TEXT,
  evidence_context TEXT,
  evidence_source_type TEXT,
  evidence_currentness TEXT,
  evidence_author_specific TEXT,
  recorded_source_type TEXT,
  recorded_currentness TEXT,
  additional_affiliation_count SMALLINT,
  independent_identity TEXT NOT NULL CHECK (independent_identity = 'not_evaluable'),
  additional_coi TEXT NOT NULL CHECK (additional_coi = 'not_screened'),
  proposed_action TEXT NOT NULL CHECK (proposed_action = 'not_evaluable'),
  outcome_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviewer_institution_measurement_created
  ON reviewer_institution_measurement_events (created_at);
CREATE INDEX IF NOT EXISTS idx_reviewer_institution_measurement_case
  ON reviewer_institution_measurement_events (case_key, created_at);
