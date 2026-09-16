/**
 * API: /api/workbench/pre-rp-brief
 *
 * GET ?requestId=... -> read the current/pending governed Pre-Research
 * Presentation Brief.
 * POST { requestId, clientOperationId } -> generate, or safely reuse, one
 * governed Pre-RP Brief and return its registry/SharePoint identity.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  generatePreRpBrief,
  getPreRpBriefStatus,
} from '../../../lib/services/pre-rp-brief/artifact-service';
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
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      code: error.code || 'pre_rp_brief_failed',
    });
  }
  console.error('workbench pre-rp-brief error:', error);
  return res.status(500).json({
    error: 'Pre-Research Presentation Brief generation failed.',
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

  return withDalContext('workbench-pre-rp-brief', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const status = await getPreRpBriefStatus({ requestId });
        return res.status(200).json({ success: true, ...status });
      }

      if (!req.body
        || typeof req.body !== 'object'
        || Array.isArray(req.body)
        || Object.keys(req.body).some((key) => !['requestId', 'clientOperationId'].includes(key))) {
        return res.status(400).json({ error: 'POST body must contain only requestId and clientOperationId' });
      }
      const requestId = String(req.body.requestId || '').trim();
      const clientOperationId = String(req.body.clientOperationId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }
      if (!clientOperationId) {
        return res.status(400).json({ error: 'clientOperationId is required' });
      }

      const result = await generatePreRpBrief({
        requestId,
        clientOperationId,
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
