-- 026: Durable shadow-comparison log for the reviewer identity runtime seam.
--
-- Writer: lib/services/reviewer-identity-shadow-log.js (best-effort,
-- non-throwing, and awaited with a 2-second cap by the default shadow
-- observers in lib/services/reviewer-identity-runtime.js).
-- Reader: ad-hoc delta reports (legacy_decision IS DISTINCT FROM
-- works_decision) — no application read path.
-- Cleanup: MaintenanceService.cleanupReviewerIdentityShadowLog (daily
-- maintenance cron; retention window plus hard row cap).
--
-- Privacy contract: rows carry NO candidate names, emails, proposal content,
-- provider payloads, or identity anchors. candidate_key is a 16-hex-char
-- truncated SHA-256 of the normalized name|institution pair. It omits raw
-- identity text but remains pseudonymous/dictionary-testable by a roster holder.

CREATE TABLE IF NOT EXISTS reviewer_identity_shadow_log (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT,
  resolver_mode TEXT NOT NULL DEFAULT 'shadow',
  event_type TEXT NOT NULL DEFAULT 'comparison'
    CHECK (event_type IN ('comparison', 'error')),
  candidate_key TEXT,
  legacy_decision TEXT,
  works_decision TEXT,
  combined_decision TEXT,
  combined_reason TEXT,
  anchors_agree BOOLEAN,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_created
  ON reviewer_identity_shadow_log (created_at);

CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_run
  ON reviewer_identity_shadow_log (run_id);

-- Delta-only report support: scan disagreements without touching agreements.
CREATE INDEX IF NOT EXISTS idx_reviewer_identity_shadow_log_delta
  ON reviewer_identity_shadow_log (created_at)
  WHERE legacy_decision IS DISTINCT FROM works_decision;
