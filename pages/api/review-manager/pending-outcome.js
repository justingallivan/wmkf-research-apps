/**
 * POST /api/review-manager/pending-outcome
 *   { requestId, suggestionId, outcome: { kind: 'coi'|'other', endedBy, note? } }
 *   → 200 { status: 'recorded' } | 409 { status } | 404 { status: 'not_found' }
 *
 * Invite Reviewers "Record outcome…" for an invited reviewer who has not
 * answered: saves Declined with a conflict-of-interest or Other reason, sets
 * Ended by (Reviewer before accepting | Foundation) and Ended at, and revokes
 * the reviewer's link. Review status is unchanged.
 *
 * Auth: review-manager 'reviewers', then lead PD for the request or superuser
 * (authorizeReviewerRequestMutation), like terminal-transition. requestId and
 * suggestionId are GUID-validated; the outcome is re-validated with
 * normalizeStaffPendingOutcome. Business rules live in
 * lib/services/reviewer-engagement/record-pending-outcome.js.
 */
import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { recordPendingOutcome } from '../../../lib/services/reviewer-engagement/record-pending-outcome';
import { normalizeStaffPendingOutcome } from '../../../shared/utils/reviewer-staff-outcome';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const STATUS_HTTP = { recorded: 200, not_found: 404 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionId = typeof req.body?.suggestionId === 'string' ? req.body.suggestionId.trim() : '';
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!isGuid(suggestionId)) return res.status(400).json({ error: 'suggestionId must be a GUID' });
  const outcome = normalizeStaffPendingOutcome(req.body?.outcome);
  if (outcome.error) return res.status(400).json({ error: outcome.error });

  const actingUserSystemId = actorRefFromSession(access.session);
  return withDalContext('review-manager-pending-outcome', async () => {
    try {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        requestIds: [requestId],
        suggestionIds: [suggestionId],
      });
      const result = await recordPendingOutcome({ requestId, suggestionId, outcome, actingUserSystemId });
      return res.status(STATUS_HTTP[result.status] || 409).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('pending-outcome error:', error);
      return res.status(500).json({ error: 'Failed to record the reviewer outcome' });
    }
  });
}
