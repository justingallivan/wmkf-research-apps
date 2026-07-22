/** Repair a sent-but-unrecorded materials lifecycle stamp without re-sending. */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { repairMaterialsSendStamp } from '../../../lib/services/review-manager/repair-materials-send-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionId = typeof req.body?.suggestionId === 'string' ? req.body.suggestionId.trim() : '';
  if (!isGuid(requestId) || !isGuid(suggestionId)) {
    return res.status(400).json({ error: 'requestId and suggestionId must be GUIDs' });
  }

  return withDalContext('review-manager-repair-materials-send', async () => {
    try {
      const result = await repairMaterialsSendStamp({
        requestId,
        suggestionId,
        effectiveReviewDueDate: req.body?.effectiveReviewDueDate,
        materialsSentAt: req.body?.materialsSentAt,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('repair-materials-send error:', error);
      return res.status(500).json({ error: 'Failed to repair materials send tracking' });
    }
  });
}
