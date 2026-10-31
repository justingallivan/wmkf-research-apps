/**
 * Reviewer engagement policy - shared, browser-safe predicates over a raw
 * wmkf_appreviewersuggestion row's `wmkf_reviewstatus` (Dataverse option
 * integer) and `wmkf_completedat`.
 *
 * Four read sites across two files classified a raw row this way before
 * Stage 2:
 *   - `lib/services/reviewer-finder/my-candidates-service.js`'s correction
 *     guard and `lib/dataverse/adapters/reviewer-suggestion.js`
 *     `updateLifecycle`'s invitation-response guard - both row-level
 *     (completedat OR status), now `isClosedEngagementRow` /
 *     `isInvitationCorrectionSourceRow`.
 *   - `updateLifecycle`'s later "refuse to leave a closed status" guard -
 *     status-only, now `isClosedEngagementStatus`.
 *   - `softDelete`'s terminal guard - status-only at Stage 2; widened to the
 *     row predicate (and its select widened to fetch `wmkf_completedat`) on
 *     2026-09-06 under owner decision D0 (Stage 7 plan).
 * The remaining status-only site deliberately does NOT use the
 * completedat-aware row predicate: pre-Stage-2 it only ever inspected
 * `wmkf_reviewstatus`, never `wmkf_completedat`, even though `completedat`
 * is part of the same select. Switching it to the row predicate would add a
 * completedat check that was never there - a behavior change that needs its
 * own owner decision, as D0 was for `softDelete`.
 *
 * The two Sets below are intentionally module-private: only the exported
 * predicates are part of the contract, so a future edit to set membership
 * can't be applied inconsistently at only one call site.
 *
 * Imports ONLY from `shared/config/` - never from `lib/` - so this module
 * stays safe to import from browser-facing code.
 *
 * Raw-row input only (no DTO variant): every caller reads a fresh row via an
 * explicit Dataverse select and passes it straight in.
 */

import { REVIEW_STATUS_MAP, RESPONSE_TYPE_MAP } from '../config/reviewerLifecycle.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../config/reviewerStatus.js';
import { DID_NOT_SUBMIT_REVIEW_STATUS_VALUE } from '../config/reviewerOutcome.js';

// Statuses from which an invitation-response correction is still allowed.
// `null` is included because a fresh, never-invited row carries a null
// wmkf_reviewstatus. `undefined` is deliberately NOT a member (see the
// explicit guard in isInvitationCorrectionSourceRow below).
const INVITATION_CORRECTION_SOURCE_STATUSES = new Set([
  null,
  REVIEW_STATUS_MAP.accepted,
  REVIEW_STATUS_MAP.materials_sent,
  REVIEW_STATUS_MAP.under_review,
  REVIEW_STATUS_MAP.review_received,
]);

// Statuses at which an engagement is closed (durable history) regardless of
// wmkf_completedat.
const CLOSED_ENGAGEMENT_STATUSES = new Set([
  REVIEW_STATUS_MAP.complete,
  ...Object.values(TERMINAL_REVIEW_STATUS_VALUES),
]);

/**
 * True when `status` (a raw `wmkf_reviewstatus` option integer) is one of the
 * closed/terminal statuses. Status-only - does not consider
 * `wmkf_completedat` - for the one remaining call site that never checked completedat
 * pre-Stage-2 (see module docblock).
 */
export function isClosedEngagementStatus(status) {
  return CLOSED_ENGAGEMENT_STATUSES.has(status);
}

/**
 * True when the row's engagement is closed: either a completion timestamp is
 * stamped, or the status is one of the closed/terminal statuses.
 */
export function isClosedEngagementRow(row) {
  return Boolean(row?.wmkf_completedat) || isClosedEngagementStatus(row?.wmkf_reviewstatus);
}

/**
 * True when the row's status is a valid source state for an
 * invitation-response correction. `null` is a member of the source set (a
 * never-invited row); `undefined` deliberately is NOT, so an absent field
 * returns `false` here, matching the pre-refactor local sets this module
 * replaced. The `undefined` check is explicit so this stays correct even if
 * a future edit normalises `undefined` to `null` upstream of this call - do
 * not remove it.
 */
export function isInvitationCorrectionSourceRow(row) {
  const status = row?.wmkf_reviewstatus;
  if (status === undefined) return false;
  return INVITATION_CORRECTION_SOURCE_STATUSES.has(status);
}

// ── Invited-reviewer outcomes ───────────────────────────────────────────────
// docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md. A reviewer we
// contacted keeps a recorded outcome: Remove is for never-invited candidates,
// and Restore never resets an invited row. Both predicates fail closed when a
// field they read was not selected (undefined), because an unselected field
// would otherwise read as empty and let the row through. `wmkf_endedby` is
// read when present; it is not required until the column is provisioned.

export const OUTCOME_GUARD_FIELDS = Object.freeze([
  'wmkf_invited', 'wmkf_emailsentat', 'wmkf_responsetype', 'wmkf_declined',
  'wmkf_reviewstatus', 'wmkf_reviewreceivedat', 'wmkf_completedat',
]);

const ENDED_RESPONSE_TYPES = new Set([
  RESPONSE_TYPE_MAP.declined,
  RESPONSE_TYPE_MAP.no_response,
  RESPONSE_TYPE_MAP.withdrawn_sufficient,
]);

const ENDED_REVIEW_STATUSES = new Set([
  ...Object.values(TERMINAL_REVIEW_STATUS_VALUES),
  DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
]);

function requireGuardFields(row, fields) {
  const missing = fields.filter((field) => row?.[field] === undefined);
  if (missing.length) throw new Error(`reviewer outcome guard: row is missing ${missing.join(', ')}`);
}

/** True once the reviewer was contacted (a real send or a staff-recorded manual link). */
export function isInvitedRow(row) {
  requireGuardFields(row, ['wmkf_invited', 'wmkf_emailsentat']);
  return row.wmkf_invited === true || Boolean(row.wmkf_emailsentat);
}

/**
 * True when the engagement has ended or produced a review. Accepted or Held
 * with none of these is still open. Covers rows written before Ended By.
 */
export function hasRecordedOutcome(row) {
  requireGuardFields(row, OUTCOME_GUARD_FIELDS);
  return (row.wmkf_endedby !== undefined && row.wmkf_endedby !== null)
    || ENDED_RESPONSE_TYPES.has(row.wmkf_responsetype)
    || row.wmkf_declined === true
    || ENDED_REVIEW_STATUSES.has(row.wmkf_reviewstatus)
    || Boolean(row.wmkf_reviewreceivedat)
    || Boolean(row.wmkf_completedat);
}

/**
 * Never invited and no recorded outcome: the only rows Remove and Restore
 * accept. For screen eligibility flags only: an incomplete row reads as
 * ineligible (fail closed) instead of throwing, so one bad row cannot fail a
 * whole list. Server guards use the throwing predicates above.
 */
export function isCandidateOnlyRow(row) {
  try { return !isInvitedRow(row) && !hasRecordedOutcome(row); } catch { return false; }
}
