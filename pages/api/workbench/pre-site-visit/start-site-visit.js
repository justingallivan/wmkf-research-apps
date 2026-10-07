/**
 * API: POST /api/workbench/pre-site-visit/start-site-visit
 *
 * Promotes the current Ready Pre-Site Word item into the Site Visit workspace.
 */

import { getUserRole, requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { startSiteVisitStage } from '../../../../lib/services/pre-site-visit/site-visit-transition-service';
import { getPreSiteVisitArtifactStatus } from '../../../../lib/services/pre-site-visit/artifact-service';
import { canChangeDraftWriteup, resolveWriteupViewer } from '../../../../lib/services/pre-site-visit/writeup-visibility';

export const config = {
  api: {
    bodyParser: { sizeLimit: '16kb' },
  },
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  console.error('workbench start-site-visit error:', error);
  return res.status(500).json({
    error: 'The Site Visit stage could not be started.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

function withoutCorrection(artifact) {
  if (!artifact) return artifact;
  const sanitized = { ...artifact };
  delete sanitized.correction;
  return sanitized;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;
  const role = access.profileId === null ? 'superuser' : await getUserRole(access.profileId);
  const includeCorrectionAudit = role === 'superuser';

  return withDalContext('workbench-start-site-visit', async () => {
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

      const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
      const [{ leadProgramDirectorId }, viewer] = await Promise.all([
        getPreSiteVisitArtifactStatus({ requestId }),
        resolveWriteupViewer({ isSuperuser: role === 'superuser', actingUserSystemId }),
      ]);
      if (!canChangeDraftWriteup(viewer, leadProgramDirectorId)) {
        throw new ServiceHttpError('Only the lead Program Director or a superuser can change this writeup.', {
          httpStatus: 403,
          code: 'pre_site_writeup_lead_only',
        });
      }
      const result = await startSiteVisitStage({ requestId, expectedArtifactId, actingUserSystemId });
      const payload = includeCorrectionAudit
        ? result
        : { ...result, artifact: withoutCorrection(result.artifact) };
      return res.status(200).json({ success: true, ...payload });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
