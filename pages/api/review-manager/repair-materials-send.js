/** Repair a sent-but-unrecorded materials lifecycle stamp without re-sending. */

import { requireAppAccess } from '../../../lib/utils/auth';
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

  const repairReceipt = typeof req.body?.repairReceipt === 'string' ? req.body.repairReceipt.trim() : '';
  if (!repairReceipt) {
    return res.status(400).json({ error: 'repairReceipt is required' });
  }

  return withDalContext('review-manager-repair-materials-send', async () => {
    try {
      const result = await repairMaterialsSendStamp({
        repairReceipt,
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
