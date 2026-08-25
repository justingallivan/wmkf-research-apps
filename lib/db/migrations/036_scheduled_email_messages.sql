-- Durable review/send ledger for personalized automated email.
-- The first workflow is the grantee abstract reminder. Dataverse remains the
-- grantee-deliverable lifecycle source; Dynamics owns the email activity; this
-- row owns the PD review window, exact editable draft, and send recovery.

CREATE TABLE IF NOT EXISTS scheduled_email_messages (
  id UUID PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  source_record_id UUID NOT NULL,
  request_id UUID NOT NULL,
  deliverable_id UUID NOT NULL,

  pd_systemuser_id UUID NOT NULL,
  pd_name TEXT NOT NULL,
  pd_email TEXT NOT NULL,
  to_recipients JSONB NOT NULL,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_name TEXT NOT NULL,

  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  signature_text TEXT NOT NULL,
  scheduled_send_at TIMESTAMPTZ NOT NULL,
  review_available_at TIMESTAMPTZ NOT NULL,
  review_lead_days INTEGER,

  status TEXT NOT NULL DEFAULT 'scheduled',
  version INTEGER NOT NULL DEFAULT 1,
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  edited_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  actioned_by_profile_id BIGINT,

  notification_email_id UUID,
  notified_at TIMESTAMPTZ,
  notification_lease_token UUID,
  notification_locked_until TIMESTAMPTZ,
  notification_error TEXT,

  dynamics_email_id UUID,
  dynamics_statecode INTEGER,
  dynamics_statuscode INTEGER,
  dynamics_senton TIMESTAMPTZ,
  send_requested_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  last_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scheduled_email_workflow_check
    CHECK (workflow_type IN ('grantee_abstract_reminder')),
  CONSTRAINT scheduled_email_status_check
    CHECK (status IN ('scheduled', 'sending', 'sent', 'stopped', 'failed')),
  CONSTRAINT scheduled_email_recipient_shape CHECK (
    jsonb_typeof(to_recipients) = 'array'
    AND jsonb_array_length(to_recipients) > 0
    AND jsonb_typeof(cc_recipients) = 'array'
  ),
  CONSTRAINT scheduled_email_review_days_check
    CHECK (review_lead_days IS NULL OR review_lead_days BETWEEN 1 AND 14),
  CONSTRAINT scheduled_email_review_time_check
    CHECK (review_available_at <= scheduled_send_at),
  CONSTRAINT scheduled_email_version_check CHECK (version >= 1),
  CONSTRAINT scheduled_email_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT scheduled_email_lease_shape CHECK (
    (lease_token IS NULL AND locked_until IS NULL)
    OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
  ),
  CONSTRAINT scheduled_email_notification_lease_shape CHECK (
    (notification_lease_token IS NULL AND notification_locked_until IS NULL)
    OR (notification_lease_token IS NOT NULL AND notification_locked_until IS NOT NULL)
  ),
  CONSTRAINT scheduled_email_sent_shape CHECK (
    (status = 'sent' AND dynamics_email_id IS NOT NULL
      AND send_requested_at IS NOT NULL AND sent_at IS NOT NULL)
    OR status <> 'sent'
  ),
  CONSTRAINT scheduled_email_stopped_shape CHECK (
    (status = 'stopped' AND stopped_at IS NOT NULL)
    OR status <> 'stopped'
  ),
  CONSTRAINT scheduled_email_source_unique UNIQUE (workflow_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_email_pd_history
  ON scheduled_email_messages (pd_systemuser_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_email_review_notice
  ON scheduled_email_messages (review_available_at, notification_locked_until)
  WHERE status = 'scheduled' AND notified_at IS NULL AND review_lead_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_email_due_send
  ON scheduled_email_messages (scheduled_send_at, locked_until)
  WHERE status IN ('scheduled', 'failed', 'sending');
CREATE INDEX IF NOT EXISTS idx_scheduled_email_finalize
  ON scheduled_email_messages (sent_at, finalized_at)
  WHERE status = 'sent' AND finalized_at IS NULL;

COMMENT ON TABLE scheduled_email_messages IS
  'PD review-window and cross-system recovery ledger for personalized automated email; Dynamics owns transport and Dataverse owns workflow lifecycle.';
COMMENT ON COLUMN scheduled_email_messages.sent_at IS
  'Dynamics accepted the SendEmail transport request (or readback proved an accepted status); not proof of inbox delivery.';
