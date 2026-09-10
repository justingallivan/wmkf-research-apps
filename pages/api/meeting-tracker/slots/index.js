import { requireAppAccess } from '../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { addDeliberationSlot } from '../../../../lib/services/meeting-tracker/slot-service';
import { isMeetingTrackerSchemaReady } from '../../../../shared/config/meetingTracker';

const CREATE_FIELDS = new Set([
  'sessionId', 'requestId', 'order', 'minutes', 'notes', 'leadPdId', 'actingUserSystemId',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || !Object.keys(req.body).every((key) => CREATE_FIELDS.has(key))) {
    return res.status(400).json({ error: 'The slot request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-slot-create', async () => {
    try {
      const { actingUserSystemId: _ignored, ...input } = req.body;
      const body = await addDeliberationSlot(input, {
        actingUserSystemId: actorRefFromSession(access.session),
      });
      return res.status(201).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker slot create error:', error);
      return res.status(500).json({ error: 'Failed to add the proposal to the session.' });
    }
  });
}
