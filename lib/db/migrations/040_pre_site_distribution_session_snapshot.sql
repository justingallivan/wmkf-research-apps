-- Share email carries the deliberation session (PC Meeting Tracker plan §5.6,
-- owner 2026-09-09/10). The prepared preview snapshots the request's latest
-- deliberation slot (session id, start/end, time zone, meeting link) so the
-- email body, the draft hash, and the preview hash all bind to it, and send
-- rechecks the live slot against this snapshot (distribution_session_stale)
-- the way it rechecks the site-visit calendar. NULL = no slot at preview time
-- ("not yet scheduled" in the email).
ALTER TABLE pre_site_distribution_attempts
  ADD COLUMN IF NOT EXISTS session_snapshot JSONB;
ALTER TABLE pre_site_distribution_attempts
  DROP CONSTRAINT IF EXISTS pre_site_distribution_session_shape;
ALTER TABLE pre_site_distribution_attempts
  ADD CONSTRAINT pre_site_distribution_session_shape CHECK (
    session_snapshot IS NULL OR jsonb_typeof(session_snapshot) = 'object'
  );
