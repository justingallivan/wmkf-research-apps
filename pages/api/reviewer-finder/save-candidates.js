/**
 * API Route: /api/reviewer-finder/save-candidates
 *
 * Saves selected candidates to Dataverse for a proposal. Writes go to three
 * adapters (potential reviewer → researcher overlay → reviewer suggestion),
 * keyed by email and request GUID. Requires `requestId` (Dataverse
 * akoya_request GUID).
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 3): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. The per-candidate save pipeline with
 * its PARTIAL-SUCCESS semantics (identity hard-reject, institution-COI
 * gate, contact/identity persist gating, conditional rejected-count and errors
 * response keys, 422 all-rejected / 500 nothing-saved envelopes) lives in
 * lib/services/reviewer-finder/save-candidates-service.js — clients depend
 * on those exact shapes.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { saveCandidates } from '../../../lib/services/reviewer-finder/save-candidates-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const {
    proposalTitle,
    programArea,
    requestId,
    grantCycleCode,
    candidates,
    summaryBlobUrl,
  } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required (Dataverse akoya_request GUID)' });
  }

  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'candidates array is required' });
  }

  // Trusted internal writeback — no field/table masking applies.
  return withDalContext('save-candidates', async () => {
    try {
      const result = await saveCandidates({
        proposalTitle,
        programArea,
        requestId,
        grantCycleCode,
        candidates,
        summaryBlobUrl,
        actingUserSystemId,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Save candidates error:', error);
      return res.status(500).json({
        error: 'Failed to save candidates',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  });
}
