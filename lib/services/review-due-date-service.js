/**
 * Review due date from the cycle calendar (alignment log D48; build plan
 * docs/plans/REVIEWER_INVITATION_CALENDAR_BUILD_PLAN_2026-10-29.md §3.1).
 *
 * A request's review due date is `akoya_request.wmkf_reviewduedate`, which
 * every downstream consumer reads (links, reminders, portal, extensions). It is
 * filled once, from the calendar's Reviews Due Date for the request's own cycle,
 * before the request's first invitation goes out, and then stays fixed: a later
 * calendar change does not move a date reviewers were already promised (D48).
 *
 * The cycle is the Grant Cycle row the request links to in Dynamics
 * (`akoya_request.wmkf_grantcycle`; alignment log T10), never the request's
 * meeting date and never a client-supplied code. A request with no Grant Cycle
 * link, a blank calendar date or an unreadable calendar refuses the invitation;
 * there is no fallback to the meeting date, the Admin defaults or the browser
 * (owner, 2026-10-29).
 */

import { getCycleDatesById } from '../dataverse/adapters/operations-grant-cycle.js';
import { getById as getRequestById, updateById as updateRequestById } from '../dataverse/adapters/grant-request.js';
import { isYmd } from '../utils/date-ymd.js';
import { CYCLE_CALENDAR_MEANINGS, dateOnly } from '../../shared/config/cycleCalendar.js';

const CALENDAR_TIMEOUT_MS = 10_000;

const DEFAULTS = {
  readCycleDates: getCycleDatesById,
  readRequest: getRequestById,
  writeRequest: updateRequestById,
};

/** Staff-facing explanation for each refusal reason. */
export const REVIEW_DUE_DATE_PROBLEMS = Object.freeze({
  no_grant_cycle: 'This proposal has no Grant Cycle in Dynamics, so its review due date is unknown.',
  cycle_missing: 'This proposal\'s Grant Cycle is not on the cycle calendar.',
  reviews_due_missing: 'Set the Reviews Due Date on the cycle calendar first.',
  calendar_unavailable: 'The cycle calendar could not be read. Try again in a minute.',
  save_failed: 'The review due date could not be saved on the proposal. Nothing was sent; try again.',
});

/**
 * The cycle calendar's Reviews Due Date on one Grant Cycle row.
 * @param {string} grantCycleId `wmkf_grantcycleid` the request links to
 * @returns {Promise<{ ok: true, date: string } | { ok: false, reason: string }>}
 */
export async function getCalendarReviewsDue(grantCycleId, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  let row;
  try {
    row = await d.readCycleDates(grantCycleId, { timeoutMs: CALENDAR_TIMEOUT_MS });
  } catch {
    return { ok: false, reason: 'calendar_unavailable' };
  }
  if (!row) return { ok: false, reason: 'cycle_missing' };
  const date = dateOnly(row[CYCLE_CALENDAR_MEANINGS.reviewsDue]);
  return date ? { ok: true, date } : { ok: false, reason: 'reviews_due_missing' };
}

/**
 * The date an invitation for this request will promise: the stored request date
 * when present, else the calendar date the first invitation will store.
 * Read-only.
 */
export async function resolveRequestReviewDueDate(request, overrides = {}) {
  if (isYmd(request?.wmkf_reviewduedate)) return { ok: true, date: request.wmkf_reviewduedate, source: 'request' };
  const grantCycleId = request?._wmkf_grantcycle_value;
  if (!grantCycleId) return { ok: false, reason: 'no_grant_cycle' };
  const calendar = await getCalendarReviewsDue(grantCycleId, overrides);
  return calendar.ok ? { ok: true, date: calendar.date, source: 'calendar' } : calendar;
}

/**
 * Make sure the request has its stored review due date before any invitation
 * is dispatched. A blank date is filled from the calendar with an ETag
 * conditional write; when another send fills it first (412), the date that won
 * is re-read and used. Anything short of a confirmed stored date refuses.
 *
 * `request` must carry `akoya_requestid`, `_wmkf_grantcycle_value`,
 * `wmkf_reviewduedate` and `_etag`. It is not mutated.
 */
export async function ensureRequestReviewDueDate(request, { actingUserSystemId } = {}, overrides = {}) {
  const d = { ...DEFAULTS, ...overrides };
  const resolved = await resolveRequestReviewDueDate(request, d);
  if (!resolved.ok || resolved.source === 'request') return resolved;
  if (!request?._etag) return { ok: false, reason: 'save_failed' };
  try {
    await d.writeRequest(request.akoya_requestid, { wmkf_reviewduedate: resolved.date }, {
      ifMatch: request._etag,
      actingUserSystemId,
    });
    return { ok: true, date: resolved.date, source: 'calendar', saved: true };
  } catch (error) {
    if (error?.status !== 412) return { ok: false, reason: 'save_failed' };
  }
  let fresh;
  try {
    fresh = await d.readRequest(request.akoya_requestid, { select: 'akoya_requestid,wmkf_reviewduedate' });
  } catch {
    return { ok: false, reason: 'save_failed' };
  }
  return isYmd(fresh?.wmkf_reviewduedate)
    ? { ok: true, date: fresh.wmkf_reviewduedate, source: 'request' }
    : { ok: false, reason: 'save_failed' };
}
