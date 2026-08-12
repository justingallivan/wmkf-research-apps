/**
 * Strict YYYY-MM-DD calendar-date helpers for Dataverse DateOnly columns
 * (e.g. the reviewer-engagement `wmkf_reviewduedate`). Centralized so the
 * invite send path, the render/token path, and the campaign-config editor
 * all agree on what a valid date string is.
 */

/**
 * True iff `value` is a syntactically valid YYYY-MM-DD string for a real
 * calendar date. Rejects malformed strings and impossible dates (2026-02-31).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const FOUNDATION_TIME_ZONE = 'America/Los_Angeles';

/**
 * Convert a wall-clock instant to a strict calendar date in the Foundation's
 * operating timezone. `formatToParts` avoids relying on locale-specific string
 * ordering while keeping DateOnly validation stable around UTC midnight.
 *
 * @param {Date} [date]
 * @param {string} [timeZone]
 * @returns {string} strict YYYY-MM-DD
 */
export function currentYmdInTimeZone(
  date = new Date(),
  timeZone = FOUNDATION_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * True only for a real DateOnly value that is today or later in the
 * Foundation's operating timezone.
 *
 * @param {unknown} value
 * @param {{ now?: Date, timeZone?: string }} [options]
 * @returns {boolean}
 */
export function isCurrentOrFutureYmd(value, {
  now = new Date(),
  timeZone = FOUNDATION_TIME_ZONE,
} = {}) {
  return isYmd(value) && value >= currentYmdInTimeZone(now, timeZone);
}
