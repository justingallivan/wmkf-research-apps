/** Send one previously confirmed frozen distribution preview through Dynamics. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { sendPreSiteDistribution } from '../../../../../lib/services/pre-site-visit/distribution-service';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('workbench pre-site distribution send error:', error);
  return res.status(500).json({ error: 'The frozen distribution could not be sent.' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !['requestId', 'operationId', 'previewHash'].includes(key))) {
    return res.status(400).json({ error: 'POST body must contain only requestId, operationId, and previewHash.' });
  }
  const fromEmail = String(access.session?.user?.azureEmail || '').trim().toLowerCase();
  if (!fromEmail) return res.status(400).json({ error: 'Your account has no sending email address.' });

  return withDalContext('workbench-pre-site-distribution-send', async () => {
    try {
      const result = await sendPreSiteDistribution({
        ...req.body,
        fromEmail,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
