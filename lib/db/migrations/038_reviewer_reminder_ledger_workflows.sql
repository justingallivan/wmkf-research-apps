-- Admit the reviewer cron-reminder workflows into the scheduled-email ledger
-- (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md, reviewer cron-reminders slice,
-- owner decisions 2026-08-27). source_record_id for the reviewer workflows is
-- the wmkf_appreviewersuggestion id; they have no grantee deliverable, so
-- deliverable_id becomes nullable with a per-workflow shape constraint.

ALTER TABLE scheduled_email_messages
  ALTER COLUMN deliverable_id DROP NOT NULL;

ALTER TABLE scheduled_email_messages
  DROP CONSTRAINT scheduled_email_workflow_check;

ALTER TABLE scheduled_email_messages
  ADD CONSTRAINT scheduled_email_workflow_check
    CHECK (workflow_type IN (
      'grantee_abstract_reminder',
      'reviewer_respond_reminder',
      'reviewer_reviewdue_reminder'
    ));

-- Grantee rows keep their deliverable; reviewer rows must not carry one.
ALTER TABLE scheduled_email_messages
  ADD CONSTRAINT scheduled_email_deliverable_shape
    CHECK (
      (workflow_type = 'grantee_abstract_reminder' AND deliverable_id IS NOT NULL)
      OR (workflow_type <> 'grantee_abstract_reminder' AND deliverable_id IS NULL)
    );
