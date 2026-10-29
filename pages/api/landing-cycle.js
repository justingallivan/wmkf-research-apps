/**
 * Landing cycle (D29; docs/plans/LANDING_CYCLE_PLAN_2026-10-29.md).
 *
 * GET                → { landingCycleCode }            any signed-in staff (client-only app defaults)
 * GET ?view=board    → { cycleCode }                   any signed-in staff (Board pages' default)
 * GET ?view=editor   → editor detail incl. canEdit     any signed-in staff (calendar page control)
 * POST { cycleCode, revision } → editor detail         superuser / Grants Manager / Program Coordinator
 */
import { requireAuth } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  getLandingCycle,
  loadLandingCycleEditor,
  resolveBoardDefaultCycle,
  saveLandingCycle,
} from '../../lib/services/landing-cycle-service';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } }, maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const session = await requireAuth(req, res);
  if (!session) return;
  // requireAuth admits applicant portal sessions; this setting is staff-only.
  if (session.authBypassed || session.user?.userType === 'applicant' || !session.user?.profileId) {
    return res.status(403).json({ error: 'Staff access is required.', code: 'landing_staff_only' });
  }
  const actor = { profileId: session.user.profileId, systemUserId: session.user.dynamicsSystemuserId || null };
  return withDalContext('landing-cycle', async () => {
    try {
      if (req.method === 'GET') {
        const keys = Object.keys(req.query || {});
        const view = keys.length === 0 ? null : (keys.length === 1 && typeof req.query.view === 'string' ? req.query.view : undefined);
        if (view === null) return res.json({ landingCycleCode: (await getLandingCycle()).code });
        if (view === 'board') return res.json({ cycleCode: await resolveBoardDefaultCycle() });
        if (view === 'editor') return res.json(await loadLandingCycleEditor(actor));
        return res.status(400).json({ error: 'Unsupported landing cycle request.', code: 'landing_query_invalid' });
      }
      return res.json(await saveLandingCycle(actor, req.body));
    } catch (error) {
      return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'The landing cycle is unavailable. Reload and try again.', code: error.code || 'landing_unavailable' });
    }
  });
}
