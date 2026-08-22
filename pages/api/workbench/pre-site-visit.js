/**
 * API: /api/workbench/pre-site-visit
 *
 * GET ?requestId=... -> read the current/pending governed Pre-Site artifact.
 * POST { requestId } -> generate, recover, or reuse one governed Pre-Site
 * Visit Word draft and return its registry/SharePoint identity.
 */

import { getUserRole, requireAppAccess } from '../../../lib/utils/auth';
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
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      code: error.code || 'pre_site_visit_failed',
    });
  }
  console.error('workbench pre-site-visit error:', error);
  return res.status(500).json({
    error: 'Pre-Site Visit draft generation failed.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

function withoutCorrection(artifact) {
  if (!artifact) return artifact;
  const sanitized = { ...artifact };
  delete sanitized.correction;
  return sanitized;
}

function staffSafePayload(payload) {
  const sanitized = {
    ...payload,
    currentArtifact: withoutCorrection(payload.currentArtifact),
    pendingArtifact: withoutCorrection(payload.pendingArtifact),
    artifact: withoutCorrection(payload.artifact),
  };
  delete sanitized.reopenHistory;
  return sanitized;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const includeCorrectionAudit = role === 'superuser';

  return withDalContext('workbench-pre-site-visit', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = String(req.query?.requestId || '').trim();
        if (!isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is required and must be a GUID' });
        }
        const status = await getPreSiteVisitArtifactStatus({ requestId });
        const payload = includeCorrectionAudit ? status : staffSafePayload(status);
        return res.status(200).json({ success: true, ...payload });
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
      const payload = includeCorrectionAudit ? result : staffSafePayload(result);
      return res.status(generating ? 202 : 200).json({ success: true, ...payload });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
