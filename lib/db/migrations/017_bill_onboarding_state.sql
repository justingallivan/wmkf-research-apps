-- Migration 017: BILL onboarding durable state (chunk-4 hardening)
--
-- Closes the three S198 money-adjacent P1s (docs/REVIEWER_BILL_HARDENING_FINDINGS.md):
--   1/2. Duplicate BILL vendor on retry — the contact PATCH (wmkf_billcomid) was
--        the SOLE vendor-create idempotency primitive and could fail-and-continue,
--        so a retry re-read empty wmkf_billcomid and created a SECOND vendor.
--     3. Torn cross-system state — BILL invite succeeded but the akoya_request
--        PATCH failed with no retry/marker, leaving the invite unrecorded.
--
-- Design: docs/BILL_CHUNK_4_DESIGN.md "Thread 3".
--
-- One row per honorarium akoya_request (1 onboarding per honorarium). The row is
-- RESERVED (inserted with no vendor_id) BEFORE createBillVendor so a concurrent
-- second caller loses the PK race and never reaches BILL. vendor_id is written
-- the instant createBillVendor returns, BEFORE the contact PATCH — so a failed
-- contact PATCH no longer loses the vendorId.
--
-- dynamics_pending = the torn-state marker: BILL side succeeded but the final
-- akoya_request writeback PATCH is still owed. The daily-maintenance sweep
-- (MaintenanceService.sweepBillOnboarding) resumes it idempotently.
--   pending_match = true  -> matched: write PNI + wmkf_exisitngbillcomaccount "Yes"
--   pending_match = false -> no/ambiguous match: write "No"
--   pending_match IS NULL -> malformed; sweep FAILS CLOSED (never defaults to "No").

CREATE TABLE IF NOT EXISTS bill_onboarding_state (
  honorarium_request_id  UUID PRIMARY KEY,
  reviewer_contact_id    UUID NOT NULL,
  vendor_id              TEXT,
  bill_status            TEXT NOT NULL DEFAULT 'pending',
  dynamics_pending       BOOLEAN NOT NULL DEFAULT FALSE,
  pending_pni            TEXT,
  pending_match          BOOLEAN,
  attempts               INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index for the resume sweep's hot query (find rows still owed a PATCH).
CREATE INDEX IF NOT EXISTS idx_bill_onboarding_pending
  ON bill_onboarding_state (dynamics_pending)
  WHERE dynamics_pending = TRUE;

-- Supports the TTL cleanup step (prune completed, non-pending rows by age).
CREATE INDEX IF NOT EXISTS idx_bill_onboarding_updated_at
  ON bill_onboarding_state (updated_at);
