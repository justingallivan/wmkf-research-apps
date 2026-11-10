// model-override-warming:ignore reason=scoring-save-writes-a-status-and-does-not-resolve-an-LLM-model
import { requireAppAccess, actorRefFromSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { saveScoring, saveChairsRecommendation } from '../../../lib/services/workbench/scoring-service';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const { decision, version, stage = 'scoring' } = req.body ?? {};
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if ((decision !== 'yes' && decision !== 'no') || typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
    return res.status(400).json({ error: 'A Yes/No decision and request version are required' });
  }

  if (stage !== 'scoring' && stage !== 'chairs-recommendation') {
    return res.status(400).json({ error: 'Invalid Phase I decision stage' });
  }
  const save = stage === 'chairs-recommendation' ? saveChairsRecommendation : saveScoring;
  const label = stage === 'chairs-recommendation' ? 'the recommendation to Chairs' : 'the scoring decision';

  return withDalContext('workbench-scoring', async () => {
    try {
      const result = await save({
        requestId, decision, version, profileId: access.profileId,
        callerSystemId: actorRefFromSession(access.session),
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      console.error('Workbench Phase I decision save failed:', error);
      return res.status(500).json({ error: `Could not save ${label}. Refresh the request before trying again.` });
    }
  });
}
