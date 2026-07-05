/**
 * API Route: /api/reviewer-finder/my-candidates  (Dataverse-backed)
 *
 * GET    — Saved candidates grouped by request (default PD scope;
 *           ?requestId / ?requestNumber collaborator overrides;
 *           ?cycleCode narrowing; mode=proposals distinct request list).
 * PATCH  — Per-suggestion lifecycle/researcher/person edits, restore, or
 *           bulk-by-request updates (programArea, grantCycleCode).
 * DELETE — Soft-delete a single suggestion (sets wmkf_selected = false).
 *
 * Thin multi-verb route shell (Route→Service Consolidation Plan, Stage 3 —
 * the P1m multi-verb pilot, Decision 1): auth guard → ONE withDalContext
 * around the verb dispatch (same scope as the historical single bypass) →
 * one method-specific service call per verb with per-verb input validation
 * and error→HTTP mapping. All business logic lives in
 * lib/services/reviewer-finder/my-candidates-service.js (one exported
 * method per verb, no shared mutable state).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getMyCandidates,
  patchMyCandidates,
  deleteMyCandidates,
} from '../../../lib/services/reviewer-finder/my-candidates-service';

export default async function handler(req, res) {
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
  const { mode, requestId, requestNumber, cycleCode } = req.query;
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
  try {
    const result = await patchMyCandidates({
      body: req.body || {},
      actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
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
  const { suggestionId } = req.body || {};
  if (!suggestionId) {
    return res.status(400).json({ error: 'suggestionId is required' });
  }
  // GUID-validate before softDelete → getRecord/updateRecord (record-id
  // selector interpolated raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ error: 'suggestionId is not a valid GUID' });
  }
  try {
    const result = await deleteMyCandidates({
      suggestionId,
      actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
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
