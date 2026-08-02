/**
 * API: /api/workbench/promote-applicant-reviewer
 *
 * POST { requestId, suggestionId }
 *
 * Explicitly promotes one applicant-recommended reviewer into the request's
 * candidate pool (flips wmkf_selected=true), after rechecking the server-held
 * roster contact and address evidence.  Contact corrections are their own
 * authenticated, server-attested workflow. Partial success is a 200 with
 * { partialSuccess, contactError, savedFields }.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → GUID validation → withDalContext → one service
 * call → result/error→HTTP mapping. Promotion/contact/backfill logic lives in
 * lib/services/workbench/promote-applicant-reviewer-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { promoteApplicantReviewer } from '../../../lib/services/workbench/promote-applicant-reviewer-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const { requestId, suggestionId } = req.body || {};
  const requestGuid = typeof requestId === 'string' ? requestId.trim() : '';
  const suggestionGuid = typeof suggestionId === 'string' ? suggestionId.trim() : '';
  if (!isGuid(requestGuid) || !isGuid(suggestionGuid)) {
    return res.status(400).json({ error: 'requestId and suggestionId must be GUIDs' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return withDalContext('workbench-promote-applicant-reviewer', async () => {
    try {
      const body = await promoteApplicantReviewer({
        requestId: requestGuid,
        suggestionId: suggestionGuid,
        actingUserSystemId,
      });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('promote-applicant-reviewer error:', err);
      return res.status(500).json({
        error: 'Failed to promote applicant reviewer',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
