/**
 * Resolve the operational review due date for one reviewer engagement.
 *
 * `wmkf_reviewduedateoverride` is nullable suggestion-level state. A valid
 * override wins; otherwise callers retain their existing request/cycle/send
 * fallback. Invalid persisted values fail closed to the fallback instead of
 * leaking a malformed date into email, portal, reminder, or token math.
 */

import { isYmd } from '../utils/date-ymd.js';

/**
 * @param {{ overrideDate?: unknown, defaultDate?: unknown }} args
 * @returns {string|null} strict YYYY-MM-DD or null
 */
export function resolveEffectiveReviewDueDate({ overrideDate, defaultDate } = {}) {
  if (isYmd(overrideDate)) return overrideDate;
  if (isYmd(defaultDate)) return defaultDate;
  return null;
}
