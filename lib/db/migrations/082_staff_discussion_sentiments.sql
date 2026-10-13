-- Staff discussion sentiment meter (docs/plans/DELIBERATION_SENTIMENT_PLAN_2026-10-13.md, 4.4):
-- staff_discussion_sentiments, one row per analysis run over a request's Staff Discussion Transcript.
-- A 'generating' row is inserted before the provider call. The validated record is kept only on 'ready' rows.
-- A run is current while its source artifact id, source content hash and prompt version match the request's
-- currently bound transcript and the currently published prompt; that is decided in code, not stored.
-- At most one row per request is accepted and not withdrawn. No retention policy (owner decision): no expiry column.
-- Content-free except `record`: ids, hashes, a version, a status and a failure code.
-- Inert until the sentiment service ships; nothing reads or writes this table before then.
CREATE TABLE IF NOT EXISTS staff_discussion_sentiments (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  source_artifact_id UUID NOT NULL,
  source_content_hash TEXT NOT NULL CHECK (source_content_hash ~ '^[0-9a-f]{64}$'),
  prompt_name TEXT,
  prompt_version INTEGER CHECK (prompt_version IS NULL OR prompt_version > 0),
  model TEXT,
  status TEXT NOT NULL CHECK (status IN ('generating','ready','failed')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$'),
  record JSONB,
  requested_by_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  accepted_by_profile_id INTEGER REFERENCES user_profiles(id),
  accepted_at TIMESTAMPTZ,
  withdrawn_by_profile_id INTEGER REFERENCES user_profiles(id),
  withdrawn_at TIMESTAMPTZ,
  CONSTRAINT staff_discussion_sentiments_ready_shape CHECK (
    status <> 'ready' OR (record IS NOT NULL AND prompt_version IS NOT NULL AND prompt_name IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT staff_discussion_sentiments_record_only_ready CHECK (record IS NULL OR status = 'ready'),
  CONSTRAINT staff_discussion_sentiments_failed_shape CHECK (
    (status = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT staff_discussion_sentiments_acceptance_shape CHECK (
    (accepted_at IS NULL) = (accepted_by_profile_id IS NULL)
    AND (withdrawn_at IS NULL) = (withdrawn_by_profile_id IS NULL)
    AND (accepted_at IS NULL OR status = 'ready')
    AND (withdrawn_at IS NULL OR accepted_at IS NOT NULL))
);
-- Backstop for the transactional reserve: never two live 'generating' rows for a request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_discussion_sentiments_generating
  ON staff_discussion_sentiments (request_id) WHERE status = 'generating';
-- At most one accepted, not withdrawn row per request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_discussion_sentiments_accepted
  ON staff_discussion_sentiments (request_id) WHERE accepted_at IS NOT NULL AND withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_discussion_sentiments_request
  ON staff_discussion_sentiments (request_id, status, completed_at DESC, id);
COMMENT ON TABLE staff_discussion_sentiments IS 'One row per staff discussion sentiment analysis run. The validated DeliberationSentiment record is stored only on ready rows. Currentness (source artifact, content hash, prompt version) is decided in code. At most one accepted, not withdrawn row per request.';
COMMENT ON COLUMN staff_discussion_sentiments.source_artifact_id IS 'The Staff Discussion Transcript request-document id that was analyzed.';
COMMENT ON COLUMN staff_discussion_sentiments.prompt_version IS 'Version of the published sentiment prompt that produced the record; set when the run completes. A row is out of date when it differs from the currently published version.';
COMMENT ON COLUMN staff_discussion_sentiments.record IS 'The validated DeliberationSentiment v1 record, with server-derived speaker fields. Ready rows only.';
COMMENT ON COLUMN staff_discussion_sentiments.requested_by_profile_id IS 'Actor from authenticated context only.';
