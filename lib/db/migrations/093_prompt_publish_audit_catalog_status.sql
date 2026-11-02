-- Migration 093: let prompt_publish_audit record Admin catalog-field edits.
-- Owner decision 2026-11-02: reuse the publish audit for edits to the six wave36
-- catalog columns on wmkf_ai_prompt (title, description, group, section, used by,
-- usage). Adds three statuses; no rows change. Each edit gets its own server-minted
-- request_id, so publish idempotency lookups (keyed by request_id) never see them.
-- See docs/plans/SHARED_PROMPT_LIBRARY_SCOPE_CHANGE_2026-11-02.md.
SET LOCAL lock_timeout = '5s';

ALTER TABLE prompt_publish_audit DROP CONSTRAINT IF EXISTS prompt_publish_audit_status_check;
ALTER TABLE prompt_publish_audit ADD CONSTRAINT prompt_publish_audit_status_check CHECK (status IN (
  'pending', 'completed', 'partial', 'already_published', 'concurrency_conflict',
  'invalid_body', 'no_current_row', 'duplicate_current_rows', 'audit_unavailable', 'failed',
  'catalog_updated', 'catalog_conflict', 'catalog_superseded'
));

-- The original inline CHECK was auto-named; if it had any other name the DROP above
-- was a no-op and the old CHECK would still reject the new statuses. Fail the
-- transaction instead of leaving two status checks in place.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'prompt_publish_audit'::regclass
       AND c.contype = 'c'
       AND c.conname <> 'prompt_publish_audit_status_check'
       AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  ) THEN
    RAISE EXCEPTION 'prompt_publish_audit has another status CHECK constraint; reconcile before applying 093';
  END IF;
END $$;
