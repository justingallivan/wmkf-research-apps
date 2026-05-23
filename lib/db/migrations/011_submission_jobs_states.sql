-- Migration 011: Intake Portal submission_jobs state-machine + lease-token expansion
-- See docs/INTAKE_PORTAL_DRAIN_PLAN.md § P0 (build plan v7)
--
-- Drain plan v7 introduces:
--   * Single-phase submission pivot: drain CREATES a new akoya_request (not attach)
--   * 'request_created' state inserted between 'scanning' and 'files_moved'
--   * akoya_requestnum captured at request_created for SharePoint folder naming
--   * Two-phase claim with locked_until + stable lease_token (UUID) for parallel-worker safety
--   * Partial-unique index rekey: the old (account_id, request_id, form_key) was useless
--     post-pivot (every submit has a fresh request_id; the partial-unique never collided).
--     Replaced with (contact_oid, account_id, form_key) as belt-and-suspenders against
--     fresh-UUID duplicate-submit-from-different-tab; idempotency_key UNIQUE remains primary.
--
-- This migration is non-destructive on data — adds columns/constraints, swaps an index
-- (drop + create), no row mutations.

BEGIN;

-- 1) Status CHECK: add 'request_created' between 'scanning' and 'files_moved'
ALTER TABLE submission_jobs DROP CONSTRAINT submission_jobs_status_check;
ALTER TABLE submission_jobs ADD CONSTRAINT submission_jobs_status_check CHECK (status IN (
  'queued',
  'scanning',
  'request_created',
  'files_moved',
  'dynamics_patched',
  'status_flipped',
  'completed',
  'failed',
  'cancelled'
));

-- 2) Server-assigned request number captured during Create (for SharePoint folder name).
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS akoya_requestnum TEXT;

-- 3) Two-phase claim: locked_until is the lease deadline; lease_token is a stable
--    per-claim identifier (NOT changed by lease renewal, only by a fresh claim).
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE submission_jobs ADD COLUMN IF NOT EXISTS lease_token  UUID;

-- 4) Replace the active-ready index with one that supports the drain claim query.
--    Old: (next_attempt_at, created_at) WHERE status NOT IN terminal.
--    New: (next_attempt_at, locked_until, created_at) WHERE status NOT IN terminal.
--    The claim query also filters "locked_until IS NULL OR locked_until < now()" — that's
--    index-eligible against the new column ordering. now() is NOT in the predicate
--    (volatile fns are illegal in PG index predicates).
DROP INDEX IF EXISTS idx_submission_jobs_active_ready;
CREATE INDEX idx_submission_jobs_unlocked
  ON submission_jobs (next_attempt_at, locked_until, created_at)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

-- 5) Replace the partial-unique. The old (account_id, request_id, form_key) never
--    collided in the single-phase flow (every submit has a fresh request_id). The new
--    (contact_oid, account_id, form_key) prevents fresh-UUID duplicate-submit-from-
--    different-tab; idempotency_key UNIQUE is still the primary collision guard.
DROP INDEX IF EXISTS idx_submission_jobs_one_active_per_request;
CREATE UNIQUE INDEX idx_submission_jobs_one_active_per_contact_form
  ON submission_jobs (contact_oid, account_id, form_key)
  WHERE status NOT IN ('completed', 'failed', 'cancelled');

COMMIT;
