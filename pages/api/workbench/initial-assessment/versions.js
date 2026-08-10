/**
 * API: /api/workbench/initial-assessment/versions
 *
 * GET ?requestId=<guid> → native SharePoint version history for that request's
 *                         canonical Initial Assessment artifact, newest first.
 *
 * Keyed on `requestId` rather than the registry row id so the contract matches
 * the sibling `/api/workbench/initial-assessment` read the Workbench already
 * uses: the caller asks about the artifact it is displaying, and the service
 * resolves the same Ready, non-superseded row. The SharePoint drive/item
 * identity is read from that row server-side and is never accepted from the
 * caller.
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
      const body = await listInitialAssessmentArtifactVersions({ requestId });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
