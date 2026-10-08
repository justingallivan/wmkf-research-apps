-- Leadership daily digest ledger (Final Writeup group-review handoff Stage 5).
-- One row per (leadership recipient, digest day). The cron claims the row with
-- a lease before any Dynamics work, so concurrent invocations send at most one
-- digest per recipient per day. `membership` is frozen when the row is first
-- inserted and is never rewritten: it holds the display snapshot of each
-- writeup the digest lists, so every retry renders the same email, and only an
-- accepted row's membership counts as "already told" for later digests.
-- Writeups come only from Grant Programs in FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS
-- (owner 2026-10-07: Research only). Dynamics owns the email activity and transport.

CREATE TABLE IF NOT EXISTS final_writeup_leadership_digests (
  recipient_systemuser_id UUID NOT NULL,
  digest_day DATE NOT NULL,
  membership JSONB NOT NULL,
  recipient_address TEXT NOT NULL,
  dynamics_email_id UUID,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  locked_until TIMESTAMPTZ,
  last_error_code TEXT,
  last_failed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (recipient_systemuser_id, digest_day),
  CONSTRAINT final_writeup_leadership_digest_membership_shape CHECK (
    jsonb_typeof(membership) = 'array' AND jsonb_array_length(membership) > 0
  ),
  CONSTRAINT final_writeup_leadership_digest_accepted_shape CHECK (
    accepted_at IS NULL OR dynamics_email_id IS NOT NULL
  ),
  CONSTRAINT final_writeup_leadership_digest_lease_shape CHECK (
    (lease_token IS NULL AND locked_until IS NULL)
    OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_final_writeup_leadership_digests_unaccepted
  ON final_writeup_leadership_digests (digest_day)
  WHERE accepted_at IS NULL;

COMMENT ON TABLE final_writeup_leadership_digests IS
  'One leadership daily digest per (recipient, day). Membership is frozen at insert; only accepted rows count as already told.';
COMMENT ON COLUMN final_writeup_leadership_digests.accepted_at IS
  'Dynamics accepted the SendEmail transport request (or readback proved an accepted status); not proof of inbox delivery.';
