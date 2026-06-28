-- Migration 010: external-reviewer rate limiting (security audit A6)
--
-- Fixed-window counters backing rate limiting for the public token routes
-- /api/external/review/[token]/* . Two bucket scopes share the table,
-- discriminated by the bucket_key prefix:
--   'tok:<sha256(jwt)>'  — per-token bucket
--   'ip:<addr>'          — per-IP bucket
--
-- hit_count     — all requests in the window (drives the 429 limit)
-- invalid_count — subset of per-IP requests whose token failed verification
--                 (drives the invalid-token-spike system_alerts entry)
--
-- Postgres-backed (not in-memory): Vercel Fluid Compute spreads requests
-- across instances, so per-instance memory buckets do not enforce a real
-- shared limit. See docs/archive/SECURITY_AUDIT_2026-05-21.md.

CREATE TABLE IF NOT EXISTS external_rate_limit (
  bucket_key    TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Supports opportunistic pruning of expired windows.
CREATE INDEX IF NOT EXISTS idx_external_rate_limit_window
  ON external_rate_limit(window_start);
