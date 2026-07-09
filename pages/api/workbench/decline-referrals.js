/**
 * GET /api/workbench/decline-referrals?requestId=<akoya_request GUID>
 *
 * Staff-side reader for reviewer decline-referrals (the free-text "Anyone
 * you'd suggest instead?" a declining reviewer entered on the external portal,
 * stored in `wmkf_declinereferral`). Read-only; the write path lives on the
 * external decline flow. Returns { success, referrals:[{ suggestionId,
 * reviewerName, referralText, declinedAt }] }.
 *
 * Thin route shell: auth → GUID-validate the client requestId → DAL context →
 * one service call → HTTP mapping. Business logic lives in
 * lib/services/workbench/decline-referrals-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { getDeclineReferrals } from '../../../lib/services/workbench/decline-referrals-service';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : '';
  if (!requestId) return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  return withDalContext('workbench-decline-referrals', async () => {
    try {
      const result = await getDeclineReferrals({ requestId });
      return res.status(200).json(result);
    } catch (error) {
      console.error('[decline-referrals] unexpected error:', error);
      return res.status(500).json({ error: 'Failed to load decline referrals' });
    }
  });
}
