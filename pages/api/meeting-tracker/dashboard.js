import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { loadMeetingTrackerDashboard } from '../../../lib/services/meeting-tracker/dashboard-service';
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
  const azureEmail = access.session?.user?.azureEmail;
  if (!azureEmail) {
    return res.status(400).json({ error: 'Could not determine your email from the session. Sign out and back in.' });
  }
  const { cycleCode, programId } = req.query;
  if (Array.isArray(cycleCode) || Array.isArray(programId)
    || (programId && !isGuid(programId))) {
    return res.status(400).json({ error: 'Cycle and program filters must be single valid values.' });
  }

  return withDalContext('meeting-tracker-dashboard', async () => {
    try {
      const body = await loadMeetingTrackerDashboard({
        azureEmail,
        profileId: access.profileId,
        callerSystemId: actorRefFromSession(access.session),
        cycleCode,
        scope: req.query.scope === 'all' ? 'all' : 'my',
        includeSetAside: false,
        programId,
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('meeting tracker dashboard error:', error);
      return res.status(500).json({ error: 'Failed to load Meeting Tracker.' });
    }
  });
}
