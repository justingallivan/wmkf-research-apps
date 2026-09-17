/**
 * API: POST /api/workbench/pre-rp-brief/lock-for-share
 *
 * Locks the current governed Pre-RP Brief into the Review lifecycle so it
 * can be shared (plan §3.4, lifecycle only — no review gate here).
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { lockPreRpBriefForShare } from '../../../../lib/services/pre-rp-brief/share-lock-service';

export const config = {
  api: {
    bodyParser: { sizeLimit: '16kb' },
  },
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench pre-rp-brief lock-for-share error:', error);
  return res.status(500).json({
    error: 'The Pre-RP Brief could not be locked for Share.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-pre-rp-brief-lock-for-share', async () => {
    try {
      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => (
          !['requestId', 'expectedArtifactId'].includes(key)
        ))) {
        return res.status(400).json({
          error: 'POST body must contain only requestId and expectedArtifactId',
        });
      }
      const requestId = String(req.body.requestId || '').trim();
      const expectedArtifactId = String(req.body.expectedArtifactId || '').trim();
      if (!isGuid(requestId) || !isGuid(expectedArtifactId)) {
        return res.status(400).json({
          error: 'requestId and expectedArtifactId are required and must be GUIDs',
        });
      }

      const result = await lockPreRpBriefForShare({
        requestId,
        expectedArtifactId,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
