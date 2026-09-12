/**
 * Deliberation session seam for the briefing page.
 *
 * Reads the request's latest deliberation slot through the PC Meeting
 * Tracker's fixed reader contract (docs/PC_MEETING_TRACKER_PLAN.md §5.4).
 * Fail-open in both layers: the reader returns null while
 * `MEETING_TRACKER_SCHEMA_READY` is not literal `on` or when its Dataverse
 * read fails, and this seam also swallows any thrown error, so the page reads
 * "Session not yet scheduled" rather than failing the briefing.
 */
import { getDeliberationScheduleByRequests } from '../meeting-tracker/schedule-reader.js';

const DEFAULT_DEPENDENCIES = Object.freeze({
  getScheduleByRequests: getDeliberationScheduleByRequests,
});

/**
 * @param {string} requestId
 * @returns {Promise<object|null>} the §5.4 DeliberationSchedule for the request, or null
 */
export async function getDeliberationSessionForRequest(requestId, dependencies = DEFAULT_DEPENDENCIES) {
  if (!requestId) return null;
  try {
    const schedule = await dependencies.getScheduleByRequests([requestId]);
    return schedule?.get?.(requestId) ?? null;
  } catch {
    return null;
  }
}
