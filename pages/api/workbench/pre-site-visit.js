/**
 * API: /api/workbench/pre-site-visit
 *
 * GET ?requestId=... -> read the current/pending governed Pre-Site artifact.
 * POST { requestId } -> generate, recover, or reuse one governed Pre-Site
 * Visit Word draft and return its registry/SharePoint identity.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  generatePreSiteVisitArtifact,
  getPreSiteVisitArtifactStatus,
} from '../../../lib/services/pre-site-visit/artifact-service';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: '16kb' },
  },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench pre-site-visit error:', error);
  return res.status(500).json({
    error: 'Pre-Site Visit draft generation failed.',
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

  return withDalContext('workbench-pre-site-visit', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const status = await getPreSiteVisitArtifactStatus({ requestId });
        return res.status(200).json({ success: true, ...status });
      }

      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => key !== 'requestId')) {
        return res.status(400).json({ error: 'POST body must contain only requestId' });
      }
      const requestId = String(req.body.requestId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }

      const result = await generatePreSiteVisitArtifact({
        requestId,
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      const generating = result.artifact.operationStatus
        === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING;
      return res.status(generating ? 202 : 200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
