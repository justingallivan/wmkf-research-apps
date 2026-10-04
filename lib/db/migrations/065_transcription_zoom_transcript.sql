-- Optional Zoom WebVTT transcript retained for the life of a Meeting Tracker
-- transcription job, plus a post-ready speaker-alignment status marker.
ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS zoom_transcript_pathname TEXT,
  ADD COLUMN IF NOT EXISTS zoom_transcript_cleanup_pathname TEXT,
  ADD COLUMN IF NOT EXISTS zoom_transcript_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS speaker_alignment JSONB;

ALTER TABLE transcription_jobs
  DROP CONSTRAINT IF EXISTS transcription_jobs_purged_content_shape;

ALTER TABLE transcription_jobs
  ADD CONSTRAINT transcription_jobs_purged_content_shape CHECK (
    content_purged_at IS NULL
    OR (audio_pathname IS NULL AND output_pathname IS NULL
        AND diagnostic_pathname IS NULL AND correction_notes IS NULL
        AND original_filename IS NULL AND audio_sha256 IS NULL AND audio_etag IS NULL
        AND zoom_transcript_pathname IS NULL AND speaker_alignment IS NULL)
  );

ALTER TABLE transcription_jobs
  DROP CONSTRAINT IF EXISTS transcription_jobs_speaker_alignment_shape;

ALTER TABLE transcription_jobs
  ADD CONSTRAINT transcription_jobs_speaker_alignment_shape CHECK (
    speaker_alignment IS NULL
    OR (jsonb_typeof(speaker_alignment) = 'object' AND pg_column_size(speaker_alignment) <= 65536)
  );

COMMENT ON COLUMN transcription_jobs.zoom_transcript_pathname IS
  'Live pointer to the private Zoom VTT blob; retained for the life of the job and cleared at purge.';
COMMENT ON COLUMN transcription_jobs.zoom_transcript_cleanup_pathname IS
  'Exact private Zoom VTT blob path to delete at purge; minted server-side at job creation.';
COMMENT ON COLUMN transcription_jobs.zoom_transcript_sha256 IS
  'SHA-256 of the Zoom VTT verified at start and re-verified before speaker alignment.';
COMMENT ON COLUMN transcription_jobs.speaker_alignment IS
  'Bounded speaker-alignment status and result (pending/running/applied/partial/abstained/no_speakers/failed/superseded); cleared at cleanup.';
