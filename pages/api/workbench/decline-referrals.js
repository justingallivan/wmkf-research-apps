/**
 * GET /api/workbench/decline-referrals?requestId=<akoya_request GUID>
 * PATCH /api/workbench/decline-referrals
 *
 * Staff-side reader for reviewer decline-referrals. Current portal submissions
 * store versioned structured rows in `wmkf_declinereferral`; legacy free-text
 * values remain readable. GET omits structured rows already carried into the
 * request by the normal referred-candidate path. PATCH dismisses one exact
 * structured row or a resolved legacy prose note while preserving its text.
 *
 * Thin route shell: auth → GUID-validate the client requestId → DAL context →
 * one service call → HTTP mapping. Business logic lives in
 * lib/services/workbench/decline-referrals-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  dismissDeclineReferral,
  getDeclineReferrals,
} from '../../../lib/services/workbench/decline-referrals-service';
import { MAX_DECLINE_REFERRALS } from '../../../shared/utils/decline-referrals';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewer-finder', 'reviewers');
  if (!access) return;

  const requestId = req.method === 'GET'
    ? (typeof req.query.requestId === 'string' ? req.query.requestId : '')
    : (typeof req.body?.requestId === 'string' ? req.body.requestId : '');
  if (!requestId) return res.status(400).json({ error: 'requestId is required (akoya_request GUID)' });
  if (!GUID_RE.test(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });

  let suggestionId = '';
  let referralIndex;
  let referralVersion = '';
  if (req.method === 'PATCH') {
    suggestionId = typeof req.body?.suggestionId === 'string' ? req.body.suggestionId : '';
    if (!GUID_RE.test(suggestionId)) return res.status(400).json({ error: 'suggestionId must be a GUID' });
    referralVersion = typeof req.body?.referralVersion === 'string' ? req.body.referralVersion : '';
    if (!referralVersion || referralVersion.length > 2100) {
      return res.status(400).json({ error: 'referralVersion is required' });
    }
    if (req.body?.referralIndex !== undefined) {
      referralIndex = req.body.referralIndex;
      if (!Number.isInteger(referralIndex)
        || referralIndex < 0
        || referralIndex >= MAX_DECLINE_REFERRALS) {
        return res.status(400).json({
          error: `referralIndex must be an integer from 0 to ${MAX_DECLINE_REFERRALS - 1}`,
        });
      }
    }
  }

  return withDalContext('workbench-decline-referrals', async () => {
    try {
      const result = req.method === 'GET'
        ? await getDeclineReferrals({ requestId })
        : await dismissDeclineReferral({
          requestId,
          suggestionId,
          referralIndex,
          referralVersion,
          actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
        });
      return res.status(200).json(result);
    } catch (error) {
      console.error('[decline-referrals] unexpected error:', error);
      if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
        });
      }
      return res.status(500).json({
        error: req.method === 'GET'
          ? 'Failed to load decline referrals'
          : 'Failed to dismiss decline referral',
      });
    }
  });
}
