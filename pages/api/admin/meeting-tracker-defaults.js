/**
 * Superuser editor for the Meeting Tracker default attendee list (D10, the
 * fixed staff list every new deliberation session starts with).
 *
 * GET returns the current default refs, their resolved names, and the eligible
 * staff directory. PUT replaces the list with staff references only; the
 * setting is validated against the live directory before it is written.
 */
import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getDefaultMeetingAttendees,
  getMeetingTrackerRecipientDirectory,
  writeDefaultMeetingAttendees,
} from '../../../lib/services/meeting-tracker/attendee-service';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('admin meeting tracker defaults error:', error);
  return res.status(500).json({ error: 'The default attendee operation failed.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  return withDalContext('admin-meeting-tracker-defaults', async () => {
    try {
      if (req.method === 'GET') {
        const [directory, defaults] = await Promise.all([
          getMeetingTrackerRecipientDirectory(),
          getDefaultMeetingAttendees(),
        ]);
        return res.status(200).json({
          success: true,
          staff: directory.staff,
          defaultAttendeeRefs: defaults.refs.attendees,
          defaultAttendees: defaults.attendees,
          notice: defaults.notice,
        });
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !Array.isArray(req.body.attendees)) {
        return res.status(400).json({ error: 'The request body must contain only an attendees array.' });
      }
      const result = await writeDefaultMeetingAttendees({ attendees: req.body.attendees }, { updatedBy: gate.profileId });
      return res.status(200).json({ success: true, defaultAttendeeRefs: result.refs.attendees, defaultAttendees: result.attendees });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
