/**
 * Admin Test Request Factory runs.
 *
 * GET lists the signed-in staff member's runs ({ runs, formEnabled, target }). POST confirms a
 * saved source draft and reserves a run (201 new, 200 same-key retry); it runs
 * at the default function limit and never starts a step. Writes sit behind
 * TEST_REQUEST_FACTORY_FORM (enforced by the service).
 */

import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../lib/services/test-requests/admin-run-service';
import {
  hasOnlyKeys, invalidInput, isCycleCode, isExactGuid, isIdempotencyKey, isRequestNumber, isTestLabel, sendError,
} from '../../../../../lib/services/test-requests/admin-run-route-helpers';
import { getSession, requireSuperuser } from '../../../../../lib/utils/auth';

const REQUIRED_POST_KEYS = Object.freeze(['draftId', 'idempotencyKey', 'confirmSourceRequestNumber', 'testLabel', 'cycleCode']);

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (req.method === 'GET') {
    return withDalContext('admin-test-request-runs-list', async () => {
      try {
        const body = await createAdminRunService().listRuns({ profileId: gate.profileId });
        return res.status(200).json(body); // { runs, formEnabled, target }
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  const body = req.body;
  if (!hasOnlyKeys(body, REQUIRED_POST_KEYS)
      || !isExactGuid(body.draftId)
      || !isIdempotencyKey(body.idempotencyKey)
      || !isRequestNumber(body.confirmSourceRequestNumber)
      || !isTestLabel(body.testLabel)
      || !isCycleCode(body.cycleCode)) {
    return invalidInput(res, 'The body must contain draftId, idempotencyKey, confirmSourceRequestNumber, testLabel and a cycleCode (J or D and two digits).');
  }

  return withDalContext('admin-test-request-runs-confirm', async () => {
    try {
      const session = await getSession(req, res);
      const result = await createAdminRunService().confirmRun({
        profileId: gate.profileId,
        actorEmail: session?.user?.azureEmail ?? null,
        draftId: body.draftId,
        idempotencyKey: body.idempotencyKey,
        confirmSourceRequestNumber: body.confirmSourceRequestNumber,
        testLabel: body.testLabel,
        cycleCode: body.cycleCode,
      });
      return res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
