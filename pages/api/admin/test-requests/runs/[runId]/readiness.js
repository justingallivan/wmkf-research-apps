/**
 * Admin Test Request Factory: mark a prepared J27+ production test Request
 * ready for review (POST, no body). Runs the owner CLI's readiness checks
 * (readiness-finalizer.js), then sends at most one journaled If-Match PATCH of
 * wmkf_readyforreview = true and waits for the Request's background jobs.
 * 200 when complete; 202 when the answer is "check again" (POST again resumes
 * the same attempt and never sends a second PATCH). Readiness is never set
 * back to false. Owner, 2026-11-15: anyone with admin access may use it.
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
  // Anchored at entry, before the gate: time spent authenticating counts against the limit.
  const deadlineAt = routeDeadline(config.maxDuration);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const runId = req.query?.runId;
  if (!isRunId(runId)) return invalidInput(res, 'runId must be a GUID.');
  if (!isEmptyBody(req.body)) return invalidInput(res, 'This request takes no body.');

  return withDalContext('admin-test-request-runs-readiness', async () => {
    try {
      const result = await createAdminRunService().markReady({ profileId: gate.profileId, runId, deadlineAt });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(result.outcome === 'complete' ? 200 : 202).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
