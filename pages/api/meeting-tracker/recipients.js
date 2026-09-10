import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { loadMeetingTrackerRecipientPicker } from '../../../lib/services/meeting-tracker/attendee-service';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  // Authenticated callers only learn whether the tracker is enabled (review finding 6).
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }

  return withDalContext('meeting-tracker-recipients', async () => {
    try {
      return res.status(200).json(await loadMeetingTrackerRecipientPicker());
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker recipients error:', error);
      return res.status(500).json({ error: 'Failed to load meeting attendees.' });
    }
  });
}
