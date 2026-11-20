/**
 * API Route: /api/phase-i-dynamics/summarize
 *
 * POST: Single-request Phase I proposal summarization with Dynamics writeback.
 *
 * - Loads a proposal file (SharePoint or upload) identified by a FileRef.
 * - Runs the Phase I summarization prompt (same prompt used by the batch app).
 * - Writes the narrative summary to akoya_request.wmkf_ai_summary via PATCH.
 * - Logs an append-only audit row to wmkf_ai_run (taskType=summary).
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → rate limit → model-override warm (route-level per
 * the Stage 4 gate contract) → input validation → withDalContext (label kept)
 * → one service call → result/error→HTTP mapping. Business logic (overwrite
 * preflight, If-Match writeback, audit row) lives in
 * lib/services/phase-i-dynamics/summarize-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { loadModelOverrides } from '../../../shared/config';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { summarizeToDynamics } from '../../../lib/services/phase-i-dynamics/summarize-service';

const APP_KEY = 'batch-phase-i-summaries';
const limiter = nextRateLimiter({ max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Claude API key not configured on server' });
  }

  const {
    requestGuid = null,
    fileRef = null,
    summaryLength = 1,
    summaryLevel = 'technical-non-expert',
    overwrite = false,
  } = req.body || {};

  if (!requestGuid) {
    return res.status(400).json({ error: 'requestGuid is required' });
  }
  // GUID-validate before it becomes an akoya_request record-id selector
  // (getRecord/updateRecord interpolate it raw into the request URL).
  if (!isGuid(requestGuid)) {
    return res.status(400).json({ error: 'requestGuid is not a valid GUID' });
  }
  if (!fileRef) {
    return res.status(400).json({ error: 'fileRef is required' });
  }

  return withDalContext('phase-i-dynamics', async () => {
    try {
      const result = await summarizeToDynamics({
        requestGuid,
        fileRef,
        summaryLength,
        summaryLevel,
        overwrite,
        apiKey,
        profileId: access.profileId,
        actingUserSystemId,
      });
      return res.status(200).json(result);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      if (err.status && err.status >= 400 && err.status < 600) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('[PhaseIDynamics:summarize] Unhandled error:', err);
      return res.status(500).json({
        error: 'Failed to summarize proposal',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 300,
};
