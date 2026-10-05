-- Site Visit summaries and Board sharing, Stage 1
-- (docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md §4.1, §4.7).
--
-- 1. The shared post-presentation slot lease and upload tables admit the three
--    planned artifact types: Staff Discussion Summary (100000010), Board
--    Presentation Recording (100000011), and Presentation Transcript
--    (100000012). Only 100000012 is wired by Stage 1; the picklist values for
--    the other two arrive with their stages. The original constraints are the
--    named table CHECKs from 055.
-- 2. The transcript publication receipt freezes the confirmed presentation
--    end (boundary) before uploads start, so recovery can rebuild a version-4
--    bundle without trusting the manifest alone. All three columns are set
--    together or all null.
ALTER TABLE presentation_material_uploads
  DROP CONSTRAINT IF EXISTS presentation_material_uploads_artifact_type_check;
ALTER TABLE presentation_material_uploads
  ADD CONSTRAINT presentation_material_uploads_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012)
  );
ALTER TABLE presentation_material_slot_leases
  DROP CONSTRAINT IF EXISTS presentation_material_slot_leases_artifact_type_check;
ALTER TABLE presentation_material_slot_leases
  ADD CONSTRAINT presentation_material_slot_leases_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007, 100000010, 100000011, 100000012)
  );
ALTER TABLE meeting_transcript_publications
  ADD COLUMN IF NOT EXISTS presentation_end_ms INTEGER,
  ADD COLUMN IF NOT EXISTS presentation_end_confirmed_by INTEGER REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS presentation_end_confirmed_at TIMESTAMPTZ;
ALTER TABLE meeting_transcript_publications
  DROP CONSTRAINT IF EXISTS meeting_transcript_publications_presentation_end_shape;
ALTER TABLE meeting_transcript_publications
  ADD CONSTRAINT meeting_transcript_publications_presentation_end_shape CHECK (
    (presentation_end_ms IS NULL AND presentation_end_confirmed_by IS NULL AND presentation_end_confirmed_at IS NULL)
    OR (presentation_end_ms >= 0 AND presentation_end_confirmed_by IS NOT NULL AND presentation_end_confirmed_at IS NOT NULL)
  );
