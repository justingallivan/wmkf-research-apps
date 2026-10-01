/**
 * Admin Test Request Factory: look up a production source Request.
 *
 * POST { sourceRequestNumber } exports a read-only source bundle into a
 * server-held draft and returns { draftId, summary, defaults }. Behind
 * TEST_REQUEST_FACTORY_FORM (enforced by the service).
 */

import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../lib/services/test-requests/admin-run-service';
import {
  hasOnlyKeys, invalidInput, isRequestNumber, routeDeadline, sendError,
} from '../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../lib/utils/auth';

// maxDuration must be a literal: Next reads this export statically and fails the build on an identifier.
export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 300 };

export default async function handler(req, res) {
  // Anchored at entry, before the gate: time spent authenticating counts against the limit.
  const deadlineAt = routeDeadline(config.maxDuration);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  if (!hasOnlyKeys(req.body, ['sourceRequestNumber']) || !isRequestNumber(req.body.sourceRequestNumber)) {
    return invalidInput(res, 'The body must contain only sourceRequestNumber (digits).');
  }

  return withDalContext('admin-test-request-runs-source', async () => {
    try {
      const body = await createAdminRunService().exportSource({
        profileId: gate.profileId,
        sourceRequestNumber: req.body.sourceRequestNumber,
        deadlineAt,
      });
      return res.status(200).json(body);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
