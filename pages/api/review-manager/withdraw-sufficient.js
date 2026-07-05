/**
 * Review Manager — PD selective decline ("no longer needed") (reviewer-engagement Phase 4)
 *
 * POST /api/review-manager/withdraw-sufficient
 *   body: { requestId: <GUID>, suggestionIds: <GUID[]> }
 *   → { ok: true, withdrawn: N, results: [{ suggestionId, status }] }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 1 pilot): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. All business logic (still-pending guard,
 * state-before-email ordering, If-Match TOCTOU close, per-suggestion partial
 * success) lives in lib/services/review-manager/withdraw-sufficient-service.js.
 *
 * Auth: review-manager 'reviewers' (same staff-shared boundary as the rest of
 * the surface). requestId + every suggestionId are GUID-validated before use.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  withdrawSufficient,
  WithdrawSufficientError,
} from '../../../lib/services/review-manager/withdraw-sufficient-service';

const MAX_BATCH = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionIds = Array.isArray(req.body?.suggestionIds) ? req.body.suggestionIds : null;
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!suggestionIds || suggestionIds.length === 0) {
    return res.status(400).json({ error: 'suggestionIds (non-empty array) is required' });
  }
  if (suggestionIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} suggestionIds per request` });
  }
  if (!allGuids(suggestionIds)) {
    return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
  }

  return withDalContext('review-manager-withdraw-sufficient', async () => {
    try {
      const result = await withdrawSufficient({ requestId, suggestionIds, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof WithdrawSufficientError && error.httpStatus) {
        return res.status(error.httpStatus).json({ error: error.message });
      }
      console.error('withdraw-sufficient error:', error);
      return res.status(500).json({ error: 'Failed to withdraw reviewers' });
    }
  });
}
