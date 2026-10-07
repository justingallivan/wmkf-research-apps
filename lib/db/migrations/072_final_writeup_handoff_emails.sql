-- Group-review handoff email ledger (Final Writeup group-review handoff
-- Stage 4). One row per handed-off draft (the Site Visit / Pre-Site source
-- document). The row is the send intent. It is staged by
-- POST /api/workbench/final-writeup BEFORE the transition runs, and only when
-- the request has no current Final yet and its Grant Program is listed in
-- FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS. Writeups already in group review
-- before this shipped therefore never get a row. Delivery waits until the
-- request's current Final is confirmed to come from this draft, so a commit
-- whose response was lost is still emailed by a retry or by recovery.
-- Dataverse owns the documents; Dynamics owns the email activity and transport.

CREATE TABLE IF NOT EXISTS final_writeup_handoff_emails (
  source_document_id UUID PRIMARY KEY,
  final_document_id UUID,
  request_id UUID NOT NULL,
  grant_program_id UUID NOT NULL,
  lead_systemuser_id UUID,
  state TEXT NOT NULL DEFAULT 'pending',
  skip_reason TEXT,
  to_recipients JSONB,
  skipped_recipient_count INTEGER NOT NULL DEFAULT 0,
  dynamics_email_id UUID,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_failed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT final_writeup_handoff_email_state_check
    CHECK (state IN ('pending', 'sent', 'skipped')),
  CONSTRAINT final_writeup_handoff_email_sent_shape CHECK (
    state <> 'sent' OR (
      sent_at IS NOT NULL AND dynamics_email_id IS NOT NULL AND final_document_id IS NOT NULL
    )
  ),
  CONSTRAINT final_writeup_handoff_email_skip_shape CHECK (
    (state = 'skipped') = (skip_reason IS NOT NULL)
  ),
  CONSTRAINT final_writeup_handoff_email_recipient_shape CHECK (
    to_recipients IS NULL OR jsonb_typeof(to_recipients) = 'array'
  ),
  CONSTRAINT final_writeup_handoff_email_lease_shape CHECK (
    (lease_token IS NULL AND locked_until IS NULL)
    OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_final_writeup_handoff_emails_final
  ON final_writeup_handoff_emails (final_document_id)
  WHERE final_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_final_writeup_handoff_emails_pending
  ON final_writeup_handoff_emails (created_at)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_final_writeup_handoff_emails_request
  ON final_writeup_handoff_emails (request_id, created_at DESC);
