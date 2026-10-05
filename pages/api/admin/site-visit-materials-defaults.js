/**
 * GET/PUT applicant materials defaults. Superuser only; each PUT saves exactly
 * one setting so independent editors cannot overwrite each other.
 */
import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getUploadMaxMb, setUploadMaxMb } from '../../../lib/services/site-visit-materials/upload-cap';
import { getDueBusinessDays, setDueBusinessDays } from '../../../lib/services/site-visit-materials/due-date-setting';
import { SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_LIMITS, SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_DEFAULT, SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT } from '../../../shared/config/siteVisitMaterials';

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
        const dueDays = await getDueBusinessDays();
        return res.status(200).json({ success: true, ...cap, ...dueDays, dueDaysLimits: SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_LIMITS, defaultDueBusinessDays: SITE_VISIT_MATERIALS_DUE_BUSINESS_DAYS_DEFAULT, limits: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, defaultMb: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT });
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 1 || !['maxMb', 'dueBusinessDays'].includes(Object.keys(req.body)[0])) {
        return res.status(400).json({ error: 'The request body must contain exactly one of maxMb or dueBusinessDays.' });
      }
      if ('dueBusinessDays' in req.body) {
        const dueDays = await setDueBusinessDays(req.body.dueBusinessDays, { updatedBy: gate.profileId });
        return res.status(200).json({ success: true, ...dueDays });
      }
      const cap = await setUploadMaxMb(req.body.maxMb, { updatedBy: gate.profileId });
      return res.status(200).json({ success: true, ...cap, limits: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_LIMITS, defaultMb: SITE_VISIT_MATERIALS_UPLOAD_MAX_MB_DEFAULT });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('admin site visit materials defaults error:', error);
      return res.status(500).json({ error: 'The materials settings operation failed.' });
    }
  });
}
