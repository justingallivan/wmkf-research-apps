/**
 * Admin Test Request Factory: a production run's Phase I / Phase II status.
 * GET lists the live options and the run's journaled changes (never behind the
 * write switch). POST `{ field, optionLabel }` makes one status change: the
 * service sends at most one fenced If-Match PATCH per change, then waits for
 * the Request's background jobs. 200 when complete; 202 when the answer is
 * "check again" (jobs still running, in progress, or unconfirmed). Never
 * cacheable.
 */

import { withDalContext } from '../../../../../../../lib/dataverse/core/context';
import { createAdminRunService } from '../../../../../../../lib/services/test-requests/admin-run-service';
import {
  hasOnlyKeys, invalidInput, isEmptyBody, isExactGuid, isRunId, routeDeadline, sendError,
} from '../../../../../../../lib/services/test-requests/admin-run-route-helpers';
import { requireSuperuser } from '../../../../../../../lib/utils/auth';

// maxDuration must be a literal: Next reads this export statically and fails the build on an identifier.
export const config = { api: { bodyParser: { sizeLimit: '32kb' } }, maxDuration: 300 };

const FIELDS = new Set(['phase1', 'phase2']);

export default async function handler(req, res) {
  // Anchored at entry, before the gate: time spent authenticating counts against the limit.
  const deadlineAt = routeDeadline(config.maxDuration);
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gate = await requireSuperuser(req, res);
  if (!gate) return;

  const runId = req.query?.runId;
  if (!isRunId(runId)) return invalidInput(res, 'runId must be a GUID.');

  if (req.method === 'GET') {
    return withDalContext('admin-test-request-runs-status-options', async () => {
      try {
        const body = await createAdminRunService().statusOptions({ profileId: gate.profileId, runId });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(body);
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  const body = req.body;
  if (isEmptyBody(body) || !hasOnlyKeys(body, ['field', 'optionLabel'], ['changeId'])) {
    return invalidInput(res, 'The body must be { field, optionLabel } with an optional changeId.');
  }
  // Present only for "Check again": the service then resumes that change or refuses, and never starts another.
  if (body.changeId !== undefined && !isExactGuid(body.changeId)) return invalidInput(res, 'changeId must be a GUID.');
  if (!FIELDS.has(body.field)) return invalidInput(res, 'field must be phase1 or phase2.');
  if (typeof body.optionLabel !== 'string' || body.optionLabel.trim().length < 1 || body.optionLabel.trim().length > 200) {
    return invalidInput(res, 'optionLabel must be 1 to 200 characters.');
  }

  return withDalContext('admin-test-request-runs-status', async () => {
    try {
      const result = await createAdminRunService().changeStatus({
        profileId: gate.profileId,
        runId,
        field: body.field,
        optionLabel: body.optionLabel.trim(),
        changeId: body.changeId ?? null,
        deadlineAt,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(result.outcome === 'complete' ? 200 : 202).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
