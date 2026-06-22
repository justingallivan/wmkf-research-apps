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
