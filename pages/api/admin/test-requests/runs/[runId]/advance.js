/**
 * Admin Test Request Factory: advance one run by one step (POST, no body).
 * Behind TEST_REQUEST_FACTORY_FORM (enforced by the service). The service
 * starts a step only within the first 130 s of the 300 s limit (150 s before
 * the route deadline). A failed step's error text is returned to the caller
 * (never stored), so the response is not cacheable.
 */

import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../lib/services/test-requests/admin-run-service';
import {
  invalidInput, isEmptyBody, isRunId, routeDeadline, sendError,
} from '../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../lib/utils/auth';

// maxDuration must be a literal: Next reads this export statically and fails the build on an identifier.
export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 300 };

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
        deadlineAt: routeDeadline(config.maxDuration),
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
