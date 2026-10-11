-- Additive attendance decision state. Owner applies before runtime merge; no backfill.
ALTER TABLE meeting_transcript_publications
  ADD COLUMN IF NOT EXISTS attendance_review JSONB,
  ADD COLUMN IF NOT EXISTS discussion_attribution JSONB,
  ADD COLUMN IF NOT EXISTS frozen_discussion_attribution JSONB;
DO $$ BEGIN
  ALTER TABLE meeting_transcript_publications ADD CONSTRAINT meeting_transcript_publications_attendance_shape CHECK (
    (attendance_review IS NULL OR (jsonb_typeof(attendance_review) = 'object' AND pg_column_size(attendance_review) <= 524288))
    AND (discussion_attribution IS NULL OR (jsonb_typeof(discussion_attribution) = 'object' AND discussion_attribution->>'version' IS NOT DISTINCT FROM '1' AND pg_column_size(discussion_attribution) <= 524288))
    AND (frozen_discussion_attribution IS NULL OR (jsonb_typeof(frozen_discussion_attribution) = 'object' AND frozen_discussion_attribution->>'version' IS NOT DISTINCT FROM '1' AND pg_column_size(frozen_discussion_attribution) <= 524288))
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMENT ON COLUMN meeting_transcript_publications.attendance_review IS 'Temporary version-bound checklist; no report rows, emails or Zoom IDs. Cleared on publication, expiry or close.';
COMMENT ON COLUMN meeting_transcript_publications.discussion_attribution IS 'Confirmed draft decision only. Cleared when boundary/names change, on expiry or publication.';
COMMENT ON COLUMN meeting_transcript_publications.frozen_discussion_attribution IS 'Frozen v7 decision for recovery, retained with full transcript until Stage 5 deletion; never copied to content-free source provenance or video lineage.';
