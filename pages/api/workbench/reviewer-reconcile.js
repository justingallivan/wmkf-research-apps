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
import { reconcileReviewerStages } from '../../../lib/services/workbench/reviewer-stage-reconciliation-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_FIELDS = new Set(['requestId', 'candidateKeys']);
const MAX_CANDIDATE_KEYS = 24;

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
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
      return res.status(statusFor(result)).json({
        success: result.outcome === 'current' || result.outcome === 'partial',
        ...result,
      });
    } catch {
      // Reconciliation may touch external evidence providers. Their raw errors
      // can contain query fragments or reviewer data, so do not log them here.
      return res.status(503).json({ success: false, error: 'Reviewer reconciliation is temporarily unavailable' });
    }
  });
}

export { parseRequest, statusFor };
