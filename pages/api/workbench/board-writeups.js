/** Staff Board writeup dashboard and explicit CSO approval. */
import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { boardActor, listCycles } from '../../../lib/services/board-writeups/config';
import { dashboard, queueRelease } from '../../../lib/services/board-writeups/service';
import { cycleCode, exact } from '../../../lib/services/board-writeups/model';
export const config = { api: { bodyParser: { sizeLimit: '64kb' } }, maxDuration: 300 };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireAppAccess(req, res, 'reviewers');
  if (!gate) return;
  const actor = { profileId: gate.profileId, systemUserId: gate.session?.user?.dynamicsSystemuserId };
  return withDalContext('board-writeups', async () => {
    try {
      if (req.method === 'GET') {
        if (!req.query.cycle) {
          const staff = await boardActor(actor);
          return res.json({ canRelease: staff.canRelease, canArchive: staff.canArchive, isSuperuser: staff.isSuperuser, cycles: staff.canRelease || staff.canArchive ? await listCycles() : [] });
        }
        return res.json(await dashboard(cycleCode(req.query.cycle), actor));
      }
      exact(req.body, ['cycle', 'selections']);
      return res.status(202).json(await queueRelease(cycleCode(req.body.cycle), actor, req.body.selections));
    } catch (e) { return res.status(e.httpStatus || 500).json({ error: e.httpStatus ? e.message : 'Board writeups are unavailable.', code: e.code || 'board_unavailable' }); }
  });
}
