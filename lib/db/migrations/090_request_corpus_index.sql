-- Research request file corpus: metadata index (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md).
-- Derived and rebuildable from SharePoint and Dataverse; no route reads it. Filenames can name people.
CREATE TABLE IF NOT EXISTS request_corpus_runs (
  run_id UUID PRIMARY KEY,
  scope JSONB NOT NULL,
  rules_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  requests_ok INTEGER NOT NULL DEFAULT 0,
  requests_error INTEGER NOT NULL DEFAULT 0,
  files_seen INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS request_corpus_requests (
  request_id UUID PRIMARY KEY,
  request_num TEXT NOT NULL,
  program TEXT NOT NULL,
  meeting_date DATE,
  created_on TIMESTAMPTZ,
  status TEXT,
  is_test BOOLEAN NOT NULL,
  era SMALLINT NOT NULL CHECK (era BETWEEN 1 AND 4),
  listing_status TEXT NOT NULL CHECK (listing_status IN ('ok', 'error')),
  listing_error TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  last_listed_at TIMESTAMPTZ NOT NULL,
  last_run_id UUID NOT NULL REFERENCES request_corpus_runs(run_id)
);

CREATE TABLE IF NOT EXISTS request_corpus_files (
  drive_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  request_id UUID NOT NULL REFERENCES request_corpus_requests(request_id),
  library TEXT NOT NULL,
  source TEXT NOT NULL,
  subfolder TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  extension TEXT NOT NULL DEFAULT '',
  size BIGINT,
  last_modified TIMESTAMPTZ,
  mime_type TEXT,
  doc_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('read', 'already-legible', 'type-only', 'uncertain', 'deferred')),
  classified_by TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  phase TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  last_run_id UUID NOT NULL REFERENCES request_corpus_runs(run_id),
  PRIMARY KEY (drive_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_request_corpus_files_request ON request_corpus_files(request_id);
CREATE INDEX IF NOT EXISTS idx_request_corpus_files_type ON request_corpus_files(doc_type, priority) WHERE removed_at IS NULL;

COMMENT ON TABLE request_corpus_runs IS 'Research request file corpus load runs: scope, filename-rules version, counts and per-request errors.';
COMMENT ON TABLE request_corpus_requests IS 'Research requests listed for the file corpus; a listing error keeps the request''s existing file rows.';
COMMENT ON TABLE request_corpus_files IS 'Research request SharePoint file metadata keyed by Graph drive and item id; files absent from a successful re-listing get removed_at, never deleted. Filenames can name people; admin use only.';
