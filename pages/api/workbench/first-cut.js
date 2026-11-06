import { requireAppAccess, actorRefFromSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { saveFirstCut } from '../../../lib/services/workbench/first-cut-service';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const { decision, version } = req.body ?? {};
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if ((decision !== 'yes' && decision !== 'no') || typeof version !== 'string' || !/^W\/"[0-9]+"$/.test(version)) {
    return res.status(400).json({ error: 'A First Cut decision and request version are required' });
  }

  return withDalContext('workbench-first-cut', async () => {
    try {
      const result = await saveFirstCut({
        requestId, decision, version, profileId: access.profileId,
        callerSystemId: actorRefFromSession(access.session),
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      console.error('Workbench First Cut save failed:', error);
      return res.status(500).json({ error: 'Could not save First Cut. Refresh the request before trying again.' });
    }
  });
}
