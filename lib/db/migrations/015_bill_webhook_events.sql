-- Migration 015: BILL.com webhook event dedup
--
-- BILL retries failed webhook deliveries with exponential backoff and provides
-- no documented replay protection. We dedup on the compound key
-- (subscription_id, event_id) — defensive against the eventId-uniqueness scope
-- not being formally guaranteed by BILL across subscriptions.
--
-- Daily maintenance deletes rows older than 7 days (comfortably exceeds any
-- plausible BILL retry horizon).
--
-- See docs/BILL_LIB_DESIGN.md (v3) for the dedup gate design.

CREATE TABLE IF NOT EXISTS bill_webhook_events (
  id SERIAL PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_bill_webhook_events_received_at
  ON bill_webhook_events (received_at);
