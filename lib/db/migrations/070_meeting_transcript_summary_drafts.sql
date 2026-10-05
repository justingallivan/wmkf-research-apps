-- Site Visit summary drafts (docs/plans/SITE_VISIT_SUMMARIES_AND_BOARD_SHARING_PLAN_2026-10-04.md
-- §4.3, §6, §16). One row per "Summarize" run. The row records the summarization
-- acknowledgment (actor, time, disclosure version) before any provider call, so
-- the record survives a failed call. Generated summary text lives here only while
-- the draft is 'ready' for a program coordinator to review and edit, and while a
-- publish holds it ('publishing': claimed atomically before any SharePoint or
-- Dataverse write, so edit, discard, and a new run cannot change what is being
-- published); publishing, discarding, superseding, or expiring the draft clears
-- the text and keeps the metadata. The published text lives in governed SharePoint, registered as a
-- Transcript Summary request-document row. Stage 3 extends artifact_type with
-- 100000010 (Staff Discussion Summary).
CREATE TABLE IF NOT EXISTS meeting_transcript_summary_drafts (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  artifact_type INTEGER NOT NULL,
  state TEXT NOT NULL,
  source_revision_id UUID NOT NULL,
  presentation_end_ms BIGINT NOT NULL,
  source_artifact_id UUID NOT NULL,
  summary_text TEXT,
  text_edited BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_name TEXT,
  prompt_version INTEGER,
  prompt_id UUID,
  ai_run_id UUID,
  failure_code TEXT,
  published_artifact_id UUID,
  publish_claimed_at TIMESTAMPTZ,
  acknowledgment_version TEXT NOT NULL,
  acknowledged_by_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  acknowledged_at TIMESTAMPTZ NOT NULL,
  updated_by_profile_id INTEGER REFERENCES user_profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT meeting_transcript_summary_drafts_artifact_type_check
    CHECK (artifact_type IN (100000007)),
  CONSTRAINT meeting_transcript_summary_drafts_state_check
    CHECK (state IN ('generating', 'ready', 'publishing', 'failed', 'published', 'discarded', 'superseded', 'expired')),
  CONSTRAINT meeting_transcript_summary_drafts_text_only_when_ready
    CHECK (summary_text IS NULL OR state IN ('ready', 'publishing')),
  CONSTRAINT meeting_transcript_summary_drafts_publishing_has_text
    CHECK (state <> 'publishing' OR (summary_text IS NOT NULL AND publish_claimed_at IS NOT NULL)),
  CONSTRAINT meeting_transcript_summary_drafts_text_size
    CHECK (summary_text IS NULL OR char_length(summary_text) BETWEEN 1 AND 100000),
  CONSTRAINT meeting_transcript_summary_drafts_end_nonnegative
    CHECK (presentation_end_ms >= 0),
  CONSTRAINT meeting_transcript_summary_drafts_published_shape
    CHECK ((state = 'published') = (published_artifact_id IS NOT NULL))
);

-- At most one active (generating, ready, or publishing) draft per request and summary type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_transcript_summary_drafts_one_active
  ON meeting_transcript_summary_drafts (request_id, artifact_type)
  WHERE state IN ('generating', 'ready', 'publishing');

CREATE INDEX IF NOT EXISTS idx_meeting_transcript_summary_drafts_expiry
  ON meeting_transcript_summary_drafts (expires_at)
  WHERE state IN ('generating', 'ready', 'publishing');

COMMENT ON TABLE meeting_transcript_summary_drafts IS
  'Site Visit summary drafts and their summarization acknowledgments; generated text is held only while state is ready or publishing, published text lives in governed SharePoint.';
