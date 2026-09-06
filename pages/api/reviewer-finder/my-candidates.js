/**
 * API Route: /api/reviewer-finder/my-candidates  (Dataverse-backed)
 *
 * GET    — Saved candidates grouped by request (default PD scope;
 *           ?requestId / ?requestNumber collaborator overrides;
 *           ?cycleCode narrowing; mode=proposals distinct request list;
 *           mode=removal-preflight&suggestionId=<guid> — "Remove entirely"
 *           disclosure, see docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md).
 * PATCH  — Per-suggestion lifecycle/researcher/person edits, restore, or
 *           confirmed manual-invitation recording (the proposal-wide
 *           cycle/program-area fan-out was removed 2026-09-06, owner decision D4).
 * DELETE — Soft-delete a single suggestion (sets wmkf_selected = false), or
 *           (mode:'hard' in the body) PERMANENTLY remove it — one required atomic
 *           Dataverse changeset (honorarium akoya_request + review-answer
 *           snapshot rows + the suggestion row) + isolated best-effort
 *           cleanups for optional contact delete, SharePoint review files,
 *           and Postgres review_drafts, with a pre-delete audit breadcrumb.
 *           Request-bound PATCH/DELETE operations additionally require the
 *           target request's lead PD or a superuser.
 *
 * Thin multi-verb route shell (Route→Service Consolidation Plan, Stage 3 —
 * the P1m multi-verb pilot, Decision 1): auth guard → ONE withDalContext
 * around the verb dispatch (same scope as the historical single bypass) →
 * one method-specific service call per verb with per-verb input validation
 * and error→HTTP mapping. All business logic lives in
 * lib/services/reviewer-finder/my-candidates-service.js (one exported
 * method per verb, no shared mutable state) — except the "Remove entirely"
 * path, which lives in the sibling remove-candidate-service.js (a distinct,
 * destructive, cross-store operation with its own audit/atomicity contract).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getMyCandidates,
  patchMyCandidates,
  deleteMyCandidates,
} from '../../../lib/services/reviewer-finder/my-candidates-service';
import {
  describeRemoval,
  removeCandidateEntirely,
} from '../../../lib/services/reviewer-finder/remove-candidate-service';
import { withRequestCorrelation, mintCorrelationId } from '../../../lib/observability/request-correlation';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

export default async function handler(req, res) {
  return withRequestCorrelation(
    { correlationId: mintCorrelationId(), routeName: '/api/reviewer-finder/my-candidates' },
    () => handleWithCorrelation(req, res),
  );
}

async function handleWithCorrelation(req, res) {
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  // Trusted internal endpoint — no field/table masking applies. One context
  // for all three verbs, matching the historical single bypass scope.
  return withDalContext('my-candidates', async () => {
    if (req.method === 'GET') return handleGet(req, res, access);
    if (req.method === 'PATCH') return handlePatch(req, res, access);
    if (req.method === 'DELETE') return handleDelete(req, res, access);
    return res.status(405).json({ error: 'Method not allowed' });
  });
}

async function handleGet(req, res, access) {
  const { mode, requestId, requestNumber, cycleCode, suggestionId } = req.query;

  // "Remove entirely" preflight — dry-run disclosure, no requestId scoping.
  if (mode === 'removal-preflight') {
    if (!suggestionId || !isGuid(suggestionId)) {
      return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
    }
    try {
      const result = await describeRemoval({ suggestionId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Describe removal error:', error);
      return res.status(500).json({
        error: 'Failed to preview removal',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  // GUID-validate requestId before it becomes a Dataverse selector. Checked
  // only outside mode=proposals — the proposals list ignores requestId, as
  // the pre-extraction handler did (validation sat below the mode branch).
  if (mode !== 'proposals' && requestId && !isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId is not a valid GUID' });
  }
  try {
    const result = await getMyCandidates({
      mode,
      requestId,
      requestNumber,
      cycleCode,
      azureEmail: access.session?.user?.azureEmail,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    console.error('Get my candidates error:', error);
    return res.status(500).json({
      error: 'Failed to fetch candidates',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

async function handlePatch(req, res, access) {
  const body = req.body || {};
  const actingUserSystemId = actorRefFromSession(access.session);
  try {
    let authorizedRequestId;
    if (isGuid(body.suggestionId)) {
      const authorization = await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actingUserSystemId,
        suggestionIds: [body.suggestionId],
      });
      authorizedRequestId = authorization?.requestIds?.[0];
    }
    const result = await patchMyCandidates({
      body,
      actingUserSystemId,
      authorizedRequestId,
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    console.error('Update candidate error:', error);
    return res.status(500).json({
      error: 'Failed to update candidate',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

async function handleDelete(req, res, access) {
  const { suggestionId, mode, deleteContact } = req.body || {};
  if (!suggestionId) {
    return res.status(400).json({ error: 'suggestionId is required' });
  }
  // GUID-validate before softDelete → getRecord/updateRecord (record-id
  // selector interpolated raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
  }

  const actingUserSystemId = actorRefFromSession(access.session);
  try {
    await authorizeReviewerRequestMutation({
      profileId: access.profileId,
      callerSystemId: actingUserSystemId,
      suggestionIds: [suggestionId],
    });
  } catch (error) {
    if (error instanceof ServiceHttpError) {
      return res.status(error.httpStatus).json(error.body ?? { error: error.message });
    }
    throw error;
  }

  // mode:'hard' — PERMANENT removal (docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md).
  // The shared ownership gate above runs before either soft or hard removal.
  if (mode === 'hard') {
    try {
      const result = await removeCandidateEntirely({
        suggestionId,
        deleteContact: deleteContact === true,
        actingUserSystemId,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('Remove candidate entirely error:', error);
      return res.status(500).json({
        error: 'Failed to remove candidate entirely',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }

  try {
    const result = await deleteMyCandidates({
      suggestionId,
      actingUserSystemId,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Delete candidate error:', error);
    return res.status(500).json({
      error: 'Failed to remove candidate',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
