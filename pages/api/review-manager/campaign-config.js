/**
 * Review Manager — Reviewer-engagement campaign config (Phase 1)
 *
 * GET  /api/review-manager/campaign-config?requestId=<GUID>
 *   → { requestId, config: { respondOffsetDays, reviewDueDate, respondReminderEnabled,
 *       respondReminderLeadDays, reviewDueReminderEnabled, reviewDueReminderLeadDays,
 *       desiredCount, quotaNotifiedAt } }   (nulls where unset)
 *
 * POST /api/review-manager/campaign-config
 *   body: { requestId: <GUID>, config: { <any subset of the editable fields above> } }
 *   → { success: true, requestId, config }   (only provided fields are written)
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call per verb → result/error→HTTP mapping. All business logic (writable
 * field map, coercion, read-before-write, quotaNotifiedAt read-only rule)
 * lives in lib/services/review-manager/campaign-config-service.js.
 *
 * Auth: same boundary as the rest of the review-manager reviewer surface —
 * requireAppAccess('review-manager','reviewers') + withDalContext (reviewer
 * outreach is a foundation-owned, staff-shared workflow, not user-private).
 * requestId is GUID-validated before it reaches a Dataverse selector
 * (trust-boundary-guid).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { getCampaignConfig, saveCampaignConfig } from '../../../lib/services/review-manager/campaign-config-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const requestId = req.method === 'GET'
    ? (typeof req.query.requestId === 'string' ? req.query.requestId.trim() : '')
    : (typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '');
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  if (req.method === 'POST') {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return res.status(400).json({ error: 'config object is required' });
    }
  }

  return withDalContext('review-manager-campaign-config', async () => {
    try {
      const result = req.method === 'GET'
        ? await getCampaignConfig({ requestId })
        : await saveCampaignConfig({ requestId, config: req.body.config, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('campaign-config error:', error);
      return res.status(500).json({ error: 'Failed to read or write campaign config' });
    }
  });
}
