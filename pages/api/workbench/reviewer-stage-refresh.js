/**
 * POST /api/workbench/reviewer-stage-refresh
 *
 * Explicit staff-only repair of one canonical Reviewer Find candidate stage.
 * This is intentionally separate from the batch applicant-enrichment route:
 * it accepts no display name, client receipt, dependency version, candidate
 * key, proposal binding, or provider result. The service derives all of those
 * from the request-scoped roster and authoritative Dataverse reads.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  EXECUTABLE_REVIEWER_REFRESH_STAGES,
  refreshReviewerCandidateStage,
} from '../../../lib/services/workbench/reviewer-stage-refresh-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(['requestId', 'suggestionId', 'stage', 'expectedUpdatedAt']);

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};

function isGuid(value) {
  return typeof value === 'string' && GUID_RE.test(value);
}

function validExpectedUpdatedAt(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= 128
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseRefreshRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, code: 'invalid_refresh_request', error: 'A refresh request body is required' };
  }
  if (Object.keys(body).some((key) => !REQUEST_FIELDS.has(key))) {
    return {
      valid: false,
      code: 'client_authority_claim_rejected',
      error: 'Only requestId, suggestionId, stage, and expectedUpdatedAt are accepted',
    };
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const suggestionId = typeof body.suggestionId === 'string' ? body.suggestionId.trim() : '';
  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string'
    ? body.expectedUpdatedAt.trim()
    : '';
  if (!isGuid(requestId) || !isGuid(suggestionId)) {
    return { valid: false, code: 'invalid_refresh_target', error: 'requestId and suggestionId must be GUIDs' };
  }
  if (!EXECUTABLE_REVIEWER_REFRESH_STAGES.includes(stage)) {
    return { valid: false, code: 'stage_not_executable', error: 'stage is not executable' };
  }
  if (!validExpectedUpdatedAt(expectedUpdatedAt)) {
    return { valid: false, code: 'invalid_expected_updated_at', error: 'expectedUpdatedAt is required' };
  }
  return {
    valid: true,
    value: { requestId, suggestionId, stage, expectedUpdatedAt },
  };
}

function httpStatusForOutcome(refreshOutcome) {
  if (refreshOutcome === 'recorded') return 200;
  if (refreshOutcome === 'skipped_stale' || refreshOutcome === 'rejected') return 409;
  if (refreshOutcome === 'failed_terminal') return 422;
  return 503;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const parsed = parseRefreshRequest(req.body);
  if (!parsed.valid) {
    return res.status(400).json({
      success: false,
      outcome: 'rejected',
      code: parsed.code,
      error: parsed.error,
    });
  }

  return withDalContext('workbench-reviewer-stage-refresh', async () => {
    try {
      const result = await refreshReviewerCandidateStage(parsed.value);
      return res.status(httpStatusForOutcome(result.outcome)).json({
        success: result.outcome === 'recorded',
        ...result,
      });
    } catch (error) {
      console.error('reviewer-stage-refresh error:', error);
      return res.status(500).json({ error: 'Reviewer stage refresh failed' });
    }
  });
}

export { parseRefreshRequest };
