import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getInitialAssessmentRationale, saveInitialAssessmentRationale,
} from '../../../lib/services/workbench/initial-assessment-rationale-service';
import { rationaleFieldReady } from '../../../lib/utils/workbench-field-readiness';
import { phaseRouteAdmitted } from '../../../lib/services/workbench/phase-admission';

const UNAVAILABLE = 'Staff rationale is unavailable.';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  if (!rationaleFieldReady()) return res.status(404).json({ error: UNAVAILABLE });

  const requestId = req.method === 'GET' ? req.query.requestId : req.body?.requestId;
  if (typeof requestId !== 'string' || !isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  // One admission policy with the request page (phase-admission.js), on every call.
  const admitted = () => phaseRouteAdmitted(requestId, rationaleFieldReady);
  if (!(await admitted())) return res.status(404).json({ error: UNAVAILABLE });
  return withDalContext('workbench-initial-assessment-rationale', async () => {
    try {
      if (req.method === 'GET') return res.status(200).json(await getInitialAssessmentRationale(requestId));
      const actor = actorRefFromSession(access.session);
      if (!isGuid(actor)) return res.status(403).json({ error: 'A mapped staff identity is required.' });
      if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Staff-attributed saves are unavailable.' });
      }
      const { rationale, version } = req.body;
      if (typeof rationale !== 'string' || rationale.length > 10000
          || typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
        return res.status(400).json({ error: 'A valid rationale and request version are required.' });
      }
      await saveInitialAssessmentRationale({ requestId, rationale: rationale.trim(), version, actor, beforeWrite: async () => {
        if (!(await admitted())) throw new ServiceHttpError(UNAVAILABLE, { httpStatus: 404 });
      } });
      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      console.error('Workbench staff rationale failed:', error);
      return res.status(500).json({ error: 'Staff rationale could not be accessed.' });
    }
  });
}
