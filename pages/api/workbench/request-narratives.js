import { requireAppAccess, actorRefFromSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { readRequestNarratives, saveRequestNarratives } from '../../../lib/services/workbench/request-narratives-service';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  res.setHeader('Cache-Control', 'no-store');
  const requestId = req.method === 'GET' ? req.query.requestId : req.body?.requestId;
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  return withDalContext('workbench-request-narratives', async () => {
    try {
      const identity = { requestId, profileId: access.profileId, callerSystemId: actorRefFromSession(access.session) };
      const result = req.method === 'GET'
        ? await readRequestNarratives(identity)
        : await saveRequestNarratives({ ...identity, version: req.body?.version, changes: req.body?.changes });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      // No request text or provider bodies in logs/responses.
      console.error('Request narrative operation failed', { status: error?.status });
      return res.status(503).json({ error: 'Request text is unavailable. Check that the Request narrative fields are provisioned, then reload before retrying.' });
    }
  });
}
