// @ts-check
/**
 * API: /api/workbench/triage
 *
 * POST — set the triage status (`wmkf_triagestatus`) on a request. Triage is a
 * staff winnowing signal that drives DASHBOARD VISIBILITY ONLY (Advancing vs
 * Set aside; reversible). Body: { requestId (akoya_request GUID),
 * triageStatus (numeric option value) }.
 *
 * AUTHORIZATION: requireAppAccess('reviewers') here, then a HARD server-side
 * manage gate (superuser OR lead PD) enforced in the service — see
 * lib/services/workbench/triage-service.js and
 * docs/WORKBENCH_TRIAGE_FIELD_BUILD_PLAN.md.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping.
 */

import { requireAppAccess, actorRefFromSession } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { isGuid } from '../../../lib/utils/guid';
import { isValidTriageValue } from '../../../shared/config/triageStatus';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { setTriageStatus } from '../../../lib/services/workbench/triage-service';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

/**
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  // Read requestId directly off req.body (not via an intermediate var) so the
  // trust-boundary-guid gate tracks the taint root through to the isGuid guard.
  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const triageStatus = req.body?.triageStatus;

  // GUID-validate BEFORE requestId becomes a record-id selector (check:trust-boundary-guid).
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!isValidTriageValue(triageStatus)) {
    return res.status(400).json({ error: 'triageStatus must be a valid triage option value' });
  }
  const triageValue = Number(triageStatus);

  return withDalContext('workbench-triage', async () => {
    try {
      const body = await setTriageStatus({
        requestId,
        triageValue,
        profileId: access.profileId,
        // Mint the branded write-actor from the session (Invariant-Map #10) —
        // the sole sanctioned source of setTriageStatus's ActorRef. Runtime-
        // identical to the prior `session?.user?.dynamicsSystemuserId || null`.
        callerSystemId: actorRefFromSession(access.session),
      });
      return res.status(200).json(body);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('workbench triage error:', error);
      return res.status(500).json({
        error: 'Failed to set triage status',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      });
    }
  });
}
