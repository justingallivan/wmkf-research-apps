-- Owner-editable display labels overlay verified speaker IDs without changing
-- the canonical provider transcript stored in private Blob.
ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS speaker_names JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE transcription_jobs
  DROP CONSTRAINT IF EXISTS transcription_jobs_speaker_names_shape;

ALTER TABLE transcription_jobs
  ADD CONSTRAINT transcription_jobs_speaker_names_shape
  CHECK (jsonb_typeof(speaker_names) = 'object' AND pg_column_size(speaker_names) <= 65536);

COMMENT ON COLUMN transcription_jobs.speaker_names IS
  'Owner-editable bounded display-name overlay keyed by verified provider speaker IDs; redacted on content block and cleared at cleanup.';
