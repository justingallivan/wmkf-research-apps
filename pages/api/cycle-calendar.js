/** Cycle calendar (D43): any signed-in staff may read; superuser / Grants Manager / Program Coordinator may save one date. */
import { requireAuth } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { loadCalendar, saveDate } from '../../lib/services/cycle-calendar-service';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const session = await requireAuth(req, res);
  if (!session) return;
  // requireAuth admits applicant portal sessions; this page is staff-only.
  if (session.authBypassed || session.user?.userType === 'applicant' || !session.user?.profileId) {
    return res.status(403).json({ error: 'Staff access is required.', code: 'calendar_staff_only' });
  }
  const actor = { profileId: session.user.profileId, systemUserId: session.user.dynamicsSystemuserId || null };
  return withDalContext('cycle-calendar', async () => {
    try {
      if (req.method === 'GET') {
        if (Object.keys(req.query || {}).length) return res.status(400).json({ error: 'Unsupported calendar request.', code: 'calendar_query_invalid' });
        return res.json(await loadCalendar(actor));
      }
      return res.json(await saveDate(actor, req.body));
    } catch (error) {
      return res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'The cycle calendar is unavailable. Reload and try again.', code: error.code || 'calendar_unavailable' });
    }
  });
}
