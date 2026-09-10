/**
 * GET/PUT the applicant materials upload cap (plan §16 M3). Superuser only;
 * the value is a whole number of megabytes stored as an app system setting.
 */
import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getUploadMaxMb, setUploadMaxMb } from '../../../lib/services/site-visit-materials/upload-cap';
import { SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT } from '../../../shared/config/siteVisitMaterials';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  return withDalContext('admin-site-visit-materials-defaults', async () => {
    try {
      if (req.method === 'GET') {
        const cap = await getUploadMaxMb();
        return res.status(200).json({ success: true, ...cap, limits: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, defaultMb: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT });
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !('maxMb' in req.body)) {
        return res.status(400).json({ error: 'The request body must contain only maxMb.' });
      }
      const cap = await setUploadMaxMb(req.body.maxMb, { updatedBy: gate.profileId });
      return res.status(200).json({ success: true, ...cap, limits: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, defaultMb: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('admin site visit materials defaults error:', error);
      return res.status(500).json({ error: 'The upload cap operation failed.' });
    }
  });
}
