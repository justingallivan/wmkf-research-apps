/**
 * API Route: /api/expertise-finder/batch-match
 *
 * POST: Match a single Dynamics proposal to the expertise roster.
 *
 * Resolves proposal → SharePoint folder → Phase_I_Staff_Version PDF → pdf-parse → Claude.
 * Uses the same prompt and matching logic as the interactive match endpoint.
 *
 * Request body:
 *   requestId: string       - Dynamics akoya_request GUID
 *   requestNumber: string   - For display/logging
 *   additionalNotes: string - Optional user context
 *
 * Returns: { success, matchId, results, metadata }
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 5): method
 * dispatch → auth guard → model-override warm (route-level per the Stage 4
 * gate contract) → input validation → withDalContext → one service call →
 * result/error→HTTP mapping. Business logic lives in
 * lib/services/expertise-finder/batch-match-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { loadModelOverrides } from '../../../lib/services/model-override-loader';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { batchMatch } from '../../../lib/services/expertise-finder/batch-match-service';

const APP_KEY = 'expertise-finder';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, APP_KEY);
  if (!access) return;

  await loadModelOverrides();

  const { requestId, requestNumber, additionalNotes } = req.body || {};

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' });
  }

  return withDalContext('expertise-finder-batch-match', async () => {
    try {
      const result = await batchMatch({
        requestId,
        requestNumber,
        additionalNotes,
        profileId: access.profileId,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      throw error;
    }
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
