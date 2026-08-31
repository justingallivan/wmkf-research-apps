/**
 * API: /api/workbench/final-writeup
 *
 * GET ?requestId=... reads the governed Final Writeup transition state.
 * POST { requestId, expectedArtifactId } starts group review on the same stable
 * SharePoint Word item. Authorization is resolved server-side.
 */

import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getFinalWriteupStatus,
  startFinalWriteup,
} from '../../../lib/services/final-writeup/transition-service';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench final-writeup error:', error);
  return res.status(500).json({
    error: 'The Final Writeup transition failed.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const isSuperuser = role === 'superuser';

  return withDalContext('workbench-final-writeup', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const status = await getFinalWriteupStatus({
          requestId,
          isSuperuser,
          actingUserSystemId,
        });
        return res.status(200).json({ success: true, ...status });
      }

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
      const result = await startFinalWriteup({
        requestId,
        expectedArtifactId,
        isSuperuser,
        actingUserSystemId,
      });
      return res.status(result.inProgress ? 202 : 200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
