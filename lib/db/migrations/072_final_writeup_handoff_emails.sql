-- Group-review handoff email ledger (Final Writeup group-review handoff
-- Stage 4). One row per Final document. The row is the send intent: it is
-- created only by the call that committed the group-review transition, for a
-- Grant Program listed in FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS, so writeups
-- that entered group review before this shipped are never emailed.
-- Dataverse owns the Final document; Dynamics owns the email activity and
-- transport. This row coordinates one send, its retries and its receipt.

CREATE TABLE IF NOT EXISTS final_writeup_handoff_emails (
  final_document_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  grant_program_id UUID NOT NULL,
  lead_systemuser_id UUID,
  state TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  to_recipients JSONB,
  skipped_recipient_count INTEGER NOT NULL DEFAULT 0,
  dynamics_email_id UUID,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_failed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT final_writeup_handoff_email_state_check
    CHECK (state IN ('pending', 'sent', 'skipped')),
  CONSTRAINT final_writeup_handoff_email_sent_shape CHECK (
    state <> 'sent' OR (sent_at IS NOT NULL AND dynamics_email_id IS NOT NULL)
  ),
  CONSTRAINT final_writeup_handoff_email_skip_shape CHECK (
    (state = 'skipped') = (skip_reason IS NOT NULL)
  ),
  CONSTRAINT final_writeup_handoff_email_recipient_shape CHECK (
    to_recipients IS NULL OR jsonb_typeof(to_recipients) = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_final_writeup_handoff_emails_pending
  ON final_writeup_handoff_emails (created_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_final_writeup_handoff_emails_request
  ON final_writeup_handoff_emails (request_id, created_at DESC);
