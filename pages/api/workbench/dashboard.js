/**
 * API: /api/workbench/dashboard
 *
 * Tier-2 Request Workbench dashboard feed. Surfaces the requests a Program
 * Director needs to find reviewers for, in a chosen grant cycle, with a
 * per-request reviewer work-remaining rollup.
 *
 * Two modes (mirrors my-proposals.js):
 *   GET (no cycleCode)        → { cycles, defaultCycleCode } the user can pick.
 *   GET ?cycleCode=Dxx        → { proposals, rollup } for that cycle.
 *
 * Query params:
 *   ?cycleCode=Dxx|Jxx     the cycle to list (omit → cycle list mode)
 *   ?scope=my|all          my (default) = requests where the caller is lead PD;
 *                          all = every request in the cycle.
 *   ?includeSetAside=1     also show `Set aside` rows (default hides them).
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 4 wave): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. Triage-driven visibility (S261), the
 * cycle picker, and the proposal projection live in
 * lib/services/workbench/dashboard-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { loadDashboard } from '../../../lib/services/workbench/dashboard-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const azureEmail = access.session?.user?.azureEmail;
  if (!azureEmail) {
    return res.status(400).json({ error: 'Could not determine your email from the session. Sign out and back in.' });
  }

  const scope = req.query.scope === 'all' ? 'all' : 'my';
  const { cycleCode } = req.query;
  const includeSetAside = req.query.includeSetAside === '1';

  return withDalContext('workbench-dashboard', async () => {
    try {
      const body = await loadDashboard({
        azureEmail,
        profileId: access.profileId,
        cycleCode,
        scope,
        includeSetAside,
      });
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof ServiceHttpError) {
        return res.status(err.httpStatus).json(err.body ?? { error: err.message });
      }
      console.error('workbench dashboard error:', err);
      return res.status(500).json({
        error: 'Failed to load dashboard',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });
}
