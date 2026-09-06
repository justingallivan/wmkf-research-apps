// @ts-check
/**
 * True when `meetingDate` (any Date-parseable value) is strictly before the
 * ISO cutoff instant. `null`/`undefined`/unparseable dates are never past the
 * cutoff (return false), so a missing meeting date can never make a row
 * eligible for expiry. Used by the stale-invitation sweep's discovery pass and
 * by `reviewer-engagement/expire-invitation.js`'s per-row revalidation
 * (moved here from that module 2026-09-06, S490 hygiene).
 *
 * @param {unknown} meetingDate
 * @param {string} cutoffIso
 * @returns {boolean}
 */
export function isPastCutoff(meetingDate, cutoffIso) {
  if (!meetingDate) return false;
  const millis = new Date(/** @type {any} */ (meetingDate)).getTime();
  return Number.isFinite(millis) && new Date(millis).toISOString() < cutoffIso;
}
