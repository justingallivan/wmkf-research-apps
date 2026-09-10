-- Deliberation briefing links (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.2).
-- One expiring, revocable link per request that lets Board members and
-- external consultants open the read-only briefing page without a login.
-- The row holds link identity, expiry, and revocation only: the writeup it
-- serves is pinned by the distribution ledger, reviews resolve live from
-- Dataverse, and the proposal narrative resolves by governed path.
-- token_digest is the SHA-256 of the JWT (verified on every external request);
-- token_ciphertext is the JWT sealed with lib/utils/encryption.js so Share can
-- carry the same link again and staff can copy it. The raw token is never
-- stored in clear.

CREATE TABLE IF NOT EXISTS deliberation_briefing_links (
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
  CONSTRAINT deliberation_briefing_digest_shape CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT deliberation_briefing_revocation_shape CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND superseded_by IS NULL)
    OR revoked_at IS NOT NULL
  )
);

-- At most one live (unrevoked) link per request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberation_briefing_live_per_request
  ON deliberation_briefing_links (request_id)
  WHERE revoked_at IS NULL;

-- The exact preview binds the link it carried so a reissue between preview
-- and send fails the send instead of emailing a dead link.
ALTER TABLE pre_site_distribution_attempts
  ADD COLUMN IF NOT EXISTS briefing_link_id UUID;

COMMENT ON TABLE deliberation_briefing_links IS
  'Expiring, revocable per-request links to the read-only deliberation briefing page; stores a token digest and sealed token, never the raw token.';
COMMENT ON COLUMN pre_site_distribution_attempts.briefing_link_id IS
  'deliberation_briefing_links.id carried in this exact preview; send refuses when that link is no longer live.';
