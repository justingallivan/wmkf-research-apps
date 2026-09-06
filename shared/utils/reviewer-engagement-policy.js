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
 *   - `updateLifecycle`'s later "refuse to leave a closed status" guard and
 *     `softDelete`'s terminal guard - both status-only, now
 *     `isClosedEngagementStatus`.
 * The two status-only sites deliberately do NOT use the completedat-aware
 * row predicate: pre-Stage-2 they only ever inspected `wmkf_reviewstatus`,
 * never `wmkf_completedat`, even in `updateLifecycle` where `completedat` is
 * part of the same select - and `softDelete`'s select does not even fetch
 * `completedat`, so a completedat-aware check there would silently always
 * see `undefined`. Switching either site to the row predicate would add a
 * completedat check that was never there, a behavior change outside this
 * refactor's scope. This module preserves that split instead of collapsing
 * it.
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

import { REVIEW_STATUS_MAP } from '../config/reviewerLifecycle.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../config/reviewerStatus.js';

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
 * `wmkf_completedat` - for the two call sites that never checked completedat
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
