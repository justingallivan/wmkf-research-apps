-- Zoom recording import (docs/plans/ZOOM_RECORDING_IMPORT_PLAN_2026-10-08.md, Stage 3a).
-- One row per attempt to import a Zoom meeting's audio and Zoom transcript into the
-- existing transcription pipeline. The row stores identifiers only: no content, URLs,
-- tokens, topics or names. 'importing' rows hold a lease (longer than the 300 s route
-- maxDuration); the final update matches id and lease_token, so a killed request can
-- never overwrite a takeover. At most one importing/started row exists per request and
-- meeting; a failed row frees the slot for a retry (which gets a new row and a new job). A started
-- row blocks duplicates only while its job is live: when the job is failed, expired or gone the
-- service marks the row failed (zoom_import_job_ended) so the meeting can be imported again.
CREATE TABLE IF NOT EXISTS zoom_recording_imports (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  zoom_meeting_uuid TEXT NOT NULL CHECK (char_length(zoom_meeting_uuid) BETWEEN 1 AND 200),
  zoom_host_id TEXT NOT NULL CHECK (char_length(zoom_host_id) BETWEEN 1 AND 100),
  zoom_meeting_start TIMESTAMPTZ NOT NULL,
  includes_zoom_transcript BOOLEAN NOT NULL,
  state TEXT NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  transcription_job_id UUID REFERENCES transcription_jobs(id) ON DELETE SET NULL,
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT zoom_recording_imports_state_check CHECK (state IN ('importing', 'started', 'failed')),
  CONSTRAINT zoom_recording_imports_lease_shape CHECK ((state = 'importing') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CONSTRAINT zoom_recording_imports_failed_shape CHECK ((state = 'failed') = (failure_code IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_recording_imports_active
  ON zoom_recording_imports (request_id, zoom_meeting_uuid) WHERE state IN ('importing', 'started');

CREATE INDEX IF NOT EXISTS idx_zoom_recording_imports_request_recent
  ON zoom_recording_imports (request_id, created_at DESC);

COMMENT ON TABLE zoom_recording_imports IS
  'Zoom recording import attempts for Meeting Tracker transcription; identifiers and lifecycle state only, no recording content, URLs, tokens or topics.';
