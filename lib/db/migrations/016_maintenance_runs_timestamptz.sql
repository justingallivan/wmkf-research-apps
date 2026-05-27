-- Migration 016: maintenance_runs timestamp columns → timestamptz
--
-- started_at and completed_at were created as `timestamp without time zone`.
-- The CURRENT_TIMESTAMP DEFAULT and the application code that uses them all
-- assume UTC, so the stored values ARE UTC — but the pg driver, when reading
-- a timestamp-without-tz column into a JS Date, interprets the wall-clock
-- numbers as local-time on the reading machine. The result: operators in
-- non-UTC timezones see times shifted by their local UTC offset in the
-- /admin maintenance dashboard.
--
-- Fix: convert both columns to timestamptz, interpreting existing stored
-- values as UTC (which is what they already are). This is a metadata-only
-- conversion — no data is rewritten, just the type tag.
--
-- Discovered S192 while investigating a maintenance-cron failure; the
-- timezone confusion almost masked the real bug (missing migration 015).

BEGIN;

ALTER TABLE maintenance_runs
  ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC';

-- The DEFAULT clause survives an ALTER COLUMN TYPE in current Postgres, but
-- restate it explicitly for clarity. CURRENT_TIMESTAMP is timestamptz-typed,
-- so this is a no-op against the new column type.
ALTER TABLE maintenance_runs
  ALTER COLUMN started_at SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
