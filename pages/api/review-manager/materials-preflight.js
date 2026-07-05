/**
 * Review Manager — reviewer-materials preflight (SharePoint download-folder guard)
 *
 * GET /api/review-manager/materials-preflight?requestId=<GUID>
 *   → { ok: true, fileCount: N }
 *   → { ok: false, reason: 'materials_unavailable' }   (sanitized — upstream listing/lookup failed)
 *
 * Lets `ReviewerManagePanel`'s "materials" release email warn the PD before sending when the
 * reviewer-visible SharePoint folder for this request is empty — a reviewer who follows the
 * portal link would find nothing to download.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. Lookup + folder listing (reusing
 * `listReviewerMaterials` so the count agrees with the external portal) live
 * in lib/services/review-manager/materials-preflight-service.js. Untyped
 * service failures map to the SANITIZED 200 materials_unavailable envelope,
 * never a 500 with upstream detail.
 *
 * Auth: same staff-shared boundary as the rest of Review Manager — requireAppAccess
 * ('review-manager','reviewers') + withDalContext. requestId is GUID-validated
 * before it reaches a Dataverse selector (trust-boundary-guid).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { materialsPreflight } from '../../../lib/services/review-manager/materials-preflight-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const { requestId } = req.query;
  if (!requestId || typeof requestId !== 'string' || !isGuid(requestId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['requestId must be a valid GUID.'] });
  }

  return withDalContext('review-manager-materials-preflight', async () => {
    try {
      const result = await materialsPreflight({ requestId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      // Sanitized — never forward raw Graph/Dataverse error detail to the client.
      console.error('[materials-preflight] lookup/listing failed:', error?.message);
      return res.status(200).json({ ok: false, reason: 'materials_unavailable' });
    }
  });
}
