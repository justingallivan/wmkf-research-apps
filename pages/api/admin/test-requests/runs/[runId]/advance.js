/**
 * Admin Test Request Factory: advance one run by one step (POST, no body).
 * Behind TEST_REQUEST_FACTORY_FORM (enforced by the service). The service
 * refuses to start a step with under 150 s of the 300 s limit left.
 */

import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../lib/services/test-requests/admin-run-service';
import {
  invalidInput, isEmptyBody, isRunId, routeDeadline, sendError,
} from '../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../lib/utils/auth';

const MAX_DURATION_SECONDS = 300;

export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: MAX_DURATION_SECONDS };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const runId = req.query?.runId;
  if (!isRunId(runId)) return invalidInput(res, 'runId must be a GUID.');
  if (!isEmptyBody(req.body)) return invalidInput(res, 'This request takes no body.');

  return withDalContext('admin-test-request-runs-advance', async () => {
    try {
      const body = await createAdminRunService().advance({
        profileId: gate.profileId,
        runId,
        deadlineAt: routeDeadline(MAX_DURATION_SECONDS),
      });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
