-- Scheduled email Part A (docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md, A5).
-- recipient_generation versions the Dynamics correlation key so a PD-handoff
-- rebuild can never adopt a draft created for an earlier generation of the
-- same row. Generation 0 keeps today's key (`wmkf-scheduled-recipient:<id>`)
-- so rows created before this migration still recover; later generations use
-- `wmkf-scheduled-recipient:<id>:g<n>`. Additive and re-runnable.

ALTER TABLE scheduled_email_messages
  ADD COLUMN IF NOT EXISTS recipient_generation INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheduled_email_messages.recipient_generation IS
  'Incremented by each PD-handoff rebuild; selects the Dynamics correlation key so an older generation''s draft is never adopted (generation 0 keeps the original key).';
