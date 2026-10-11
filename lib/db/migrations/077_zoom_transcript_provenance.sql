-- Transcript source provenance, captured before dispatch and frozen per publication.
-- Additive only. Legacy rows remain NULL; no inferred backfill or content retention.
ALTER TABLE zoom_recording_imports
  ADD COLUMN IF NOT EXISTS selected_recording_files JSONB;
ALTER TABLE meeting_transcript_publications
  ADD COLUMN IF NOT EXISTS frozen_source_provenance JSONB;

DO $$ BEGIN
  ALTER TABLE zoom_recording_imports
    ADD CONSTRAINT zoom_recording_imports_capture_shape CHECK (
      selected_recording_files IS NULL OR (
        jsonb_typeof(selected_recording_files) = 'object'
        AND (selected_recording_files->>'version') IS NOT DISTINCT FROM '1'
        AND pg_column_size(selected_recording_files) <= 8192
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE meeting_transcript_publications
    ADD CONSTRAINT meeting_transcript_publications_provenance_shape CHECK (
      frozen_source_provenance IS NULL OR (
        jsonb_typeof(frozen_source_provenance) = 'object'
        AND (frozen_source_provenance->>'version') IS NOT DISTINCT FROM '1'
        AND pg_column_size(frozen_source_provenance) <= 8192
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN zoom_recording_imports.selected_recording_files IS
  'Write-once under live import lease before dispatch: downloaded audio/VTT identities, hashes and observed audio-only file count; no URLs or content. NULL for legacy imports.';
COMMENT ON COLUMN meeting_transcript_publications.frozen_source_provenance IS
  'Content-free source identity frozen with publication and carried through corrections/recovery, independent of transient jobs. NULL means legacy/unknown; never inferred from latest import.';
