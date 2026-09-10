import { requireAppAccess } from '../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../lib/utils/actor-ref';
import { isGuid } from '../../../../lib/utils/guid';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  getDeliberationSession,
  updateDeliberationSession,
} from '../../../../lib/services/meeting-tracker/session-service';
import { isMeetingTrackerSchemaReady } from '../../../../shared/config/meetingTracker';

const PATCH_FIELDS = new Set([
  'etag', 'scheduledStartIso', 'scheduledEndIso', 'ianaTimeZone', 'location',
  'meetingLink', 'notes', 'status', 'attendees',
]);

function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => PATCH_FIELDS.has(key));
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const sessionId = Array.isArray(req.query.id) ? '' : req.query.id;
  if (!isGuid(sessionId || '')) {
    return res.status(400).json({ error: 'A valid session id is required.' });
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
  if (req.method === 'PATCH' && !exactBody(req.body)) {
    return res.status(400).json({ error: 'The session request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-session', async () => {
    try {
      if (req.method === 'GET') {
        return res.status(200).json(await getDeliberationSession({ sessionId }));
      }
      const patch = req.body;
      const body = await updateDeliberationSession(
        { sessionId, ...patch },
        { actingUserSystemId: actorRefFromSession(access.session) },
      );
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker session error:', error);
      return res.status(500).json({ error: 'Failed to load or save the meeting session.' });
    }
  });
}
