/** Prepare an exact frozen Word/PDF distribution preview without sending. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { preparePreSiteDistribution } from '../../../../../lib/services/pre-site-visit/distribution-service';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' }, responseLimit: false },
  maxDuration: 300,
};

const ALLOWED = new Set([
  'requestId', 'expectedArtifactId', 'operationId', 'attachmentMode',
  'to', 'cc', 'subject', 'bodyText', 'includeCalendar', 'siteVisitId',
  'selectedMaterialIds',
]);

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('workbench pre-site distribution prepare error:', error);
  return res.status(500).json({ error: 'The frozen distribution preview could not be prepared.' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !ALLOWED.has(key))) {
    return res.status(400).json({ error: 'The preview request contains unsupported fields.' });
  }
  const fromEmail = String(access.session?.user?.azureEmail || '').trim().toLowerCase();
  if (!fromEmail) return res.status(400).json({ error: 'Your account has no sending email address.' });

  return withDalContext('workbench-pre-site-distribution-prepare', async () => {
    try {
      const result = await preparePreSiteDistribution({
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
