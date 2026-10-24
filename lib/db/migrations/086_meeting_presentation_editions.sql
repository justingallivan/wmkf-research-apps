-- Versioned coordinator approval. Apply before deploying the edition readers.
-- Allocation checked against 355 refs and owner-authorized tracker filenames 2026-10-23.
CREATE TABLE meeting_presentation_visibility (
  request_id UUID PRIMARY KEY,
  active_edition_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483646),
  enrolled_by INTEGER NOT NULL REFERENCES user_profiles(id),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by INTEGER NOT NULL REFERENCES user_profiles(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  CHECK (withdrawn_at IS NULL OR active_edition_id IS NULL)
);
CREATE TABLE meeting_presentation_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES meeting_presentation_visibility(request_id),
  command_id UUID NOT NULL,
  source_revision_id UUID NOT NULL,
  presentation_end_ms BIGINT NOT NULL CHECK (presentation_end_ms >= 0),
  members JSONB NOT NULL CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) = 3 AND octet_length(members::text) <= 16384),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  approved_by INTEGER NOT NULL REFERENCES user_profiles(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, command_id),
  UNIQUE (request_id, id)
);
ALTER TABLE meeting_presentation_visibility ADD CONSTRAINT presentation_visibility_request_edition
  FOREIGN KEY (request_id, active_edition_id) REFERENCES meeting_presentation_editions(request_id, id);
COMMENT ON TABLE meeting_presentation_visibility IS 'Sticky request enrollment and version-fenced visibility pointer. A null edition never authorizes legacy fallback. No tokens, URLs or content.';
COMMENT ON TABLE meeting_presentation_editions IS 'Immutable application-written approval receipts with exactly three content-free presentation file identities. Never staff discussion or full recording. Retain while referenced.';
