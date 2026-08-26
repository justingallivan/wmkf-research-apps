/**
 * API: /api/review-manager/reviewer-vip-flags
 *
 * Thin shell for the reviewer VIP flags service
 * (lib/services/review-manager/reviewer-vip-flags-service.js): method
 * dispatch, app access, GUID validation, DAL context, HTTP mapping. Flags
 * are per-(lead PD, reviewer person); the PD is resolved server-side from
 * the request row — never from client input — and any review-manager staff
 * may toggle them on the PD's behalf (owner decision 2026-08-26).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import {
  listReviewerVipFlagsForRequest,
  setReviewerVipFlagForRequest,
} from '../../../lib/services/review-manager/reviewer-vip-flags-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const requestId = req.method === 'GET' ? req.query?.requestId : req.body?.requestId;
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'A request id is required.' });
  }

  return withDalContext('reviewer-vip-flags', async () => {
    if (req.method === 'GET') {
      const result = await listReviewerVipFlagsForRequest(requestId);
      if (!result) {
        return res.status(409).json({ error: 'This request has no assigned Program Director.' });
      }
      return res.status(200).json(result);
    }

    const { potentialReviewerId, flagged } = req.body || {};
    if (!isGuid(potentialReviewerId) || typeof flagged !== 'boolean') {
      return res.status(400).json({ error: 'A reviewer id and flag state are required.' });
    }

    const result = await setReviewerVipFlagForRequest(requestId, potentialReviewerId, flagged);
    if (!result) {
      return res.status(409).json({ error: 'This request has no assigned Program Director.' });
    }
    return res.status(200).json({ pdSystemUserId: result.pdSystemUserId, potentialReviewerId, flagged });
  });
}
