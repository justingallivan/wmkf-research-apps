-- Durable private-Blob staging ledger for browser-direct portal image uploads.
--
-- Browser bytes land in the private UPLOADS_BLOB_RW_TOKEN store; the browser
-- receives only a path-scoped, short-lived client token. Finalize routes claim
-- the row by actor + scope + resource, verify the private object server-side,
-- and persist a candidate SharePoint result before the Dataverse commit. The
-- candidate/result fields make response-drop and function-restart retries
-- reconcilable without duplicating or deleting a possibly referenced image.

CREATE TABLE IF NOT EXISTS portal_upload_staging (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL
    CONSTRAINT portal_upload_staging_scope_check
    CHECK (scope IN ('grantee_image', 'staff_grantee_image')),
  resource_id UUID NOT NULL,
  actor_binding TEXT NOT NULL,
  pathname TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  declared_content_type TEXT NOT NULL,
  max_bytes BIGINT NOT NULL
    CONSTRAINT portal_upload_staging_max_bytes_positive CHECK (max_bytes > 0),
  original_etag TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT portal_upload_staging_status_check
    CHECK (status IN ('pending', 'finalizing', 'consumed', 'rejected', 'expired')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  candidate_result JSONB,
  result_code TEXT,
  result_payload JSONB,
  blob_etag TEXT,
  sha256 CHAR(64),
  actual_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT portal_upload_staging_lease_shape CHECK (
    (status = 'finalizing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'finalizing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT portal_upload_staging_terminal_shape CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL AND result_code IS NOT NULL)
    OR
    (status <> 'consumed' AND consumed_at IS NULL)
  ),
  CONSTRAINT portal_upload_staging_sha256_shape CHECK (
    sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_actor_resource
  ON portal_upload_staging (actor_binding, scope, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_claim
  ON portal_upload_staging (status, lease_expires_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_portal_upload_staging_cleanup
  ON portal_upload_staging (expires_at, status);

COMMENT ON TABLE portal_upload_staging IS
  'Private Blob staging ownership/lease/idempotency ledger for direct browser portal uploads.';
COMMENT ON COLUMN portal_upload_staging.actor_binding IS
  'Server-derived actor identity: SHA-256 external token binding or authenticated profile id; never client supplied.';
COMMENT ON COLUMN portal_upload_staging.pathname IS
  'Exact server-minted private Blob pathname. Cleanup deletes only pathnames selected from this table.';
COMMENT ON COLUMN portal_upload_staging.candidate_result IS
  'Exact downstream SharePoint candidate identity persisted before Dataverse commit for crash reconciliation.';
