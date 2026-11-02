-- Managed Retraction Watch reference data. Publish metadata and corpus changes
-- in the same transaction. No historical screening/review rows are rewritten.
-- Official CSV inspected 2026-11-02: publisher reaches 500 characters and
-- subject 263; the old importer used VARCHAR(255) and swallowed width errors.
SET LOCAL lock_timeout = '5s';
ALTER TABLE retractions ALTER COLUMN publisher TYPE TEXT;
ALTER TABLE retractions ALTER COLUMN subject TYPE TEXT;
CREATE TABLE IF NOT EXISTS retraction_dataset (
 singleton_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
 generation BIGINT NOT NULL CHECK (generation > 0),
 source_url TEXT NOT NULL,
 source_checksum TEXT NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
 source_revision TEXT,
 published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 row_count INTEGER NOT NULL CHECK (row_count > 0),
 source_row_count INTEGER NOT NULL CHECK (source_row_count > 0),
 retained_records JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(retained_records) = 'array'),
 CHECK (row_count = source_row_count + jsonb_array_length(retained_records)),
 format_version INTEGER NOT NULL CHECK (format_version = 1)
);
