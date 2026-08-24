-- Durable orchestration ledger for frozen Pre-Site Word/PDF email distribution.
-- SharePoint + wmkf_requestdocument own retained file identity; Dynamics owns
-- the email activity. This row coordinates exact preview binding and recovery
-- across those systems without storing attachment bytes.

CREATE TABLE IF NOT EXISTS pre_site_distribution_attempts (
  operation_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  source_document_id UUID NOT NULL,
  source_drive_id TEXT,
  source_item_id TEXT,
  source_version_id TEXT,
  source_content_hash TEXT,
  source_byte_hash CHAR(64),
  source_filename TEXT,

  attachment_mode TEXT NOT NULL,
  to_recipients JSONB NOT NULL,
  cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  from_email TEXT NOT NULL,
  acting_user_system_id UUID NOT NULL,
  draft_hash CHAR(64) NOT NULL,
  preview_hash CHAR(64),
  template_version TEXT NOT NULL,

  docx_snapshot_document_id UUID,
  docx_drive_id TEXT,
  docx_item_id TEXT,
  docx_version_id TEXT,
  docx_web_url TEXT,
  docx_filename TEXT,
  docx_content_type TEXT,
  docx_byte_hash CHAR(64),
  docx_size BIGINT,

  pdf_snapshot_document_id UUID,
  pdf_drive_id TEXT,
  pdf_item_id TEXT,
  pdf_version_id TEXT,
  pdf_web_url TEXT,
  pdf_filename TEXT,
  pdf_content_type TEXT,
  pdf_byte_hash CHAR(64),
  pdf_size BIGINT,

  dynamics_email_id UUID,
  dynamics_statecode INTEGER,
  dynamics_statuscode INTEGER,
  dynamics_senton TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'preparing',
  docx_attached_at TIMESTAMPTZ,
  pdf_attached_at TIMESTAMPTZ,
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

  CONSTRAINT pre_site_distribution_mode_check
    CHECK (attachment_mode IN ('docx', 'pdf', 'both')),
  CONSTRAINT pre_site_distribution_state_check
    CHECK (state IN (
      'preparing', 'prepared', 'activity_created', 'attachments_added',
      'send_requested', 'sent'
    )),
  CONSTRAINT pre_site_distribution_recipient_shape CHECK (
    jsonb_typeof(to_recipients) = 'array'
    AND jsonb_array_length(to_recipients) > 0
    AND jsonb_typeof(cc_recipients) = 'array'
  ),
  CONSTRAINT pre_site_distribution_hash_shape CHECK (
    draft_hash ~ '^[0-9a-f]{64}$'
    AND (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$')
    AND (source_byte_hash IS NULL OR source_byte_hash ~ '^[0-9a-f]{64}$')
    AND (docx_byte_hash IS NULL OR docx_byte_hash ~ '^[0-9a-f]{64}$')
    AND (pdf_byte_hash IS NULL OR pdf_byte_hash ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT pre_site_distribution_attempt_count_nonnegative
    CHECK (attempt_count >= 0),
  CONSTRAINT pre_site_distribution_prepared_shape CHECK (
    state = 'preparing'
    OR (
      source_drive_id IS NOT NULL
      AND source_item_id IS NOT NULL
      AND source_version_id IS NOT NULL
      AND source_content_hash IS NOT NULL
      AND source_byte_hash IS NOT NULL
      AND preview_hash IS NOT NULL
      AND docx_snapshot_document_id IS NOT NULL
      AND docx_drive_id IS NOT NULL
      AND docx_item_id IS NOT NULL
      AND docx_version_id IS NOT NULL
      AND docx_filename IS NOT NULL
      AND docx_content_type IS NOT NULL
      AND docx_byte_hash IS NOT NULL
      AND docx_size > 0
      AND (
        attachment_mode = 'docx'
        OR (
          pdf_snapshot_document_id IS NOT NULL
          AND pdf_drive_id IS NOT NULL
          AND pdf_item_id IS NOT NULL
          AND pdf_version_id IS NOT NULL
          AND pdf_filename IS NOT NULL
          AND pdf_content_type IS NOT NULL
          AND pdf_byte_hash IS NOT NULL
          AND pdf_size > 0
        )
      )
    )
  ),
  CONSTRAINT pre_site_distribution_lease_shape CHECK (
    (lease_token IS NULL AND locked_until IS NULL)
    OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
  ),
  CONSTRAINT pre_site_distribution_sent_shape CHECK (
    (state = 'sent' AND dynamics_email_id IS NOT NULL
      AND send_requested_at IS NOT NULL AND sent_at IS NOT NULL)
    OR state <> 'sent'
  )
);

-- `CREATE TABLE IF NOT EXISTS` may encounter a table created by an older
-- fresh-install bootstrap whose equivalent checks used PostgreSQL-generated
-- names. Reconcile those known names, then add any still-missing canonical
-- constraints so later maintenance can address them deterministically.
DO $$
DECLARE
  legacy_name TEXT;
  canonical_name TEXT;
BEGIN
  FOR legacy_name, canonical_name IN
    SELECT * FROM (VALUES
      ('pre_site_distribution_attempts_attachment_mode_check', 'pre_site_distribution_mode_check'),
      ('pre_site_distribution_attempts_state_check', 'pre_site_distribution_state_check'),
      ('pre_site_distribution_attempts_check', 'pre_site_distribution_recipient_shape'),
      ('pre_site_distribution_attempts_check1', 'pre_site_distribution_hash_shape'),
      ('pre_site_distribution_attempts_attempt_count_check', 'pre_site_distribution_attempt_count_nonnegative'),
      ('pre_site_distribution_attempts_check2', 'pre_site_distribution_prepared_shape'),
      ('pre_site_distribution_attempts_check3', 'pre_site_distribution_lease_shape'),
      ('pre_site_distribution_attempts_check4', 'pre_site_distribution_sent_shape')
    ) AS names(legacy_name, canonical_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'pre_site_distribution_attempts'::regclass
         AND conname = legacy_name
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'pre_site_distribution_attempts'::regclass
         AND conname = canonical_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE pre_site_distribution_attempts RENAME CONSTRAINT %I TO %I',
        legacy_name,
        canonical_name
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_mode_check') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_mode_check CHECK (attachment_mode IN ('docx', 'pdf', 'both'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_state_check') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_state_check CHECK (state IN ('preparing', 'prepared', 'activity_created', 'attachments_added', 'send_requested', 'sent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_recipient_shape') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_recipient_shape CHECK (jsonb_typeof(to_recipients) = 'array' AND jsonb_array_length(to_recipients) > 0 AND jsonb_typeof(cc_recipients) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_hash_shape') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_hash_shape CHECK (draft_hash ~ '^[0-9a-f]{64}$' AND (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$') AND (source_byte_hash IS NULL OR source_byte_hash ~ '^[0-9a-f]{64}$') AND (docx_byte_hash IS NULL OR docx_byte_hash ~ '^[0-9a-f]{64}$') AND (pdf_byte_hash IS NULL OR pdf_byte_hash ~ '^[0-9a-f]{64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_attempt_count_nonnegative') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_attempt_count_nonnegative CHECK (attempt_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_prepared_shape') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_prepared_shape CHECK (state = 'preparing' OR (source_drive_id IS NOT NULL AND source_item_id IS NOT NULL AND source_version_id IS NOT NULL AND source_content_hash IS NOT NULL AND source_byte_hash IS NOT NULL AND preview_hash IS NOT NULL AND docx_snapshot_document_id IS NOT NULL AND docx_drive_id IS NOT NULL AND docx_item_id IS NOT NULL AND docx_version_id IS NOT NULL AND docx_filename IS NOT NULL AND docx_content_type IS NOT NULL AND docx_byte_hash IS NOT NULL AND docx_size > 0 AND (attachment_mode = 'docx' OR (pdf_snapshot_document_id IS NOT NULL AND pdf_drive_id IS NOT NULL AND pdf_item_id IS NOT NULL AND pdf_version_id IS NOT NULL AND pdf_filename IS NOT NULL AND pdf_content_type IS NOT NULL AND pdf_byte_hash IS NOT NULL AND pdf_size > 0))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_lease_shape') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_lease_shape CHECK ((lease_token IS NULL AND locked_until IS NULL) OR (lease_token IS NOT NULL AND locked_until IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'pre_site_distribution_attempts'::regclass AND conname = 'pre_site_distribution_sent_shape') THEN
    ALTER TABLE pre_site_distribution_attempts ADD CONSTRAINT pre_site_distribution_sent_shape CHECK ((state = 'sent' AND dynamics_email_id IS NOT NULL AND send_requested_at IS NOT NULL AND sent_at IS NOT NULL) OR state <> 'sent');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_request_history
  ON pre_site_distribution_attempts (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_source
  ON pre_site_distribution_attempts (source_document_id, source_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pre_site_distribution_recovery
  ON pre_site_distribution_attempts (state, locked_until, updated_at)
  WHERE state <> 'sent';

COMMENT ON TABLE pre_site_distribution_attempts IS
  'Exact-preview and cross-system recovery ledger for frozen Pre-Site DOCX/PDF Dynamics email distribution; stores identities and hashes, never attachment bytes.';
COMMENT ON COLUMN pre_site_distribution_attempts.sent_at IS
  'When the Dynamics SendEmail action accepted the transport request (or readback proved Pending Send/Sending/Sent); not proof of inbox delivery.';
