-- One row per reviewer reminder recorded (respond nudge or review-due reminder),
-- so the Activity history drawer can show each reminder with its own date.
-- The reviewer suggestion in Dataverse keeps only the latest stamp and a count.
-- Rows are written only for invited suggestions, which are never reset, so a
-- row always belongs to the suggestion's single engagement.
-- Plan: docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md
CREATE TABLE IF NOT EXISTS reviewer_reminder_events (
 id BIGSERIAL PRIMARY KEY,
 suggestion_id UUID NOT NULL,
 request_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('respond', 'review_due')),
 recorded_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (suggestion_id, kind, recorded_at)
);
CREATE INDEX IF NOT EXISTS reviewer_reminder_events_suggestion
 ON reviewer_reminder_events (suggestion_id);
