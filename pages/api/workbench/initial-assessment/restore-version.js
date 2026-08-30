/**
 * API: POST /api/workbench/initial-assessment/restore-version
 *
 * Superuser-only native SharePoint version restore. All SharePoint identity is
 * resolved from the canonical Request Document row; caller values are fences.
 */

import { getUserRole, requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { restoreInitialAssessmentVersion } from '../../../../lib/services/initial-assessment/controls-service';

const BODY_KEYS = new Set([
  'requestId',
  'expectedArtifactId',
  'targetVersionId',
  'expectedCurrentVersionId',
]);

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
  maxDuration: 300,
};

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? {
      error: error.message,
      code: error.code || 'initial_assessment_restore_failed',
    });
  }
  console.error('workbench Initial Assessment restore error:', error);
  return res.status(500).json({
    error: 'The Initial Assessment version could not be restored.',
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
    || Object.keys(req.body).length !== BODY_KEYS.size
    || Object.keys(req.body).some((key) => !BODY_KEYS.has(key))) {
    return res.status(400).json({ error: 'POST body must contain exactly the restore fields' });
  }
  const requestId = String(req.body.requestId || '').trim();
  const expectedArtifactId = String(req.body.expectedArtifactId || '').trim();
  if (!isGuid(requestId) || !isGuid(expectedArtifactId)) {
    return res.status(400).json({
      error: 'requestId and expectedArtifactId are required and must be GUIDs',
    });
  }

  return withDalContext('workbench-initial-assessment-restore', async () => {
    try {
      const result = await restoreInitialAssessmentVersion({
        requestId,
        expectedArtifactId,
        targetVersionId: req.body.targetVersionId,
        expectedCurrentVersionId: req.body.expectedCurrentVersionId,
      }, { actingUserSystemId });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
