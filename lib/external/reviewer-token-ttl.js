/**
 * Reviewer-engagement §3.D token-TTL policy.
 *
 * The external-reviewer magic-link expiry is no longer a flat 90 days. It is keyed on
 * ACCEPTED status (NOT templateType): only an accepted reviewer ever gets the long-lived
 * review-window token; everyone else (a fresh invitee, a non-responder, the Phase-3
 * respond reminder) gets the early cap so an unused invite link dies near the review-due
 * date. With no sane FUTURE review-due (null / malformed / past) we fall back to now + 90
 * days — never minting an already-expired or past-dated token (§6).
 *
 * Pure + dependency-free so render-emails can call it per recipient and unit tests can
 * exercise the policy without the route's Dataverse/email module graph.
 */

import { isYmd } from '../utils/date-ymd.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOKEN_CAP_GRACE_DAYS = 2;      // non-responder link dies at review-due + this grace
export const TOKEN_LONG_WINDOW_DAYS = 90;   // an ACCEPTED reviewer keeps ~90 days past review-due
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
