-- Stage 3b, Zoom video copy to SharePoint
-- (docs/plans/ZOOM_VIDEO_SHAREPOINT_COPY_PLAN_2026-10-08.md, Schema).
-- Adds the intent origin column (existing rows and browser callers stay
-- 'browser') and the inert zoom_video_copies table. Nothing writes the table
-- or a 'zoom_copy' origin yet; step 0 only isolates browser paths by origin.
ALTER TABLE presentation_material_uploads
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'browser'
  CONSTRAINT presentation_material_uploads_origin_check CHECK (origin IN ('browser', 'zoom_copy'));

CREATE TABLE IF NOT EXISTS zoom_video_copies (
  id UUID PRIMARY KEY,
  upload_id UUID NOT NULL UNIQUE REFERENCES presentation_material_uploads(id),
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  zoom_meeting_uuid TEXT NOT NULL CHECK (char_length(zoom_meeting_uuid) BETWEEN 1 AND 200),
  zoom_host_id TEXT NOT NULL CHECK (char_length(zoom_host_id) BETWEEN 1 AND 100),
  zoom_host_email_sha256 CHAR(64) NOT NULL CHECK (zoom_host_email_sha256 ~ '^[0-9a-f]{64}$'),
  zoom_meeting_start TIMESTAMPTZ NOT NULL,
  zoom_file_id TEXT NOT NULL CHECK (char_length(zoom_file_id) BETWEEN 1 AND 200),
  zoom_recording_type TEXT NOT NULL CHECK (zoom_recording_type ~ '^[a-z_]{1,60}(\(CC\))?$'),
  declared_size BIGINT NOT NULL CHECK (declared_size > 0 AND declared_size <= 2000000000),
  confirmed_winner_document_id UUID,
  confirmed_winner_slot_version INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued','copying','registering','copied','failed','cancelled')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  bytes_confirmed BIGINT NOT NULL DEFAULT 0 CHECK (bytes_confirmed BETWEEN 0 AND declared_size),
  session_create_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (session_create_attempts BETWEEN 0 AND 3),
  session_restarts SMALLINT NOT NULL DEFAULT 0 CHECK (session_restarts BETWEEN 0 AND 3),
  uncertain_checks SMALLINT NOT NULL DEFAULT 0 CHECK (uncertain_checks BETWEEN 0 AND 3),
  registration_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (registration_attempts BETWEEN 0 AND 5),
  cancel_requested_at TIMESTAMPTZ,
  request_document_id UUID,
  sharepoint_drive_id TEXT,
  sharepoint_item_id TEXT,
  sharepoint_quickxor_hash TEXT CHECK (sharepoint_quickxor_hash IS NULL OR char_length(sharepoint_quickxor_hash) <= 100),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT zoom_video_copies_intent_id CHECK (upload_id = id),
  CONSTRAINT zoom_video_copies_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT zoom_video_copies_winner_shape CHECK ((confirmed_winner_document_id IS NULL) = (confirmed_winner_slot_version IS NULL)),
  CONSTRAINT zoom_video_copies_item_shape CHECK ((sharepoint_drive_id IS NULL) = (sharepoint_item_id IS NULL)),
  CONSTRAINT zoom_video_copies_failed_shape CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT zoom_video_copies_terminal_unleased CHECK (state NOT IN ('copied','failed','cancelled') OR lease_token IS NULL),
  CONSTRAINT zoom_video_copies_registering_shape CHECK (state <> 'registering' OR sharepoint_item_id IS NOT NULL),
  CONSTRAINT zoom_video_copies_copied_shape CHECK (state <> 'copied' OR (request_document_id IS NOT NULL
    AND sharepoint_item_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_active_request
  ON zoom_video_copies (request_id) WHERE state IN ('queued','copying','registering');
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_copied_file
  ON zoom_video_copies (request_id, zoom_file_id) WHERE state = 'copied';
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_work
  ON zoom_video_copies (state, next_attempt_at, lease_expires_at) WHERE state IN ('queued','copying','registering');
CREATE INDEX IF NOT EXISTS idx_zoom_video_copies_request_recent
  ON zoom_video_copies (request_id, created_at DESC);
