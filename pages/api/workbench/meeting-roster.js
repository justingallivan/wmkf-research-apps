import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  readMeetingRoster, saveMeetingRoster,
} from '../../../lib/services/workbench/meeting-roster-service';
import { rosterFieldReady } from '../../../lib/utils/workbench-field-readiness';
import { phaseRouteAdmitted } from '../../../lib/services/workbench/phase-admission';

const UNAVAILABLE = 'Meeting roster is unavailable.';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  if (!rosterFieldReady()) return res.status(404).json({ error: UNAVAILABLE });

  const requestId = req.method === 'GET' ? req.query.requestId : req.body?.requestId;
  if (typeof requestId !== 'string' || !isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  // One admission policy with the request page (phase-admission.js), on every call.
  const admitted = () => phaseRouteAdmitted(requestId, rosterFieldReady);
  if (!(await admitted())) return res.status(404).json({ error: UNAVAILABLE });
  return withDalContext('workbench-meeting-roster', async () => {
    try {
      if (req.method === 'GET') {
        const result = await readMeetingRoster(requestId, { suggest: req.query.suggest === 'yes' });
        return res.status(200).json(result);
      }
      const actor = actorRefFromSession(access.session);
      if (!isGuid(actor)) return res.status(403).json({ error: 'A mapped staff identity is required.' });
      if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Staff-attributed saves are unavailable.' });
      }
      const { visitId, version, binding, wmkf, consultants } = req.body ?? {};
      if (typeof visitId !== 'string' || !isGuid(visitId)
          || typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)
          || typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
        return res.status(400).json({ error: 'A valid presentation, occurrence and row version are required.' });
      }
      await saveMeetingRoster({ requestId, visitId, version, binding, wmkf, consultants, actor, beforeWrite: async () => {
        if (!(await admitted())) throw new ServiceHttpError(UNAVAILABLE, { httpStatus: 404 });
      } });
      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      console.error('Workbench meeting roster failed:', error);
      return res.status(500).json({ error: 'Meeting roster could not be accessed.' });
    }
  });
}
