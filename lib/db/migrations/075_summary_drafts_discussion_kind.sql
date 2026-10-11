-- Staff Discussion Summary (artifact type 100000010) drafts share
-- meeting_transcript_summary_drafts with the presentation summary
-- (docs/plans/PAIRED_SUMMARIES_PLAN_2026-10-08.md, D7). Re-declares the CHECK
-- set by 070; the (request_id, artifact_type) partial unique index already
-- allows one active draft per kind, and the slot-lease and upload CHECKs
-- already admit 100000010 (069).
ALTER TABLE meeting_transcript_summary_drafts
  DROP CONSTRAINT IF EXISTS meeting_transcript_summary_drafts_artifact_type_check;
ALTER TABLE meeting_transcript_summary_drafts
  ADD CONSTRAINT meeting_transcript_summary_drafts_artifact_type_check
    CHECK (artifact_type IN (100000007, 100000010));
