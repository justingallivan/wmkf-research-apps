/** Read durable frozen-distribution attempts for one Workbench request. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { getPreSiteDistributionHistory } from '../../../../../lib/services/pre-site-visit/distribution-service';

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('workbench pre-site distribution history error:', error);
  return res.status(500).json({ error: 'Distribution history could not be loaded.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  return withDalContext('workbench-pre-site-distribution-history', async () => {
    try {
      const result = await getPreSiteDistributionHistory({
        requestId: String(req.query?.requestId || '').trim(),
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
