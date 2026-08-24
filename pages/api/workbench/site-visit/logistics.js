/** GET/PATCH the single active Site Visit logistics activity for a Request. */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  getSiteVisitLogistics,
  saveSiteVisitLogistics,
} from '../../../../lib/services/site-visit/logistics-service';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
  maxDuration: 60,
};

const PATCH_KEYS = new Set([
  'requestId',
  'activityId',
  'etag',
  'subject',
  'description',
  'startLocal',
  'endLocal',
  'timeZone',
  'disambiguation',
  'format',
  'locationOrLink',
  'organizer',
  'requiredAttendees',
  'optionalAttendees',
]);

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body || {
      error: error.message,
      code: error.code || 'site_visit_logistics_failed',
    });
  }
  console.error('workbench Site Visit logistics error:', error);
  return res.status(500).json({ error: 'Site Visit logistics could not be processed.' });
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-site-visit-logistics', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const result = await getSiteVisitLogistics({ requestId });
        return res.status(200).json({ success: true, ...result });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => !PATCH_KEYS.has(key))) {
        return res.status(400).json({ error: 'PATCH body contains unsupported fields.' });
      }
      const result = await saveSiteVisitLogistics(req.body, {
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
