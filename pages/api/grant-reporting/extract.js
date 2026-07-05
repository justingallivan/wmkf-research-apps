/**
 * API Route: /api/grant-reporting/extract
 *
 * POST: Extract structured grant report data and (optionally) compare the
 *       original proposal to the report for a goals assessment. Supports three
 *       modes:
 *
 *  - mode: "full"               Run extraction + goals assessment in parallel.
 *  - mode: "regenerate"         Re-run extraction for a single narrative field.
 *  - mode: "regenerate-goals"   Re-run only the goals assessment.
 *
 * Files are described by FileRef objects:
 *  { source: "upload",     fileUrl, filename }
 *  { source: "sharepoint", library, folder, filename }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → rate limit → model-override warm (route-level per
 * the Stage 4 gate contract) → API-key check → one service call per mode →
 * result/error→HTTP mapping. Business logic — including the exported-for-
 * headless-use helpers (`extractReport`, `compareProposalToReport`) and the
 * S330 per-write DAL context around the wmkf_ai_run audit log — lives in
 * lib/services/grant-reporting/extract-service.js. No route-level
 * withDalContext: the audit write is this surface's only Dataverse touch and
 * keeps its historical narrow context inside the service.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { nextRateLimiter } from '../../../shared/api/middleware/rateLimiter';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  handleFullExtract,
  regenerateField,
  regenerateGoals,
} from '../../../lib/services/grant-reporting/extract-service';

const APP_KEY = 'grant-reporting';
const limiter = nextRateLimiter({ max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;

  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  await loadModelOverrides();

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Claude API key not configured on server' });
  }

  const {
    mode = 'full',
    reportRef,
    proposalRef = null,
    headerFromDynamics = {},
    fieldKey,
    currentValues = {},
    requestGuid = null,
  } = req.body || {};

  const common = {
    apiKey,
    requestGuid,
    profileId: access.profileId,
    actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
  };

  try {
    let result;
    if (mode === 'full') {
      result = await handleFullExtract({ ...common, reportRef, proposalRef, headerFromDynamics });
    } else if (mode === 'regenerate') {
      result = await regenerateField({ ...common, reportRef, fieldKey, currentValues });
    } else if (mode === 'regenerate-goals') {
      result = await regenerateGoals({ ...common, reportRef, proposalRef, headerFromDynamics, currentValues });
    } else {
      return res.status(400).json({ error: `Unknown mode: ${mode}` });
    }
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof ServiceHttpError) {
      return res.status(err.httpStatus).json(err.body ?? { error: err.message });
    }
    // Convert known HTTP errors (file-loader / parse 502s) to proper status codes
    if (err.status && err.status >= 400 && err.status < 600) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[GrantReporting:extract] Unhandled error:', err);
    return res.status(500).json({
      error: 'Failed to process grant report',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
  maxDuration: 300,
};
