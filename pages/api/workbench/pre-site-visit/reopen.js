/**
 * API: POST /api/workbench/pre-site-visit/reopen
 *
 * Superuser-only guarded reopen. Caller identities are expected-value and
 * confirmation inputs only; the service independently resolves all Dataverse
 * and SharePoint authority before creating a successor.
 */

import { getUserRole, requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { reopenPreSiteVisit } from '../../../../lib/services/pre-site-visit/reopen-service';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../../shared/config/requestDocument';

const BODY_KEYS = new Set([
  'requestId',
  'expectedArtifactId',
  'clientOperationId',
  'requestNumber',
  'reasonCode',
  'reasonNote',
]);

export const config = {
  api: {
    bodyParser: { sizeLimit: '8kb' },
  },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      code: error.code || 'pre_site_reopen_failed',
    });
  }
  console.error('workbench pre-site reopen error:', error);
  return res.status(500).json({
    error: 'The Pre-Site draft could not be reopened.',
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
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  if (role !== 'superuser') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  if (access.profileId !== null && !actingUserSystemId) {
    return res.status(403).json({ error: 'A linked Dynamics staff identity is required' });
  }

  if (!req.body
    || typeof req.body !== 'object'
    || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !BODY_KEYS.has(key))
    || Object.keys(req.body).length !== BODY_KEYS.size) {
    return res.status(400).json({
      error: 'POST body must contain exactly the guarded-reopen fields',
    });
  }

  return withDalContext('workbench-pre-site-reopen', async () => {
    try {
      const result = await reopenPreSiteVisit(req.body, { actingUserSystemId });
      const inProgress = result.inProgress
        || result.artifact?.operationStatus === REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING;
      return res.status(inProgress ? 202 : 200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
