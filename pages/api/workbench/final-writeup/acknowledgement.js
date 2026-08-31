/**
 * API: /api/workbench/final-writeup/acknowledgement
 *
 * GET ?requestId=... reads the signed-in staff member's acknowledgement state
 * and positive reviewer projection. POST records the current publication for
 * the signed-in staff member. Reviewer identity and publication metadata are
 * always resolved server-side.
 */

import { withDalContext } from '../../../../lib/dataverse/core/context';
import {
  getFinalWriteupAcknowledgementState,
  markFinalWriteupReviewed,
} from '../../../../lib/services/final-writeup/acknowledgement-service';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { requireAppAccess } from '../../../../lib/utils/auth';
import { isGuid } from '../../../../lib/utils/guid';

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench final-writeup acknowledgement error:', error);
  return res.status(500).json({
    error: 'Final Writeup review tracking failed.',
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

  return withDalContext('workbench-final-writeup-acknowledgement', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const state = await getFinalWriteupAcknowledgementState({
          requestId,
          actingUserSystemId,
        });
        return res.status(200).json({ success: true, ...state });
      }

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
      const state = await markFinalWriteupReviewed({
        requestId,
        expectedFinalArtifactId,
        actingUserSystemId,
      });
      return res.status(200).json({ success: true, ...state });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
