-- Which applicant slide PDF a presentation summary run picked, so staff can be
-- told when the slides were replaced after the summary was made
-- (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.5).
-- slides_recorded is false for rows written before this migration (unknown),
-- and true for every later run: then both identity columns are set when a
-- slide PDF was picked, or both are NULL when none was on file.
ALTER TABLE meeting_transcript_summary_drafts
  ADD COLUMN IF NOT EXISTS slides_recorded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slides_artifact_id UUID,
  ADD COLUMN IF NOT EXISTS slides_content_hash CHAR(64);

ALTER TABLE meeting_transcript_summary_drafts
  DROP CONSTRAINT IF EXISTS meeting_transcript_summary_drafts_slides_identity_check;
ALTER TABLE meeting_transcript_summary_drafts
  ADD CONSTRAINT meeting_transcript_summary_drafts_slides_identity_check CHECK (
    (slides_artifact_id IS NULL AND slides_content_hash IS NULL)
    OR (slides_recorded AND slides_artifact_id IS NOT NULL
        AND slides_content_hash IS NOT NULL AND slides_content_hash ~ '^[0-9a-f]{64}$')
  );
