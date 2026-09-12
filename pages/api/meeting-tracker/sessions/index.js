import { requireAppAccess } from '../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  createDeliberationSession,
  listDeliberationSessions,
} from '../../../../lib/services/meeting-tracker/session-service';
import { isMeetingTrackerSchemaReady } from '../../../../shared/config/meetingTracker';

const CREATE_FIELDS = new Set([
  'scheduledStartIso', 'scheduledEndIso', 'ianaTimeZone', 'location',
  'meetingLink', 'notes', 'status', 'attendees',
]);

function exactBody(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => allowed.has(key));
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
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
  if (req.method === 'POST' && !exactBody(req.body, CREATE_FIELDS)) {
    return res.status(400).json({ error: 'The session request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-sessions', async () => {
    try {
      if (req.method === 'GET') {
        return res.status(200).json(await listDeliberationSessions());
      }
      const input = req.body;
      const body = await createDeliberationSession(input, {
        actingUserSystemId: actorRefFromSession(access.session),
      });
      return res.status(201).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker sessions error:', error);
      return res.status(500).json({ error: 'Failed to save the meeting session.' });
    }
  });
}
