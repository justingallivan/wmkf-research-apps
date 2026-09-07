/**
 * API: /api/workbench/final-writeup/leadership-review
 *
 * POST { requestId, expectedFinalArtifactId } moves the current Final Writeup
 * from group review to leadership review on the same stable SharePoint Word
 * item. Authorization (lead Program Director or superuser) is resolved
 * server-side before any stage state is inspected.
 */

import { getUserRole, requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { advanceToLeadershipReview } from '../../../../lib/services/final-writeup/transition-service';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench final-writeup leadership-review error:', error);
  return res.status(500).json({
    error: 'The leadership review transition failed.',
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
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const isSuperuser = role === 'superuser';

  return withDalContext('workbench-final-writeup-leadership-review', async () => {
    try {
      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => (
          !['requestId', 'expectedFinalArtifactId'].includes(key)
        ))) {
        return res.status(400).json({
          error: 'POST body must contain only requestId and expectedFinalArtifactId',
        });
      }
      const requestId = String(req.body.requestId || '').trim();
      const expectedFinalArtifactId = String(req.body.expectedFinalArtifactId || '').trim();
      if (!isGuid(requestId) || !isGuid(expectedFinalArtifactId)) {
        return res.status(400).json({
          error: 'requestId and expectedFinalArtifactId are required and must be GUIDs',
        });
      }
      const result = await advanceToLeadershipReview({
        requestId,
        expectedFinalArtifactId,
        isSuperuser,
        actingUserSystemId,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
