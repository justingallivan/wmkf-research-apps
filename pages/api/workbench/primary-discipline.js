import { requireAppAccess, actorRefFromSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { readPrimaryDiscipline, savePrimaryDiscipline } from '../../../lib/services/workbench/primary-discipline-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

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
  return withDalContext('workbench-primary-discipline', async () => {
    try {
      const callerSystemId = actorRefFromSession(access.session);
      const result = req.method === 'GET'
        ? await readPrimaryDiscipline({ requestId, callerSystemId, withOptions: req.query.options === '1' })
        : await savePrimaryDiscipline({ requestId, callerSystemId, version: req.body?.version, disciplineId: req.body?.disciplineId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message });
      if ([401, 403].includes(error?.status)) return res.status(403).json({ error: 'Your staff identity does not have permission to change this request.' });
      console.error('Primary discipline operation failed', { status: error?.status });
      return res.status(503).json({ error: 'The primary discipline is unavailable right now. Reload before trying again.' });
    }
  });
}
