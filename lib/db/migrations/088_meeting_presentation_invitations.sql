-- Request/visit-scoped frozen invitation email, independent of session agenda mail.
CREATE TABLE IF NOT EXISTS meeting_presentation_invitations (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_id UUID NOT NULL,
  actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
  acting_user_system_id UUID NOT NULL,
  from_email TEXT NOT NULL CHECK (length(from_email) <= 320),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  email_hash TEXT NOT NULL CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  envelope_hash TEXT NOT NULL CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  email_verified_at TIMESTAMPTZ,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 32768),
  subject TEXT NOT NULL CHECK (length(subject) <= 320),
  body_text TEXT NOT NULL CHECK (length(body_text) <= 16384),
  body_html TEXT NOT NULL CHECK (length(body_html) <= 65536),
  to_recipients JSONB NOT NULL CHECK (jsonb_typeof(to_recipients) = 'array' AND jsonb_array_length(to_recipients) <= 100),
  cc_recipients JSONB NOT NULL CHECK (jsonb_typeof(cc_recipients) = 'array' AND jsonb_array_length(cc_recipients) <= 100),
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','creating','activity_created','send_requested','unknown','sent','failed')),
  dynamics_email_id UUID,
  failure_code TEXT CHECK (length(failure_code) <= 100),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  preview_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  redacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_presentation_invitation_activity CHECK ((state NOT IN ('activity_created','send_requested','sent') OR dynamics_email_id IS NOT NULL) AND (state NOT IN ('send_requested','sent') OR email_verified_at IS NOT NULL)),
  CONSTRAINT meeting_presentation_invitation_redaction CHECK (redacted_at IS NULL OR (snapshot='{}'::jsonb AND subject='' AND body_text='' AND body_html='' AND from_email='' AND to_recipients='[]'::jsonb AND cc_recipients='[]'::jsonb)),
  CONSTRAINT meeting_presentation_invitation_lease CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CONSTRAINT meeting_presentation_invitation_recipients CHECK (redacted_at IS NOT NULL OR jsonb_array_length(to_recipients) + jsonb_array_length(cc_recipients) > 0)
);
CREATE INDEX IF NOT EXISTS meeting_presentation_invitation_history ON meeting_presentation_invitations(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_presentation_invitation_preview_expiry ON meeting_presentation_invitations(preview_expires_at) WHERE state='prepared';
CREATE INDEX IF NOT EXISTS meeting_presentation_invitation_retention ON meeting_presentation_invitations(retention_expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_presentation_invitation_unresolved ON meeting_presentation_invitations(request_id)
  WHERE state IN ('creating','activity_created','send_requested','unknown');
COMMENT ON TABLE meeting_presentation_invitations IS 'Frozen research-presentation email previews and durable, fail-closed transport uncertainty; never a calendar event.';
