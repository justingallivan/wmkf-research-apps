-- Exact-email and cross-system recovery ledger for one deliberation-session
-- agenda send. Dataverse owns the session and Dynamics owns transport; this
-- row freezes the agenda and coordinates retries without storing attachments.

CREATE TABLE IF NOT EXISTS deliberation_agenda_sends (
  operation_id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  agenda_snapshot JSONB NOT NULL,
  to_recipients JSONB NOT NULL,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  from_email TEXT NOT NULL,
  acting_user_system_id UUID,
  state TEXT NOT NULL DEFAULT 'prepared',
  dynamics_email_id UUID,
  dynamics_statecode INTEGER,
  dynamics_statuscode INTEGER,
  send_requested_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT deliberation_agenda_state_check
    CHECK (state IN ('prepared', 'activity_created', 'send_requested', 'sent', 'failed')),
  CONSTRAINT deliberation_agenda_recipient_shape CHECK (
    jsonb_typeof(to_recipients) = 'array'
    AND jsonb_array_length(to_recipients) > 0
    AND jsonb_typeof(cc_recipients) = 'array'
  ),
  CONSTRAINT deliberation_agenda_lease_shape CHECK (
    (lease_token IS NULL AND locked_until IS NULL)
    OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_deliberation_agenda_session_history
  ON deliberation_agenda_sends (session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_deliberation_agenda_one_unresolved
  ON deliberation_agenda_sends (session_id)
  WHERE state = 'send_requested';

COMMENT ON TABLE deliberation_agenda_sends IS
  'Frozen deliberation-session agenda emails and lease-fenced Dynamics send recovery state.';
COMMENT ON COLUMN deliberation_agenda_sends.sent_at IS
  'When Dynamics readback proved Pending Send, Sending, or Sent; not proof of inbox delivery.';
