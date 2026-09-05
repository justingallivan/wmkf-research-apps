/**
 * Review Manager - Reviewers API (Dataverse-backed)
 *
 * GET /api/review-manager/reviewers
 *   Default scope: accepted suggestions on requests where the authenticated
 *   user is the lead Program Director.
 *   Query overrides:
 *     ?proposalId=<guid>     specific request (collaborator override; bypasses PD filter)
 *     ?requestNumber=<num>   same, by request number
 *     ?cycleCode=Jxx|Dxx     narrow within PD scope; required for all scope
 *     ?scope=my|all          my (default) = requests where the caller is lead PD;
 *                            all = every request in the specified cycle
 *     ?status=<reviewStatus> post-filter (e.g. 'materials_sent', 'complete')
 *
 * PATCH /api/review-manager/reviewers
 *   Single  : { suggestionId, reviewStatus }
 *   Batch   : { suggestionIds: [...], reviewStatus }
 *
 * Note: suggestionId values are Dataverse GUIDs (strings). reviewStatus values
 * are the legacy string codes — the suggestion adapter translates them to the
 * picklist optionset on write.
 *
 * Data boundary: reads remain staff-shared. PATCH resolves every suggestion
 * to its request and permits only the lead PD or a superuser. Batch ownership
 * is verified in full before the first lifecycle write.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): auth guard
 * (BEFORE method dispatch — preserved from the original route) → one
 * withDalContext around dispatch (same scope as the old wrapper) → per-verb
 * input validation → one service call per verb → result/error→HTTP mapping.
 * All DTO/lifecycle logic lives in
 * lib/services/review-manager/reviewers-service.js.
 * NOTE (pinned): the 405 sends NO Allow header — characterized behavior.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getReviewers, patchReviewers } from '../../../lib/services/review-manager/reviewers-service';
import { withRequestCorrelation, mintCorrelationId } from '../../../lib/observability/request-correlation';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

export default async function handler(req, res) {
  return withRequestCorrelation(
    { correlationId: mintCorrelationId(), routeName: '/api/review-manager/reviewers' },
    () => handleWithCorrelation(req, res),
  );
}

async function handleWithCorrelation(req, res) {
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  return withDalContext('review-manager-reviewers', async () => {
    if (req.method === 'GET') return handleGet(req, res, access);
    if (req.method === 'PATCH') return handlePatch(req, res, access);
    return res.status(405).json({ error: 'Method not allowed' });
  });
}

async function handleGet(req, res, access) {
  try {
    const { proposalId, requestNumber, cycleCode, status } = req.query;
    const scope = req.query.scope === 'all' ? 'all' : 'my';

    // GUID-validate proposalId before it becomes a Dataverse selector
    // (fetchRequestByIdOrNumber → getRecord). requestNumber is an escaped string lookup.
    if (proposalId && !isGuid(proposalId)) {
      return res.status(400).json({ error: 'proposalId is not a valid GUID' });
    }

    const result = await getReviewers({
      proposalId,
      requestNumber,
      cycleCode,
      status,
      scope,
      azureEmail: access.session?.user?.azureEmail,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    console.error('Review Manager GET error:', error);
    return res.status(500).json({
      error: 'Failed to fetch reviewers',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}

async function handlePatch(req, res, access) {
  const actingUserSystemId = actorRefFromSession(access.session);
  try {
    const {
      suggestionId,
      suggestionIds,
      reviewStatus,
    } = req.body || {};

    // Batch: status change across multiple suggestions
    if (Array.isArray(suggestionIds) && suggestionIds.length > 0) {
      if (reviewStatus === undefined) {
        return res.status(400).json({ error: 'reviewStatus required for batch update' });
      }
      // GUID-validate every id before it reaches updateLifecycle (record-id
      // selectors interpolated raw into the request URL). Reject the whole batch
      // on any bad id rather than partially applying.
      if (!allGuids(suggestionIds)) {
        return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
      }
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds,
      });
      const result = await patchReviewers({ suggestionIds, reviewStatus, actingUserSystemId });
      return res.status(200).json(result);
    }

    if (!suggestionId) {
      return res.status(400).json({ error: 'suggestionId, suggestionIds, or proposalId is required' });
    }
    // GUID-validate before updateLifecycle (record-id selector interpolated raw).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
    }

    const lifecycle = {};
    if (reviewStatus !== undefined) lifecycle.reviewStatus = reviewStatus;

    if (Object.keys(lifecycle).length === 0) {
      return res.status(400).json({ error: 'No supported fields to update' });
    }

    await authorizeReviewerRequestMutation({
      profileId: access.profileId,
      callerSystemId: actingUserSystemId,
      suggestionIds: [suggestionId],
    });
    const result = await patchReviewers({ suggestionId, lifecycle, actingUserSystemId });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    console.error('Review Manager PATCH error:', error);
    return res.status(500).json({
      error: 'Failed to update reviewer',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
