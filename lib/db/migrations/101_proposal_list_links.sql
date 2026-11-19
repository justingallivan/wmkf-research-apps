-- Proposal list links (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
-- One expiring, revocable personal link per recipient per cycle. The link opens
-- a no-login page listing that cycle's submitted proposals, and each listed
-- proposal's staff version. The page reads only the frozen items below; the
-- staff-version file is resolved server-side from the item's request.
-- token_digest is the SHA-256 of the token (verified on every external
-- request); token_ciphertext is the token sealed with lib/utils/encryption.js
-- so staff can copy the same link again. The raw token is never stored in clear.
-- recipient_source is a display reference only (no foreign key): the roster it
-- names is being re-keyed, and a link must outlive that.

CREATE TABLE IF NOT EXISTS proposal_list_links (
  id UUID PRIMARY KEY,
  cycle_code TEXT NOT NULL,
  list_kind TEXT NOT NULL DEFAULT 'ordinary',
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_source TEXT,
  jti TEXT NOT NULL UNIQUE,
  token_digest CHAR(64) NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  items_built_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  CONSTRAINT proposal_list_links_cycle_shape CHECK (cycle_code ~ '^[JD][0-9]{2}$'),
  CONSTRAINT proposal_list_links_kind CHECK (list_kind IN ('ordinary', 'test')),
  CONSTRAINT proposal_list_links_email_lower CHECK (recipient_email = lower(recipient_email)),
  CONSTRAINT proposal_list_links_digest_shape CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT proposal_list_links_revocation_shape CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR revoked_at IS NOT NULL
  )
);

-- At most one live (unrevoked) link per cycle, kind, and recipient address.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_list_links_live_per_recipient
  ON proposal_list_links (cycle_code, list_kind, recipient_email)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS proposal_list_items (
  link_id UUID NOT NULL REFERENCES proposal_list_links(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  request_number TEXT NOT NULL,
  title TEXT NOT NULL,
  institution TEXT,
  project_leader TEXT,
  section TEXT NOT NULL,
  highlighted BOOLEAN NOT NULL DEFAULT false,
  own_institution BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (link_id, request_id),
  CONSTRAINT proposal_list_items_number_unique UNIQUE (link_id, request_number),
  CONSTRAINT proposal_list_items_number_shape CHECK (request_number ~ '^[0-9]{1,12}$')
);

COMMENT ON TABLE proposal_list_links IS
  'Expiring, revocable per-recipient links to the no-login proposal list page for one grant cycle; stores a token digest and sealed token, never the raw token.';
COMMENT ON TABLE proposal_list_items IS
  'Frozen proposal snapshot for one proposal list link: the only requests that link may open, with section, highlight, and own-institution marks.';
