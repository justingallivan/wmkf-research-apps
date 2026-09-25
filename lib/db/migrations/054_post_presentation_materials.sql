-- Post-research-presentation materials, Slice 1.
--
-- Additive durable state only. This migration does not authorize a producer:
-- POST_PRESENTATION_MATERIALS_SCHEMA_READY and the independent
-- POST_PRESENTATION_MATERIALS_ACCESS rollout control remain off until their
-- separately approved apply/readback and activation steps.

CREATE TABLE IF NOT EXISTS presentation_material_links (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  token_digest CHAR(64) NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  superseded_by UUID,
  CONSTRAINT presentation_material_links_digest_shape CHECK (
    token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT presentation_material_links_revocation_shape CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND superseded_by IS NULL)
    OR revoked_at IS NOT NULL
  ),
  CONSTRAINT presentation_material_links_expiry_shape CHECK (
    expires_at > created_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_material_links_live_request
  ON presentation_material_links (request_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS presentation_material_uploads (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  artifact_type INTEGER NOT NULL,
  original_display_filename TEXT NOT NULL,
  validated_mime_type TEXT NOT NULL,
  declared_size BIGINT NOT NULL,
  client_resume_fingerprint CHAR(64) NOT NULL,
  library_name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  physical_filename TEXT NOT NULL,
  generation_key CHAR(64) NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'initiated',
  upload_url_ciphertext TEXT,
  upload_session_expires_at TIMESTAMPTZ,
  intent_expires_at TIMESTAMPTZ NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  candidate_site_id TEXT,
  candidate_drive_id TEXT,
  candidate_item_id TEXT,
  candidate_version_id TEXT,
  candidate_etag TEXT,
  candidate_size BIGINT,
  request_document_id UUID,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT presentation_material_uploads_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007)
  ),
  CONSTRAINT presentation_material_uploads_size_check CHECK (
    declared_size > 0 AND declared_size <= 2000000000
    AND (candidate_size IS NULL OR candidate_size = declared_size)
  ),
  CONSTRAINT presentation_material_uploads_fingerprint_shape CHECK (
    client_resume_fingerprint ~ '^[0-9a-f]{64}$'
    AND generation_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT presentation_material_uploads_state_check CHECK (
    state IN ('initiated', 'uploaded', 'finalizing', 'finalized', 'failed', 'abandoned')
  ),
  CONSTRAINT presentation_material_uploads_lease_shape CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT presentation_material_uploads_error_bound CHECK (
    last_error IS NULL OR char_length(last_error) <= 2000
  ),
  CONSTRAINT presentation_material_uploads_candidate_shape CHECK (
    (
      candidate_site_id IS NULL
      AND candidate_drive_id IS NULL
      AND candidate_item_id IS NULL
      AND candidate_version_id IS NULL
      AND candidate_etag IS NULL
      AND candidate_size IS NULL
    )
    OR (
      candidate_site_id IS NOT NULL
      AND candidate_drive_id IS NOT NULL
      AND candidate_item_id IS NOT NULL
      AND candidate_version_id IS NOT NULL
      AND candidate_etag IS NOT NULL
      AND candidate_size IS NOT NULL
    )
  ),
  CONSTRAINT presentation_material_uploads_finalized_shape CHECK (
    state <> 'finalized'
    OR (
      request_document_id IS NOT NULL
      AND finalized_at IS NOT NULL
      AND upload_url_ciphertext IS NULL
      AND candidate_item_id IS NOT NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_material_uploads_path
  ON presentation_material_uploads (library_name, folder_path, physical_filename);
CREATE INDEX IF NOT EXISTS idx_presentation_material_uploads_actor_request
  ON presentation_material_uploads (actor_id, request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presentation_material_uploads_review
  ON presentation_material_uploads (intent_expires_at, state, lease_expires_at)
  WHERE state <> 'finalized';

CREATE TABLE IF NOT EXISTS presentation_material_slot_leases (
  request_id UUID NOT NULL,
  artifact_type INTEGER NOT NULL,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  fence_version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, artifact_type),
  CONSTRAINT presentation_material_slot_leases_artifact_type_check CHECK (
    artifact_type IN (100000005, 100000006, 100000007)
  ),
  CONSTRAINT presentation_material_slot_leases_lease_shape CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT presentation_material_slot_leases_fence_check CHECK (
    fence_version >= 1 AND fence_version <= 2147483647
  )
);

ALTER TABLE portal_upload_staging
  DROP CONSTRAINT IF EXISTS portal_upload_staging_scope_check;
ALTER TABLE portal_upload_staging
  ADD CONSTRAINT portal_upload_staging_scope_check
  CHECK (scope IN (
    'grantee_image',
    'staff_grantee_image',
    'site_visit_material',
    'consultant_feedback',
    'post_presentation_transcript'
  ));

COMMENT ON TABLE presentation_material_links IS
  'Expiring, revocable materials-only external links; stores a token digest and sealed token, never the raw token.';
COMMENT ON TABLE presentation_material_uploads IS
  'Durable actor/request/visit-bound browser-direct Graph upload intents; upload URLs are stored only as ciphertext.';
COMMENT ON COLUMN presentation_material_uploads.upload_session_expires_at IS
  'Last expiry observed by the server from live Graph status; advisory and never alone a terminal predicate.';
COMMENT ON COLUMN presentation_material_uploads.intent_expires_at IS
  'Review-after time derived from the last server-observed Graph expiry; not deletion authority.';
COMMENT ON TABLE presentation_material_slot_leases IS
  'Five-minute request/artifact mutation leases with monotonic Dataverse-compatible fencing.';
