-- Link workbench integrity runs to their Dataverse request while preserving
-- existing standalone/manual screening history.
ALTER TABLE integrity_screenings
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS idx_integrity_screenings_request_latest
  ON integrity_screenings (request_id, created_at DESC, id DESC)
  WHERE request_id IS NOT NULL;
