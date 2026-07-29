/**
 * API: /api/workbench/initial-assessment
 *
 * GET                                      → artifact-backed cycle list.
 * GET  ?requestId=<guid> | ?cycleCode=D26 → registry read model.
 * POST { requestId }                       → generate/reuse one artifact.
 *
 * Existing `reviewers` app access is the approved pilot gate.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  generateInitialAssessment,
  listInitialAssessmentArtifacts,
  listInitialAssessmentCycles,
} from '../../../lib/services/initial-assessment/artifact-service';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../../shared/config/requestDocument';

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { error: error.message });
  }
  console.error('workbench initial-assessment error:', error);
  return res.status(500).json({
    error: 'Initial Assessment request failed.',
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

  return withDalContext('workbench-initial-assessment', async () => {
    try {
      if (req.method === 'GET') {
        const requestId = req.query.requestId ? String(req.query.requestId).trim() : null;
        const cycleCode = req.query.cycleCode ? String(req.query.cycleCode).trim() : null;
        if (requestId && !isGuid(requestId)) {
          return res.status(400).json({ error: 'requestId is not a valid GUID' });
        }
        if (cycleCode && !/^[A-Za-z]\d{2}$/.test(cycleCode)) {
          return res.status(400).json({ error: 'cycleCode is invalid' });
        }
        if (!requestId && !cycleCode) {
          return res.status(200).json(await listInitialAssessmentCycles());
        }
        const body = await listInitialAssessmentArtifacts({ requestId, cycleCode });
        return res.status(200).json(body);
      }

      const requestId = String(req.body?.requestId || '').trim();
      if (!isGuid(requestId)) {
        return res.status(400).json({ error: 'requestId is required and must be a GUID' });
      }
      const result = await generateInitialAssessment({
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
