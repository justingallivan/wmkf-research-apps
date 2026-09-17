/**
 * POST /api/review-manager/terminal-transition
 *   Preview accepted-reviewer release:
 *     { requestId, suggestionIds, terminalStatus: 'released', preview: true }
 *   Commit staff-recorded withdrawal:
 *     { requestId, suggestionIds, terminalStatus: 'withdrew' }
 *   Commit accepted-reviewer release:
 *     { requestId, suggestionIds, terminalStatus: 'released',
 *       releaseReason: 'sufficient_reviews_received', sendEmail, overrides,
 *       internalNotes? }
 *
 * Thin authenticated shell around the ETag-guarded, per-row partial-success
 * terminal transition service. A whole request with no successful transition
 * returns 409 and preserves the per-row reasons in the response body.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  renderAcceptedReleasePreviews,
  transitionReviewersTerminal,
} from '../../../lib/services/review-manager/terminal-transition-service';
import { isTerminalReviewStatus } from '../../../shared/config/reviewerStatus';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const MAX_BATCH = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionIds = Array.isArray(req.body?.suggestionIds) ? req.body.suggestionIds : null;
  const terminalStatus = req.body?.terminalStatus;
  const preview = req.body?.preview === true;
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!suggestionIds || suggestionIds.length === 0) {
    return res.status(400).json({ error: 'suggestionIds (non-empty array) is required' });
  }
  if (suggestionIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} suggestionIds per request` });
  }
  if (!allGuids(suggestionIds)) {
    return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
  }
  if (!isTerminalReviewStatus(terminalStatus)) {
    return res.status(400).json({ error: 'terminalStatus must be withdrew or released' });
  }
  if (preview && terminalStatus !== 'released') {
    return res.status(400).json({ error: 'preview is only supported for released' });
  }
  if (terminalStatus === 'released' && !preview) {
    if (req.body?.releaseReason !== 'sufficient_reviews_received') {
      return res.status(400).json({ error: 'releaseReason must be sufficient_reviews_received' });
    }
    if (typeof req.body?.sendEmail !== 'boolean') {
      return res.status(400).json({ error: 'sendEmail must be boolean' });
    }
    if (!req.body?.overrides || typeof req.body.overrides !== 'object' || Array.isArray(req.body.overrides)) {
      return res.status(400).json({ error: 'overrides must contain the reviewed release details' });
    }
    if (req.body?.internalNotes !== undefined
        && (!req.body.internalNotes || typeof req.body.internalNotes !== 'object' || Array.isArray(req.body.internalNotes))) {
      return res.status(400).json({ error: 'internalNotes must be an object' });
    }
  }

  const actingUserSystemId = actorRefFromSession(access.session);
  return withDalContext('review-manager-terminal-transition', async () => {
    try {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        requestIds: [requestId],
        suggestionIds,
      });
      if (preview) {
        const result = await renderAcceptedReleasePreviews({ requestId, suggestionIds });
        return res.status(200).json(result);
      }
      const result = await transitionReviewersTerminal({
        requestId,
        suggestionIds,
        terminalStatus,
        actingUserSystemId,
        releaseReason: req.body?.releaseReason,
        internalNotes: req.body?.internalNotes,
        sendEmail: req.body?.sendEmail,
        overrides: req.body?.overrides,
      });
      return res.status(result.transitioned > 0 ? 200 : 409).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('terminal-transition error:', error);
      return res.status(500).json({ error: 'Failed to end reviewer engagement' });
    }
  });
}
