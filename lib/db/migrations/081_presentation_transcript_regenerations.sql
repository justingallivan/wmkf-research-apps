-- Site Visit redesign slice C1 (docs/plans/SITE_VISIT_PAGE_REDESIGN_PLAN_2026-10-10.md, 4.1 and 6 C1):
-- presentation_transcript_regenerations, the queue behind automatic presentation and staff discussion transcripts
-- after a meeting-transcript CORRECTION publish. A once-a-minute cron drains it; generation runs as the staff member
-- who published. Transcripts only: summaries stay a manual "Summarize again".
-- At most one pending and one running row per request (latest publish wins). Content-free: ids, a fingerprint, counters.
-- Inert until the correction-publish path enqueues a row; the worker and the card tolerate a missing table.
CREATE TABLE IF NOT EXISTS presentation_transcript_regenerations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  transcript_artifact_id UUID NOT NULL,
  transcript_fingerprint TEXT NOT NULL CHECK (transcript_fingerprint ~ '^[0-9a-f]{64}$'),
  transcript_slot_version BIGINT NOT NULL CHECK (transcript_slot_version > 0),
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  acting_user_system_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','done','failed','superseded')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at TIMESTAMPTZ,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT presentation_transcript_regenerations_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT presentation_transcript_regenerations_running_leased CHECK (state <> 'running' OR lease_token IS NOT NULL),
  CONSTRAINT presentation_transcript_regenerations_idle_unleased CHECK (state NOT IN ('pending','done','failed','superseded') OR lease_token IS NULL),
  CONSTRAINT presentation_transcript_regenerations_failed_shape CHECK (
    (state <> 'failed' OR failure_code IS NOT NULL) AND (failure_code IS NULL OR state IN ('failed','superseded')))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_transcript_regenerations_pending
  ON presentation_transcript_regenerations (request_id) WHERE state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_transcript_regenerations_running
  ON presentation_transcript_regenerations (request_id) WHERE state = 'running';
CREATE INDEX IF NOT EXISTS idx_presentation_transcript_regenerations_work
  ON presentation_transcript_regenerations (state, next_attempt_at, lease_expires_at) WHERE state IN ('pending','running');
COMMENT ON TABLE presentation_transcript_regenerations IS 'Queue of automatic presentation and staff discussion transcript generations after a correction publish. One pending and one running row per request at most, and the newest publish replaces the pending row. Identifiers, a fingerprint, state and counters only.';
COMMENT ON COLUMN presentation_transcript_regenerations.transcript_artifact_id IS 'The published transcript (Request Document id) the generation was queued for. Compared with the current artifact id to decide whether the card shows Updating.';
COMMENT ON COLUMN presentation_transcript_regenerations.transcript_slot_version IS 'Publication order: the TRANSCRIPT slot fence of the publish that queued the row, strictly increasing per request. A pending row is replaced only by a higher value, so a delayed enqueue for an older publish cannot overwrite a newer one.';
COMMENT ON COLUMN presentation_transcript_regenerations.acting_user_system_id IS 'Dataverse user id of the staff member who published, and generation writes run as them.';
COMMENT ON COLUMN presentation_transcript_regenerations.attempts IS 'Counted when a row is claimed. A claim that finds a transient fault re-queues with backoff until 3, then fails with the last code.';
