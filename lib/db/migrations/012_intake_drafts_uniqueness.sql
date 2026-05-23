-- Migration 012: Intake Portal drafts — rekey the requestless partial-unique
-- index to be contact-scoped. See docs/INTAKE_PORTAL_DRAIN_PLAN.md § P3 (v7).
--
-- The current idx_intake_drafts_unique_no_request is UNIQUE (account_id, form_key)
-- WHERE request_id IS NULL. That allowed only ONE requestless draft per institution-
-- form across ALL contacts at the institution — so two applicants at Stanford both
-- starting Phase II Research drafts would collide. The single-phase pivot makes
-- the requestless branch the dominant path (drafts are requestless until submit
-- populates request_id), so this collision is no longer rare-edge-case.
--
-- v7 P3 rekeys to (contact_oid, account_id, form_key): one active requestless
-- draft per (contact × institution × form). The intake-draft-service.js upsert's
-- ON CONFLICT target moves in the same commit (see lib/services/intake-draft-service.js).
--
-- Idempotent: DROP IF EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS, all in one txn.

BEGIN;

DROP INDEX IF EXISTS idx_intake_drafts_unique_no_request;

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_drafts_unique_no_request
  ON intake_drafts (contact_oid, account_id, form_key)
  WHERE request_id IS NULL;

COMMIT;
