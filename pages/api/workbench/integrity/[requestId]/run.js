/** POST a request-scoped integrity screening; request identities are server-owned. */
export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 300 };
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { nextRateLimiter } from '../../../../../shared/api/middleware/rateLimiter';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { loadModelOverrides } from '../../../../../lib/services/model-override-loader';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { runWorkbenchIntegrityScreen } from '../../../../../lib/services/workbench/integrity-service';
import { readJ27IntegrityJob } from '../../../../../lib/services/workbench/j27-integrity-jobs';
import { isJ27IntegritySimulationRequest } from '../../../../../lib/utils/j27-integrity-readiness';
import { isGuid } from '../../../../../lib/utils/guid';

const limiter = nextRateLimiter({ max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // The Workbench page loads only with 'reviewers' (resolve-request), and the
  // Integrity tab shows only with 'integrity-screener'; require both here.
  const workbenchAccess = await requireAppAccess(req, res, 'reviewers');
  if (!workbenchAccess) return;
  const access = await requireAppAccess(req, res, 'integrity-screener');
  if (!access) return;
  const allowed = await limiter(req, res);
  if (allowed !== true) return;

  const rawRequestId = req.query.requestId;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (isJ27IntegritySimulationRequest(requestId)) {
    return res.status(409).json({ error: 'This request is reserved for automatic screening rehearsal.' });
  }

  try {
    // The integrity engine resolves its model synchronously from the warmed
    // override registry; warm it before entering the service and any LLM call.
    await loadModelOverrides();
  } catch (error) {
    console.error('workbench integrity model override load failed:', error);
    return res.status(503).json({ error: 'Screening configuration is unavailable' });
  }

  return withDalContext('workbench-integrity-run', async () => {
    try {
      const automaticScreen = await readJ27IntegrityJob(requestId);
      if (automaticScreen === 'queued' || automaticScreen === 'running') {
        return res.status(409).json({ error: 'An automatic screen is already scheduled or running. Check its status first.' });
      }
      const result = await runWorkbenchIntegrityScreen({
        requestId,
        actorProfileId: access.profileId || null,
        claudeApiKey: process.env.CLAUDE_API_KEY,
        serpApiKey: process.env.SERP_API_KEY || null,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message });
      }
      console.error('workbench integrity run error:', error);
      return res.status(500).json({ error: 'Could not confirm screening completion; reload before starting another run' });
    }
  });
}
