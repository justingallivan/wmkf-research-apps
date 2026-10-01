/**
 * Admin Test Request Factory: read a run's stored manifest and bundle for
 * download. Read-only; never behind the write switch. Not cacheable.
 */

import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../lib/services/test-requests/admin-run-service';
import { invalidInput, isRunId, sendError } from '../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../lib/utils/auth';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const runId = req.query?.runId;
  if (!isRunId(runId)) return invalidInput(res, 'runId must be a GUID.');

  return withDalContext('admin-test-request-runs-artifacts', async () => {
    try {
      const body = await createAdminRunService().readArtifacts({ profileId: gate.profileId, runId });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
