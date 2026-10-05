import * as grantRequestAdapter from '../../../../lib/dataverse/adapters/grant-request.js';
import { withDalContext } from '../../../../lib/dataverse/core/context.js';
import { requestPreparationRetry } from '../../../../lib/services/pre-site-visit/preparation-worker.js';
import { ServiceHttpError } from '../../../../lib/services/service-http-error.js';
import { getUserRole, requireAppAccess } from '../../../../lib/utils/auth.js';
import { isGuid } from '../../../../lib/utils/guid.js';
import { withTestRequestIsolationSelect } from '../../../../lib/services/test-requests/isolation.js';

const SELECT = withTestRequestIsolationSelect([
  'akoya_requestid', '_wmkf_programdirector_value', 'wmkf_istestrequest',
  'wmkf_testcreationrunid',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const isSuperuser = role === 'superuser';
  const callerSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => key !== 'requestId')) {
    return res.status(400).json({ error: 'POST body must contain only requestId.' });
  }
  const requestId = String(req.body.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID.' });

  return withDalContext('workbench-pre-site-visit-retry', async () => {
    try {
      const request = await grantRequestAdapter.getById(requestId, { select: SELECT });
      if (!request?.akoya_requestid) return res.status(404).json({ error: 'Request not found.' });
      const isLeadPd = request._wmkf_programdirector_value && callerSystemId
        && String(request._wmkf_programdirector_value).toLowerCase() === String(callerSystemId).toLowerCase();
      if (!isSuperuser && !isLeadPd) {
        return res.status(403).json({ error: 'Only the lead Program Director can retry preparation.' });
      }
      const result = await requestPreparationRetry(requestId);
      return res.status(202).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('workbench pre-site preparation retry failed:', error?.code || error?.message || 'unknown');
      return res.status(500).json({ error: 'Preparation retry could not be queued.' });
    }
  });
}
