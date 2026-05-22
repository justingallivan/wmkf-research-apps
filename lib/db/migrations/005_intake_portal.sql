-- Migration 005: Intake Portal draft staging + audit
-- See docs/INTAKE_PORTAL_DESIGN.md
--
-- intake_drafts holds in-progress applicant form state and attachment
-- metadata. Drafts never reach Dynamics; on submission, fields are
-- written to akoya_request via DynamicsService and the row is deleted.
--
-- intake_audit records every state-changing portal action. Payloads are
-- hashed (sha256) rather than stored, so the audit table is safe under
-- PII review even if drafts contain sensitive applicant data.

CREATE TABLE IF NOT EXISTS intake_drafts (
  id            SERIAL PRIMARY KEY,
  contact_oid   TEXT NOT NULL,                       -- Entra External ID OID
  account_id    TEXT NOT NULL,                       -- Dynamics account GUID
  request_id    TEXT,                                -- Dynamics akoya_request GUID; non-null for Phase II pilot
  form_key      TEXT NOT NULL,                       -- e.g. 'phase-ii-research-2026-06'
  draft_json    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- current form state
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{filename, blob_url, sha256, uploaded_at, size, scanned_at}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness scoped per request: an institution can have multiple in-flight
-- drafts in the same cycle (universities often submit several proposals).
-- Partial indexes handle both the request-bound case (pilot) and the
-- request-less case (future concept-stage drafts).
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_drafts_unique_with_request
  ON intake_drafts (account_id, request_id, form_key)
  WHERE request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_drafts_unique_no_request
  ON intake_drafts (account_id, form_key)
  WHERE request_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_intake_drafts_contact_oid ON intake_drafts(contact_oid);
CREATE INDEX IF NOT EXISTS idx_intake_drafts_account ON intake_drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_intake_drafts_request ON intake_drafts(request_id);
CREATE INDEX IF NOT EXISTS idx_intake_drafts_updated ON intake_drafts(updated_at DESC);

CREATE TABLE IF NOT EXISTS intake_audit (
  id              BIGSERIAL PRIMARY KEY,
  actor_oid       TEXT,                              -- Entra OID for applicants; azure_id for staff; null for system
  actor_type      TEXT NOT NULL,                     -- 'applicant' | 'staff' | 'system'
  action          TEXT NOT NULL,                     -- 'draft.upsert' | 'draft.delete' | 'submit' | 'attachment.upload' | 'attachment.delete' | 'membership.request' | 'membership.approve' | 'membership.reject' | 'membership.revoke' | etc.
  target_entity   TEXT,                              -- 'akoya_request' | 'wmkf_portalmembership' | 'intake_drafts' | 'attachment'
  target_id       TEXT,                              -- GUID or local id
  payload_digest  TEXT,                              -- sha256 hex of payload; no payload itself stored
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,-- small structured context (no PII)
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_audit_actor ON intake_audit(actor_oid);
CREATE INDEX IF NOT EXISTS idx_intake_audit_target ON intake_audit(target_entity, target_id);
CREATE INDEX IF NOT EXISTS idx_intake_audit_action ON intake_audit(action);
CREATE INDEX IF NOT EXISTS idx_intake_audit_created ON intake_audit(created_at DESC);

COMMENT ON TABLE intake_drafts IS 'Applicant intake portal: in-progress form state + attachment metadata. Cleared on submission. Authoritative final values live in Dynamics akoya_request.';
COMMENT ON TABLE intake_audit IS 'Applicant intake portal: audit trail of state-changing actions. Payloads hashed, not stored.';
