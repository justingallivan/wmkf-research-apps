/** GET: redirect staff to the approved presentation video for a Request (Workbench Staff deliberations). */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { resolveStaffPresentationVideo } from '../../../../lib/services/post-presentation-materials/presentation-page-service';

function unavailable(res, status = 404, reason = 'not_found') {
  return res.status(status).json({ ok: false, reason });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return unavailable(res, 405, 'method_not_allowed');
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return unavailable(res, 400, 'invalid_request');
  try {
    const { redirectUrl } = await withDalContext('workbench-presentation-video', () =>
      resolveStaffPresentationVideo({ requestId }));
    return res.redirect(302, redirectUrl);
  } catch (error) {
    if (error instanceof ServiceHttpError) return unavailable(res, error.httpStatus === 404 ? 404 : error.httpStatus);
    console.error('[workbench presentation video] failed:', error?.message || error);
    return unavailable(res, 500, 'server_error');
  }
}
