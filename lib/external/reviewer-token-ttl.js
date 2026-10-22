/**
 * Reviewer-engagement §3.D token-TTL policy.
 *
 * The external-reviewer magic-link expiry is no longer a flat 90 days. It is keyed on
 * ACCEPTED status (NOT templateType): an accepted reviewer gets the review-due end
 * timestamp (23:59:59 UTC) + 90 days; a fresh invitee or non-responder gets that same
 * timestamp + 2 days. With no sane FUTURE review-due (null / malformed / past), either
 * status falls back to now + 90 days — never minting an already-expired or past-dated
 * token (§6). Portal acceptance by itself does not mint or replace the invitation token;
 * a later link-bearing email send may issue a new token.
 *
 * Pure + dependency-free so token-mint callers and unit tests can apply the policy
 * without the route's Dataverse/email module graph.
 */

import { isYmd } from '../utils/date-ymd.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOKEN_CAP_GRACE_DAYS = 2;      // non-responder link dies at review-due + this grace
// Intentional operational cushion: accepted reviewers keep access through the
// Board meeting. Ordinary due-date extensions do not rotate an already-issued
// link when its signed expiry already covers the requested date; the extension
// route requires explicit replacement-link recovery otherwise.
export const TOKEN_LONG_WINDOW_DAYS = 90;
export const TOKEN_FALLBACK_TTL_DAYS = 90;  // no sane future review-due → prior behavior (now + 90)

/**
 * @param {Object} args
 * @param {boolean} args.accepted - whether the recipient has accepted (wmkf_accepted === true)
 * @param {string|null} args.reviewDueDate - effective reviewer deadline (YYYY-MM-DD) or null
 * @returns {Date} the token expiry
 */
export function computeReviewerTokenExpiry({ accepted, reviewDueDate }) {
  const now = Date.now();
  const dueMs = isYmd(reviewDueDate) ? Date.parse(`${reviewDueDate}T23:59:59Z`) : NaN;
  const hasSaneDue = Number.isFinite(dueMs) && dueMs > now;
  if (!hasSaneDue) return new Date(now + TOKEN_FALLBACK_TTL_DAYS * DAY_MS);
  const windowDays = accepted ? TOKEN_LONG_WINDOW_DAYS : TOKEN_CAP_GRACE_DAYS;
  return new Date(dueMs + windowDays * DAY_MS);
}
