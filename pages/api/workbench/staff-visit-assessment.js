import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getStaffVisitAssessment, saveStaffVisitAssessment,
} from '../../../lib/services/workbench/staff-visit-assessment-service';
import { staffReviewSummaryEnabled } from '../../../lib/services/workbench/staff-review-summary-service';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  if (!staffReviewSummaryEnabled()) return res.status(404).json({ error: 'Staff presentation assessment is unavailable.' });

  const requestId = req.method === 'GET' ? req.query.requestId : req.body?.requestId;
  if (typeof requestId !== 'string' || !isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  return withDalContext('workbench-staff-visit-assessment', async () => {
    try {
      if (req.method === 'GET') return res.status(200).json(await getStaffVisitAssessment(requestId));
      const actor = actorRefFromSession(access.session);
      if (!isGuid(actor)) return res.status(403).json({ error: 'A mapped staff identity is required.' });
      if (process.env.DYNAMICS_IMPERSONATION_ENABLED !== 'true') {
        return res.status(503).json({ error: 'Staff-attributed saves are unavailable.' });
      }
      const { assessment, version } = req.body;
      if (typeof assessment !== 'string' || assessment.length > 10000
          || typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
        return res.status(400).json({ error: 'A valid assessment and request version are required.' });
      }
      await saveStaffVisitAssessment({ requestId, assessment: assessment.trim(), version, actor });
      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      console.error('Workbench staff visit assessment failed:', error);
      return res.status(500).json({ error: 'Staff presentation assessment could not be accessed.' });
    }
  });
}
