import { requireAppAccess } from '../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../lib/utils/actor-ref';
import { isGuid } from '../../../../lib/utils/guid';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  moveDeliberationSlot,
  removeDeliberationSlot,
  updateDeliberationSlot,
} from '../../../../lib/services/meeting-tracker/slot-service';
import { isMeetingTrackerSchemaReady } from '../../../../shared/config/meetingTracker';

const PATCH_FIELDS = new Set([
  'etag', 'order', 'minutes', 'notes', 'leadPdId', 'targetSessionId', 'actingUserSystemId',
]);
const DELETE_FIELDS = new Set(['etag', 'actingUserSystemId']);

function exactBody(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => allowed.has(key));
}

export default async function handler(req, res) {
  if (!['PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  const slotId = Array.isArray(req.query.id) ? '' : req.query.id;
  if (!isGuid(slotId || '')) {
    return res.status(400).json({ error: 'A valid slot id is required.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  const allowed = req.method === 'PATCH' ? PATCH_FIELDS : DELETE_FIELDS;
  if (!exactBody(req.body, allowed)) {
    return res.status(400).json({ error: 'The slot request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-slot', async () => {
    try {
      const { actingUserSystemId: _ignored, ...input } = req.body;
      const actor = { actingUserSystemId: actorRefFromSession(access.session) };
      if (req.method === 'DELETE') {
        return res.status(200).json(await removeDeliberationSlot({ slotId, ...input }, actor));
      }
      const operation = input.targetSessionId === undefined
        ? updateDeliberationSlot
        : moveDeliberationSlot;
      return res.status(200).json(await operation({ slotId, ...input }, actor));
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker slot error:', error);
      return res.status(500).json({ error: 'Failed to update the session schedule.' });
    }
  });
}
