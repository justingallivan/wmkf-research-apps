/**
 * Superuser editor for program-specific Final Writeup matrix audiences.
 * GET resolves active Grant Programs and the exact reviewer-role roster.
 * PUT replaces the versioned reference-only configuration.
 */

import { withDalContext } from '../../../lib/dataverse/core/context';
import {
  getFinalWriteupMatrixAudienceAdminState,
  writeFinalWriteupMatrixAudienceConfig,
} from '../../../lib/services/final-writeup/matrix-audience-service';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { requireSuperuser } from '../../../lib/utils/auth';

export const config = {
  api: { bodyParser: { sizeLimit: '32kb' } },
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
  }
  console.error('admin Final Writeup matrix audiences error:', error);
  return res.status(500).json({ error: 'The Final Writeup matrix audience operation failed.' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  if (req.method === 'GET' && Object.keys(req.query || {}).length) {
    return res.status(400).json({ error: 'This endpoint does not accept query parameters.' });
  }

  return withDalContext('admin-final-writeup-matrix-audiences', async () => {
    try {
      if (req.method === 'GET') {
        const state = await getFinalWriteupMatrixAudienceAdminState();
        return res.status(200).json({ success: true, ...state });
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || Object.keys(req.body).length !== 2
        || !Object.hasOwn(req.body, 'config')
        || !Object.hasOwn(req.body, 'expectedRevision')) {
        return res.status(400).json({ error: 'The request body must contain only config and expectedRevision.' });
      }
      const state = await writeFinalWriteupMatrixAudienceConfig(
        req.body.config,
        req.body.expectedRevision,
        gate.profileId,
      );
      return res.status(200).json({ success: true, ...state });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
