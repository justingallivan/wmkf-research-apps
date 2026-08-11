/**
 * API: /api/workbench/initial-assessment/versions
 *
 * GET ?requestId=<guid>&expectedArtifactId=<guid> → native SharePoint version
 * history for the exact Initial Assessment artifact the caller is displaying.
 *
 * `expectedArtifactId` binds the lazy history read to the artifact DTO already
 * rendered by the Workbench. If regeneration replaced that row in the meantime,
 * the service returns 409 instead of showing the replacement's editors under the
 * stale file link. SharePoint drive/item identity still comes only from the
 * selected registry row and is never accepted from the caller.
 *
 * READ-ONLY. Restoring a version is deliberately absent — that is the
 * administrator half, blocked on the outstanding SharePoint permission evidence
 * (`docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`). Do not add a restore branch here
 * without that evidence and an owner decision.
 *
 * Existing `reviewers` app access is the approved pilot gate, matching the
 * sibling route.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import { listInitialAssessmentArtifactVersions } from '../../../../lib/services/initial-assessment/artifact-service';

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench initial-assessment versions error:', error);
  return res.status(500).json({
    error: 'Initial Assessment version history request failed.',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  return withDalContext('workbench-initial-assessment-versions', async () => {
    try {
      const requestId = req.query.requestId ? String(req.query.requestId).trim() : null;
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }
      const expectedArtifactId = req.query.expectedArtifactId
        ? String(req.query.expectedArtifactId).trim()
        : null;
      if (!isGuid(expectedArtifactId)) {
        return res.status(400).json({
          error: 'expectedArtifactId is required and must be a GUID',
        });
      }
      const body = await listInitialAssessmentArtifactVersions({ requestId, expectedArtifactId });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
