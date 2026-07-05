/**
 * API: /api/workbench/applicant-reviewers
 *
 * GET ?requestId=<akoya_request GUID>
 *
 * Idempotently materializes the applicant-supplied reviewer inputs for one
 * request into the Reviewer Finder model (Request Workbench Phase 3, run lazily
 * when a PD opens the Find tab). RECOMMENDED slots become junction rows;
 * EXCLUDED free text is parsed for the search soft-block only (S210 option B —
 * no structured excluded rows). Read-mostly + per-request scoped; org-open
 * like the other reviewer surfaces.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. All ingestion/extraction logic lives in
 * lib/services/workbench/applicant-reviewers-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { ingestApplicantReviewers } from '../../../lib/services/workbench/applicant-reviewers-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = req.query.requestId ? String(req.query.requestId).trim() : '';
  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  }
  // GUID-validate before use: requestId flows UNQUOTED into the OData filter
  // `_wmkf_request_value eq ${requestId}` (findByPotentialReviewerAndRequest), so
  // a non-GUID value would be an injection vector as well as a fail-late 404
  // (Codex post-impl review, S210).
  if (!GUID_RE.test(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  const userProfileId = access.profileId || null;

  return withDalContext('workbench-applicant-reviewers', async () => {
    try {
      const body = await ingestApplicantReviewers({ requestId, actingUserSystemId, userProfileId });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('applicant-reviewers error:', err);
      return res.status(500).json({
        error: 'Failed to ingest applicant reviewers',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
