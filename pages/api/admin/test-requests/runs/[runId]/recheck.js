/**
 * Admin Test Request Factory: re-verify a production run's foundation
 * transition (POST, no body). Read-only against Dataverse; never behind the
 * write switch.
 */

import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../lib/services/test-requests/admin-run-service';
import {
  invalidInput, isEmptyBody, isRunId, sendError,
} from '../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../lib/utils/auth';

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

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

  return withDalContext('admin-test-request-runs-recheck', async () => {
    try {
      const body = await createAdminRunService().recheck({ profileId: gate.profileId, runId });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
