/**
 * POST /api/workbench/reviewer-stage-refresh
 *
 * Explicit staff-only repair of one canonical Reviewer Find candidate stage.
 * This is intentionally separate from the batch applicant-enrichment route:
 * it accepts no display name, client receipt, dependency version, candidate
 * key authority, proposal binding, or provider result. The service derives all of those
 * from the request-scoped roster and authoritative Dataverse reads.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  EXECUTABLE_REVIEWER_REFRESH_STAGES,
  refreshReviewerCandidateStage,
} from '../../../lib/services/workbench/reviewer-stage-refresh-service';
import { canonicalStoredReviewerCandidateKey } from '../../../lib/utils/reviewer-candidate-key';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(['requestId', 'candidateKey', 'stage', 'expectedUpdatedAt']);
const CLIENT_ERROR_REASONS = new Set([
  'authority_stale', 'invalid_refresh_target', 'stage_not_executable', 'prerequisite_action_required',
]);
const CLIENT_ERROR_MESSAGES = Object.freeze({
  invalid_refresh_request: 'The evidence refresh request could not be read. Reload reviewer status and try again.',
  client_authority_claim_rejected: 'The evidence refresh request included unsupported fields. Reload reviewer status and try again.',
  invalid_refresh_target: 'The reviewer refresh target is no longer valid. Reload reviewer status before trying again.',
  dedicated_address_action: 'Address trust must be handled with the dedicated staff action. Reload reviewer status.',
  stage_not_executable: 'This evidence stage cannot be refreshed from this action. Reload reviewer status.',
  invalid_expected_updated_at: 'The reviewer refresh version is missing or invalid. Reload reviewer status before trying again.',
  refresh_internal_error: 'The evidence refresh service did not complete. Reload reviewer status before trying again.',
});

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

function validCandidateKey(value) {
  return canonicalStoredReviewerCandidateKey(value) !== null;
}

function responseStage(value) {
  return EXECUTABLE_REVIEWER_REFRESH_STAGES.includes(value) || value === 'address_trust'
    ? value
    : null;
}

function clientErrorReason(code) {
  if (code === 'invalid_refresh_target') return 'invalid_refresh_target';
  if (code === 'stage_not_executable') return 'stage_not_executable';
  if (code === 'dedicated_address_action') return 'prerequisite_action_required';
  return 'authority_stale';
}

function errorResponse({ code, stage = null } = {}) {
  const message = CLIENT_ERROR_MESSAGES[code] || CLIENT_ERROR_MESSAGES.refresh_internal_error;
  const reasonCode = clientErrorReason(code);
  return {
    success: false,
    outcome: 'rejected',
    code,
    error: message,
    message,
    requestedStage: responseStage(stage),
    stageState: 'stale',
    reasonCode: CLIENT_ERROR_REASONS.has(reasonCode) ? reasonCode : 'authority_stale',
  };
}

function parseRefreshRequest(body) {
  const stage = typeof body?.stage === 'string' ? body.stage.trim() : '';
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, code: 'invalid_refresh_request', stage: null };
  }
  if (Object.keys(body).some((key) => !REQUEST_FIELDS.has(key))) {
    return {
      valid: false,
      code: 'client_authority_claim_rejected',
      stage: responseStage(stage),
    };
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const candidateKey = typeof body.candidateKey === 'string' ? body.candidateKey.trim() : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string'
    ? body.expectedUpdatedAt.trim()
    : '';
  if (!isGuid(requestId) || !validCandidateKey(candidateKey)) {
    return { valid: false, code: 'invalid_refresh_target', stage: responseStage(stage) };
  }
  if (stage === 'address_trust') {
    return { valid: false, code: 'dedicated_address_action', stage };
  }
  if (!EXECUTABLE_REVIEWER_REFRESH_STAGES.includes(stage)) {
    return { valid: false, code: 'stage_not_executable', stage: null };
  }
  if (!validExpectedUpdatedAt(expectedUpdatedAt)) {
    return { valid: false, code: 'invalid_expected_updated_at', stage };
  }
  return {
    valid: true,
    value: { requestId, candidateKey, stage, expectedUpdatedAt },
  };
}

function httpStatusForOutcome(refreshOutcome) {
  if (refreshOutcome === 'recorded' || refreshOutcome === 'not_required') return 200;
  if (refreshOutcome === 'skipped_stale'
    || refreshOutcome === 'refresh_in_progress'
    || refreshOutcome === 'lease_recovery_required'
    || refreshOutcome === 'lease_repair_required'
    || refreshOutcome === 'action_required') return 409;
  if (refreshOutcome === 'rejected' || refreshOutcome === 'failed_terminal') return 422;
  return 503;
}

function boundedErrorMetadata(error) {
  const rawName = error instanceof Error ? error.name : '';
  const name = /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(rawName) ? rawName : 'Error';
  const status = Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : null;
  return { name, status };
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
    return res.status(400).json(errorResponse(parsed));
  }

  try {
    return await withDalContext('workbench-reviewer-stage-refresh', async () => {
      try {
        const result = await refreshReviewerCandidateStage(parsed.value);
        return res.status(httpStatusForOutcome(result.outcome)).json({
          ...result,
        });
      } catch (error) {
        // Do not log transport/Dataverse errors here: those may carry an OData
        // filter or a reviewer email. The route's public response is deliberately
        // generic. Only a bounded error class and numeric HTTP status are retained
        // so production failures remain distinguishable without logging payloads.
        console.error('[reviewer-stage-refresh] internal_failure', boundedErrorMetadata(error));
        return res.status(500).json(errorResponse({
          code: 'refresh_internal_error',
          stage: parsed.value.stage,
        }));
      }
    });
  } catch (error) {
    // A DAL-context bootstrap failure happens before the inner callback. It is
    // still a valid, targetable refresh request, so retain the same closed
    // envelope instead of letting Next emit an untyped 500 page.
    console.error('[reviewer-stage-refresh] internal_failure', boundedErrorMetadata(error));
    return res.status(500).json(errorResponse({
      code: 'refresh_internal_error',
      stage: parsed.value.stage,
    }));
  }
}

export { boundedErrorMetadata, errorResponse, parseRefreshRequest };
