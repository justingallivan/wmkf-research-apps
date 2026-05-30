/**
 * Durable state for BILL honorarium onboarding (Postgres `bill_onboarding_state`).
 *
 * Closes the three S198 P1s (docs/REVIEWER_BILL_HARDENING_FINDINGS.md):
 *   - vendorId is persisted the instant createBillVendor returns, BEFORE the
 *     contact PATCH, so a failed contact PATCH can't lose it (→ no duplicate
 *     vendor on retry).
 *   - the row is RESERVED before createBillVendor so a concurrent second caller
 *     loses the PK race and never reaches BILL.
 *   - dynamics_pending is the torn-state marker the resume sweep acts on.
 *
 * One row per honorarium akoya_request. See migration 017 + docs/BILL_CHUNK_4_DESIGN.md.
 */

import { sql } from '@vercel/postgres';

/**
 * Reserve the onboarding row for a honorarium BEFORE any BILL side effect.
 * Atomic check-and-insert: the first caller wins; a concurrent second caller
 * gets `reserved: false` and the existing row (so it can short-circuit rather
 * than create a duplicate BILL vendor).
 *
 * @returns {Promise<{ reserved: boolean, row: object }>}
 */
export async function reserveOnboarding(honorariumRequestId, reviewerContactId) {
  const inserted = await sql`
    INSERT INTO bill_onboarding_state (honorarium_request_id, reviewer_contact_id)
    VALUES (${honorariumRequestId}, ${reviewerContactId})
    ON CONFLICT (honorarium_request_id) DO NOTHING
    RETURNING *
  `;
  if (inserted.rows.length > 0) {
    return { reserved: true, row: inserted.rows[0] };
  }
  const existing = await getOnboardingState(honorariumRequestId);
  return { reserved: false, row: existing };
}

export async function getOnboardingState(honorariumRequestId) {
  const r = await sql`
    SELECT * FROM bill_onboarding_state
    WHERE honorarium_request_id = ${honorariumRequestId}
  `;
  return r.rows[0] || null;
}

/**
 * Persist the BILL vendorId the instant createBillVendor returns (before the
 * contact PATCH). Idempotent.
 */
export async function setVendorId(honorariumRequestId, vendorId) {
  await sql`
    UPDATE bill_onboarding_state
    SET vendor_id = ${vendorId}, updated_at = NOW()
    WHERE honorarium_request_id = ${honorariumRequestId}
  `;
}

/** Record a terminal/observable onboarding status. */
export async function setStatus(honorariumRequestId, billStatus) {
  await sql`
    UPDATE bill_onboarding_state
    SET bill_status = ${billStatus}, updated_at = NOW()
    WHERE honorarium_request_id = ${honorariumRequestId}
  `;
}

/**
 * Mark the row torn (BILL side done, akoya_request PATCH still owed) so the
 * sweep can resume it. `pendingMatch` MUST be a boolean — the sweep fails closed
 * on NULL, so never pass undefined here.
 */
export async function markDynamicsPending(honorariumRequestId, { pendingMatch, pendingPni = null, billStatus = 'partial' }) {
  await sql`
    UPDATE bill_onboarding_state
    SET dynamics_pending = TRUE,
        pending_match = ${pendingMatch},
        pending_pni = ${pendingPni},
        bill_status = ${billStatus},
        updated_at = NOW()
    WHERE honorarium_request_id = ${honorariumRequestId}
  `;
}

/** Resolve the torn marker after a successful resume PATCH. */
export async function clearDynamicsPending(honorariumRequestId, billStatus) {
  await sql`
    UPDATE bill_onboarding_state
    SET dynamics_pending = FALSE,
        bill_status = ${billStatus},
        last_error = NULL,
        updated_at = NOW()
    WHERE honorarium_request_id = ${honorariumRequestId}
  `;
}

/** Record a failed resume attempt (the sweep keeps the row pending). */
export async function bumpAttempt(honorariumRequestId, lastError) {
  const r = await sql`
    UPDATE bill_onboarding_state
    SET attempts = attempts + 1,
        last_error = ${lastError ? String(lastError).slice(0, 500) : null},
        updated_at = NOW()
    WHERE honorarium_request_id = ${honorariumRequestId}
    RETURNING attempts
  `;
  return r.rows[0]?.attempts ?? null;
}

/** Rows still owed an akoya_request PATCH, for the resume sweep. */
export async function listPending(limit = 100) {
  const r = await sql`
    SELECT * FROM bill_onboarding_state
    WHERE dynamics_pending = TRUE
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  return r.rows;
}

/**
 * Rows STUCK in a non-terminal, non-resumable state past a threshold (Codex
 * post-impl reconcile): reserved-but-never-completed ('pending') or vendor-
 * created-but-writeback-incomplete ('partial') where the durable resume marker
 * was never set (dynamics_pending = false, so the resume sweep won't touch
 * them). These can carry an orphaned BILL vendor + a honorarium that never
 * onboarded — surface to ops for manual reconcile, never auto-resolved.
 */
export async function listStuck({ thresholdHours = 24, limit = 100 } = {}) {
  const r = await sql`
    SELECT * FROM bill_onboarding_state
    WHERE dynamics_pending = FALSE
      AND bill_status IN ('pending', 'partial')
      AND updated_at < NOW() - (${thresholdHours} || ' hours')::interval
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  return r.rows;
}

// Statuses safe to TTL-prune: the onboarding reached a terminal outcome and
// the staging row no longer guards anything. 'pending' (reserved, vendor_id may
// be unstaged) and 'partial' (vendor created but contact/request writeback
// incomplete — the row still holds the only vendor_id record) are EXCLUDED so
// cleanup can't reopen the duplicate-vendor window (Codex post-impl). Truly
// stuck non-terminal rows are surfaced by sweepBillOnboarding's reconcile, not
// silently deleted.
const TERMINAL_STATUSES = ['onboarded', 'reused_existing', 'no_match', 'ambiguous_match', 'alert_only'];

/** TTL prune of terminal (resolved) rows. Returns deleted count. */
export async function cleanupCompleted(retentionDays = 30) {
  const r = await sql`
    DELETE FROM bill_onboarding_state
    WHERE dynamics_pending = FALSE
      AND bill_status = ANY(${TERMINAL_STATUSES})
      AND updated_at < NOW() - (${retentionDays} || ' days')::interval
  `;
  return r.rowCount ?? 0;
}
