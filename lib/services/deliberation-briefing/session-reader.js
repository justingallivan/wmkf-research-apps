/**
 * Deliberation session seam for the briefing page.
 *
 * The PC Meeting Tracker (docs/PC_MEETING_TRACKER_PLAN.md §5.4) will export
 * `getDeliberationScheduleByRequests(requestIds)` from
 * `lib/services/meeting-tracker/schedule-reader.js`. Until that module lands
 * on main this seam returns null for every request, and the page reads
 * "Session not yet scheduled". Wire the real reader here, keep the
 * null-on-fail-open behavior, and delete this comment.
 */
export async function getDeliberationSessionForRequest(_requestId) {
  return null;
}
