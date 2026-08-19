-- Migration 030: operational_events — durable operational observability.
--
-- One row per structured operational event, from two sources:
--   * 'app'          — application-recorded failures/recoveries captured at the
--                      seam with the best context (request number, entity refs,
--                      stage, retryability), mirrored from NotificationService
--                      or recorded explicitly.
--   * 'vercel-drain' — selected runtime log entries delivered by the Vercel
--                      Log Drain to /api/webhooks/vercel-log-drain, retained in
--                      Postgres beyond Vercel's short log-retention window.
--
-- NOT stored here: secrets, authorization headers, tokens, request bodies,
-- uploaded file contents, raw email addresses, client IPs, or user agents.
-- Summaries pass through lib/utils/log-redactor.js and metadata passes the
-- allowlist/size caps in lib/services/operational-event-service.js.
--
-- Dedup/idempotency:
--   * Drain deliveries are at-least-once; each entry carries Vercel's stable
--     log id, stored as dedupe_key 'vercel:<id>' with ON CONFLICT DO NOTHING.
--   * App events use a caller-stable dedupe_key (autoResolveKey shape); a
--     repeat occurrence folds into the same row (occurrence_count increments,
--     last_occurred_at advances, a recovered/resolved row reopens).
--
-- Retention: daily maintenance cron deletes settled (non-open) rows past
-- retention:operational_events_days (default 90), open rows past twice that
-- window, and enforces a hard row cap. See MaintenanceService.
--
-- Fresh installs create this table via scripts/setup-database.js (v38 block);
-- existing databases apply this migration via scripts/apply-migrations.js.

CREATE TABLE IF NOT EXISTS operational_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL
    CONSTRAINT operational_events_source_check
    CHECK (source IN ('app', 'vercel-drain')),
  environment TEXT,
  event_type TEXT NOT NULL,
  subsystem TEXT,
  severity TEXT NOT NULL
    CONSTRAINT operational_events_severity_check
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CONSTRAINT operational_events_status_check
    CHECK (status IN ('open', 'recovered', 'resolved', 'superseded', 'info')),
  summary TEXT NOT NULL,
  stage TEXT,
  transient BOOLEAN,
  request_number TEXT,
  entity_refs JSONB,
  correlation_id TEXT,
  recovery_key TEXT,
  dedupe_key TEXT,
  metadata JSONB,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES user_profiles(id),
  resolution_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_events_dedupe
  ON operational_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_events_last_occurred
  ON operational_events (last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_events_status_severity
  ON operational_events (status, severity);
CREATE INDEX IF NOT EXISTS idx_operational_events_event_type
  ON operational_events (event_type);
CREATE INDEX IF NOT EXISTS idx_operational_events_request_number
  ON operational_events (request_number) WHERE request_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_events_recovery_open
  ON operational_events (recovery_key) WHERE recovery_key IS NOT NULL AND status = 'open';
CREATE INDEX IF NOT EXISTS idx_operational_events_correlation
  ON operational_events (correlation_id) WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE operational_events IS
  'Durable structured operational events (app-recorded failures/recoveries + selected Vercel Log Drain entries). Sanitized: no secrets, tokens, bodies, raw emails, IPs, or user agents.';
COMMENT ON COLUMN operational_events.dedupe_key IS
  'Stable identity for idempotent writes: vercel:<log id> for drain rows; autoResolveKey-shaped fingerprint for app rows (repeat occurrence folds/reopens the row).';
COMMENT ON COLUMN operational_events.recovery_key IS
  'Key a later success signal uses to mark open rows recovered (markRecovered). Same shape as system_alerts.auto_resolve_key.';
COMMENT ON COLUMN operational_events.status IS
  'open = unresolved failure; recovered = system observed later success; resolved = staff closed it; superseded = no longer applicable (e.g. job cancelled); info = not a failure, no resolution needed.';
COMMENT ON COLUMN operational_events.transient IS
  'Retryability where known (structured service errors carry isTransient). NULL = unknown.';
