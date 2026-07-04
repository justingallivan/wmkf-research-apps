/**
 * Review Manager — reviewer-materials preflight (SharePoint download-folder guard)
 *
 * GET /api/review-manager/materials-preflight?requestId=<GUID>
 *   → { ok: true, fileCount: N }
 *   → { ok: false, reason: 'materials_unavailable' }   (sanitized — upstream listing/lookup failed)
 *
 * Lets `ReviewerManagePanel`'s "materials" release email warn the PD before sending when the
 * reviewer-visible SharePoint folder for this request is empty — a reviewer who follows the
 * portal link would find nothing to download. Reuses `listReviewerMaterials` (also used by
 * `pages/api/external/review/[token]/context.js`) so the count agrees with what the external
 * portal actually shows; this route intentionally does not re-implement the folder-policy filter.
 *
 * Auth: same staff-shared boundary as the rest of Review Manager — requireAppAccess
 * ('review-manager','reviewers') + bypassDynamicsRestrictions. requestId is GUID-validated
 * before it reaches a Dataverse selector (trust-boundary-guid).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { listReviewerMaterials } from '../../../lib/external/reviewer-materials';

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

  try {
    const request = await bypassDynamicsRestrictions('review-manager-materials-preflight', () =>
      DynamicsService.getRecord('akoya_requests', requestId, {
        select: 'akoya_requestid,akoya_requestnum',
      }),
    );
    if (!request?.akoya_requestid || !request?.akoya_requestnum) {
      return res.status(404).json({ ok: false, reason: 'not_found' });
    }

    const files = await bypassDynamicsRestrictions('review-manager-materials-preflight', () =>
      listReviewerMaterials(request.akoya_requestid, request.akoya_requestnum),
    );
    return res.status(200).json({ ok: true, fileCount: files.length });
  } catch (error) {
    // Sanitized — never forward raw Graph/Dataverse error detail to the client.
    console.error('[materials-preflight] lookup/listing failed:', error?.message);
    return res.status(200).json({ ok: false, reason: 'materials_unavailable' });
  }
}
