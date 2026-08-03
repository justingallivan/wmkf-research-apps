/**
 * POST /api/workbench/reviewer-reconcile
 *
 * Explicit, bounded recovery of durable Reviewer Find stage evidence. This
 * route accepts only request/candidate correlation handles and derives every
 * authority input server-side. It never runs a cold search, sends mail, or
 * changes candidate selection/promotion state.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { canonicalStoredReviewerCandidateKey } from '../../../lib/utils/reviewer-candidate-key';
import {
  MAX_REQUEST_CANDIDATES,
  reconcileReviewerStages,
} from '../../../lib/services/workbench/reviewer-stage-reconciliation-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(['requestId', 'candidateKeys']);
const MAX_CANDIDATE_KEYS = MAX_REQUEST_CANDIDATES;

export const config = {
  // A canonical stored key permits up to 560 characters. The active roster is
  // authoritatively capped at 300 rows, so 256kb accepts every valid exact
  // continuation without allowing arbitrary candidate payloads.
  api: { bodyParser: { sizeLimit: '256kb' } },
  // The coordinator stops itself at 210 seconds. Keep the platform ceiling
  // above that internal deadline so callers receive a resumable result rather
  // than a function timeout.
  maxDuration: 300,
};

function parseRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !REQUEST_FIELDS.has(key))) {
    return { valid: false, error: 'Only requestId and candidateKeys are accepted' };
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!GUID_RE.test(requestId)) return { valid: false, error: 'requestId is required' };
  if (body.candidateKeys === undefined) return { valid: true, value: { requestId } };
  if (!Array.isArray(body.candidateKeys) || body.candidateKeys.length === 0
    || body.candidateKeys.length > MAX_CANDIDATE_KEYS) {
    return { valid: false, error: `candidateKeys must contain 1-${MAX_CANDIDATE_KEYS} keys` };
  }
  const candidateKeys = body.candidateKeys.map((key) => (
    typeof key === 'string' ? canonicalStoredReviewerCandidateKey(key.trim()) : null
  ));
  if (candidateKeys.some((key) => !key) || new Set(candidateKeys).size !== candidateKeys.length) {
    return { valid: false, error: 'candidateKeys must be unique stored reviewer keys' };
  }
  return { valid: true, value: { requestId, candidateKeys } };
}

function statusFor(result) {
  if (result?.outcome === 'current' || result?.outcome === 'partial') return 200;
  if (result?.outcome === 'rejected') return 400;
  if (result?.outcome === 'action_required' || result?.outcome === 'blocked' || result?.outcome === 'budget_exhausted') return 409;
  return 503;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;
  const parsed = parseRequest(req.body);
  if (!parsed.valid) return res.status(400).json({ success: false, outcome: 'rejected', error: parsed.error });

  return withDalContext('workbench-reviewer-reconcile', async () => {
    try {
      const result = await reconcileReviewerStages(parsed.value);
      // The service can fail before it has a request context. The route still
      // binds every parsed response to the request that this authenticated
      // caller submitted, so the browser can never render a cross-request
      // retry result.
      const boundResult = { ...result, requestId: parsed.value.requestId };
      return res.status(statusFor(boundResult)).json({
        success: boundResult.outcome === 'current' || boundResult.outcome === 'partial',
        ...boundResult,
      });
    } catch {
      // Reconciliation may touch external evidence providers. Their raw errors
      // can contain query fragments or reviewer data, so do not log them here.
      return res.status(503).json({
        success: false,
        outcome: 'failed_retryable',
        requestId: parsed.value.requestId,
        candidates: [],
        error: 'Reviewer reconciliation is temporarily unavailable',
      });
    }
  });
}

export { parseRequest, statusFor };
