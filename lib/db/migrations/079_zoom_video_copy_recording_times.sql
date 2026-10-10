-- Stage 4 decision 16: the copied MP4's Zoom recording_start/recording_end, written at copy start.
-- Additive and nullable; owner applies before the runtime merge; no backfill (older copies stay
-- ineligible for a presentation-video cut until re-copied).
ALTER TABLE zoom_video_copies
  ADD COLUMN IF NOT EXISTS recording_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recording_end TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE zoom_video_copies ADD CONSTRAINT zoom_video_copies_recording_times_shape CHECK (
    (recording_start IS NULL) = (recording_end IS NULL)
    AND (recording_start IS NULL OR recording_end >= recording_start)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN zoom_video_copies.recording_start IS 'Zoom recording_files[].recording_start of the copied MP4, captured at copy start (Stage 4 same-source check). NULL for copies made before migration 079.';
COMMENT ON COLUMN zoom_video_copies.recording_end IS 'Zoom recording_files[].recording_end of the copied MP4, captured at copy start. Set together with recording_start.';
