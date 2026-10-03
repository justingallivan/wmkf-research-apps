/**
 * Admin Test Request Factory: re-check a production run's last status change
 * (POST, no body). Reads Dataverse only; appends late effects to the ledger
 * journal. Behind TEST_REQUEST_FACTORY_FORM (the journal write).
 */

import { withDalContext } from '../../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../../lib/services/test-requests/admin-run-service';
import {
  invalidInput, isEmptyBody, isRunId, sendError,
} from '../../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../../lib/utils/auth';

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

  return withDalContext('admin-test-request-runs-status-recheck', async () => {
    try {
      const body = await createAdminRunService().statusRecheck({ profileId: gate.profileId, runId });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
