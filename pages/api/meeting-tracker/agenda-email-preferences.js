/** Own-sender raw agenda wording; independent of shared-setting availability. */
import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker';
import { getAgendaPreferences, saveAgendaPreference, clearAgendaPreference } from '../../../lib/services/meeting-tracker/agenda-personalization';
export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };
export default async function handler(req, res) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, PUT, DELETE'); return res.status(405).json({ ok: false, reason: 'method_not_allowed' }); }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) return res.status(503).json({ ok: false, reason: 'meeting_tracker_schema_not_ready' });
  const ownSystemId = actorRefFromSession(access.session);
  if (!isGuid(ownSystemId)) return res.status(503).json({ ok: false, reason: 'identity_unavailable' });
  if (Object.keys(req.query || {}).length || (req.method !== 'GET' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => req.method === 'DELETE' || key !== 'template')))) return res.status(400).json({ ok: false, reason: 'validation' });
  return withDalContext('meeting-tracker-agenda-email-preferences', async () => {
    try {
      if (req.method !== 'GET') {
        const result = req.method === 'PUT' ? await saveAgendaPreference(ownSystemId, req.body.template) : await clearAgendaPreference(ownSystemId);
        if (!result.ok) return res.status(result.reason === 'validation' ? 400 : result.reason === 'preference_invalid' ? 409 : 503).json(result);
      }
      const data = await getAgendaPreferences(ownSystemId);
      // A confirmed write remains confirmed even if the following read fails.
      const status = req.method === 'GET' ? data.defaults.personalStatus === 'invalid' ? 409 : data.defaults.personalStatus === 'unavailable' ? 503 : 200 : 200;
      return res.status(status).json({ ok: status === 200, ...data });
    } catch { return res.status(503).json({ ok: false, reason: 'preference_unavailable' }); }
  });
}
