-- Per-(PD, reviewer person) VIP flags for reviewer invitation sends
-- (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md "Broader effort", slice 1).
-- Keys on wmkf_potentialreviewersid, NOT contact: reviewer candidates
-- deliberately have no CRM contact until an identity-bearing acceptance
-- (S389), so the person row is the only stable pre-invitation key.
-- Consumed synchronously by the Invite Reviewers send flow (VIP rows render
-- as full editable preview cards); no ledger workflow reads these flags.

CREATE TABLE IF NOT EXISTS scheduled_email_reviewer_vip_flags (
  pd_systemuser_id UUID NOT NULL,
  potential_reviewer_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pd_systemuser_id, potential_reviewer_id)
);

COMMENT ON TABLE scheduled_email_reviewer_vip_flags IS
  'Per-PD reviewer-person VIP flags: invitation drafts to flagged people render as full editable previews for whoever sends on the PD''s behalf.';
