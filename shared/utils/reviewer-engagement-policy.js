/**
 * Reviewer engagement policy - shared, browser-safe predicates over a raw
 * wmkf_appreviewersuggestion row's `wmkf_reviewstatus` (Dataverse option
 * integer) and `wmkf_completedat`.
 *
 * Two callers (`lib/services/reviewer-finder/my-candidates-service.js` and
 * `lib/dataverse/adapters/reviewer-suggestion.js` `updateLifecycle`) each
 * classified a raw row the same way before allowing an invitation-response
 * correction. This module is the single source of that classification so
 * the two copies cannot drift. It imports ONLY from `shared/config/` -
 * never from `lib/` - so it stays safe to import from browser-facing code.
 *
 * Raw-row input only (no DTO variant): both existing callers read a fresh
 * row via an explicit Dataverse select and pass it straight in.
 */

import { REVIEW_STATUS_MAP } from '../config/reviewerLifecycle.js';
import { TERMINAL_REVIEW_STATUS_VALUES } from '../config/reviewerStatus.js';

// Statuses from which an invitation-response correction is still allowed.
// `null` is included because a fresh, never-invited row carries a null
// wmkf_reviewstatus. `undefined` is deliberately NOT a member: today's
// `Set.has(undefined)` on the equivalent local sets returns `false`, and both
// callers read the field via an explicit select so it is always present
// (`null`) or populated - never `undefined` in practice.
export const INVITATION_CORRECTION_SOURCE_STATUSES = new Set([
  null,
  REVIEW_STATUS_MAP.accepted,
  REVIEW_STATUS_MAP.materials_sent,
  REVIEW_STATUS_MAP.under_review,
  REVIEW_STATUS_MAP.review_received,
]);

// Statuses at which an engagement is closed (durable history) regardless of
// wmkf_completedat.
export const CLOSED_ENGAGEMENT_STATUSES = new Set([
  REVIEW_STATUS_MAP.complete,
  ...Object.values(TERMINAL_REVIEW_STATUS_VALUES),
]);

/**
 * True when the row's engagement is closed: either a completion timestamp is
 * stamped, or the status is one of the closed/terminal statuses.
 */
export function isClosedEngagementRow(row) {
  return Boolean(row?.wmkf_completedat) || CLOSED_ENGAGEMENT_STATUSES.has(row?.wmkf_reviewstatus);
}

/**
 * True when the row's status is a valid source state for an
 * invitation-response correction. `null` is a member of the source set (a
 * never-invited row); `undefined` deliberately is NOT, so an absent field
 * returns `false` here, matching the pre-refactor local sets this module
 * replaced. Do not normalise `undefined` to `null` before this lookup - that
 * would flip this case to `true`.
 */
export function isInvitationCorrectionSourceRow(row) {
  return INVITATION_CORRECTION_SOURCE_STATUSES.has(row?.wmkf_reviewstatus);
}
