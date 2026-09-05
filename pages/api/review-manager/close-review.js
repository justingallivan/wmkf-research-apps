/**
 * POST /api/review-manager/close-review
 *   { suggestionId, disposition: 'eligible'|'not_eligible'|'not_applicable', notes?: string }
 *   notes is required and nonblank when disposition is not_eligible.
 *
 * Dedicated one-reviewer human closeout. The authenticated actor must be the
 * request's lead Program Director or a superuser. All lifecycle eligibility is
 * freshly re-read by the service before its single ETag-bound Dataverse write.
 */

import { requireAppAccess } from '../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../lib/utils/actor-ref.js';
import { isGuid } from '../../../lib/utils/guid.js';
import { withDalContext } from '../../../lib/dataverse/core/context.js';
import { ServiceHttpError } from '../../../lib/services/service-http-error.js';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization.js';
import { closeReview } from '../../../lib/services/review-manager/close-review-service.js';
import { isHonorariumEligibility } from '../../../shared/config/reviewerLifecycle.js';

export default async function handler(req, res) {
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const suggestionId = typeof req.body?.suggestionId === 'string'
    ? req.body.suggestionId.trim()
    : '';
  const disposition = req.body?.disposition;
  const notes = req.body?.notes;
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ error: 'suggestionId must be a valid GUID' });
  }
  if (!isHonorariumEligibility(disposition)) {
    return res.status(400).json({
      error: 'disposition must be eligible, not_eligible, or not_applicable',
    });
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
    return res.status(400).json({ error: 'notes must be a string of 2000 characters or fewer' });
  }
  if (disposition === 'not_eligible' && (typeof notes !== 'string' || !notes.trim())) {
    return res.status(400).json({ error: 'A closeout note is required when no honorarium should be paid' });
  }

  const actingUserSystemId = actorRefFromSession(access.session);
  return withDalContext('review-manager-close-review', async () => {
    try {
      const authorization = await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [suggestionId],
      });
      const result = await closeReview({
        suggestionId,
        disposition,
        ...(notes !== undefined ? { notes } : {}),
        actingUserSystemId,
        authorizedRequestId: authorization.requestIds[0],
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('close-review error:', error);
      return res.status(500).json({ error: 'Failed to close reviewer engagement' });
    }
  });
}
