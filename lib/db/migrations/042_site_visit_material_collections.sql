-- Applicant materials collection for a scheduled site visit
-- (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, owner decisions M1–M5,
-- 2026-09-10). One operational row per collection: the request and the exact
-- site-visit Activity it was started from, the checklist template with per-item
-- waivers, the PI/liaison contact snapshot the invitation went to, the sealed
-- contributor link (digest + ciphertext, never the raw token), the due and
-- close instants, and send receipts. Received files are NOT copied here: the
-- registry (wmkf_requestdocument) stays the owner of accepted files and the
-- collection reads them back by artifact type and canonical filename.
CREATE TABLE IF NOT EXISTS site_visit_material_collections (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  site_visit_activity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  checklist JSONB NOT NULL,
  contacts JSONB NOT NULL,
  jti TEXT NOT NULL UNIQUE,
  token_digest CHAR(64) NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  created_by UUID NOT NULL,
  invited_at TIMESTAMPTZ,
  invitation_email_id UUID,
  last_reminder_at TIMESTAMPTZ,
  last_reminder_email_id UUID,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  ready_confirmed_at TIMESTAMPTZ,
  ready_confirmed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_visit_material_status_check CHECK (status IN ('open', 'ready', 'closed')),
  CONSTRAINT site_visit_material_digest_shape CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT site_visit_material_checklist_shape CHECK (jsonb_typeof(checklist) = 'array'),
  CONSTRAINT site_visit_material_contacts_shape CHECK (jsonb_typeof(contacts) = 'object'),
  CONSTRAINT site_visit_material_window_shape CHECK (closes_at > due_at),
  CONSTRAINT site_visit_material_reminders_nonnegative CHECK (reminder_count >= 0)
);

-- One collection in flight per request; closed rows stay for the record.
CREATE UNIQUE INDEX IF NOT EXISTS site_visit_material_collections_open_request
  ON site_visit_material_collections (request_id)
  WHERE status <> 'closed';

CREATE INDEX IF NOT EXISTS site_visit_material_collections_request_created
  ON site_visit_material_collections (request_id, created_at DESC);

COMMENT ON TABLE site_visit_material_collections IS
  'Applicant materials collection per scheduled site visit: checklist, contacts snapshot, sealed contributor link, due/close window, send receipts. Files live in SharePoint + wmkf_requestdocument.';
