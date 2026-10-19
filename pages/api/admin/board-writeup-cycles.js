/** Scoped workflow operations; setup mutations require a system administrator or assigned Grants Manager in service. */
import { boardWorkEnabled } from '../../../lib/services/board-writeups/mode';
import { requireAppAccess } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { boardActor, getRole, getCycle, saveCycle, saveRole, resumeConfig, staffDirectory } from '../../../lib/services/board-writeups/config';
import { candidates } from '../../../lib/services/board-writeups/source';
import { reconcile, startArchive, resolveDiscrepancy } from '../../../lib/services/board-writeups/archive';
import { recover, inspectRecovery } from '../../../lib/services/board-writeups/recovery';
import { completeCleanup } from '../../../lib/services/board-writeups/service';
import { cycleCode, exact, fail } from '../../../lib/services/board-writeups/model';
export const config = { api: { bodyParser: { sizeLimit: '96kb' } }, maxDuration: 300 };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const gate = await requireAppAccess(req, res, 'reviewers');
  if (!gate) return;
  if (!boardWorkEnabled()) return res.status(404).json({ error: 'Board writeups are disabled.', code: 'board_disabled' });
  const actor = { profileId: gate.profileId, systemUserId: gate.session?.user?.dynamicsSystemuserId };
  return withDalContext('board-writeup-admin', async () => {
    try {
      const staff = await boardActor(actor);
      if (!staff.canArchive) fail('board_admin_denied', 'An administrator or Grants Manager is required.', 403);
      if (req.method === 'GET') {
        const cycle = cycleCode(req.query.cycle);
        if (req.query.action === 'inspectRecovery') return res.json(await inspectRecovery(cycle, actor, req.query.requestId, req.query.operation));
        if (req.query.action === 'reconcile') return res.json(await reconcile(cycle, actor));
        return res.json({ staff: await staffDirectory(), cycle: await getCycle(cycle), candidates: await candidates(cycle), roles: { president: await getRole('president'), cso: await getRole('cso'), grantsManager: await getRole('grantsManager') } });
      }
      const input = req.body;
      exact(input, ['action', 'cycle', 'value', 'expectedRevision', 'reason', 'role', 'resolution']);
      if (input.action === 'role') return res.json(await saveRole(actor, input.role, input.value, input.expectedRevision));
      const cycle = cycleCode(input.cycle);
      if (input.action === 'completeCleanup') {
        exact(input, ['action', 'cycle']);
        return res.json(await completeCleanup(cycle, actor));
      }
      if (input.action === 'save') {
        if (input.value?.cycle !== cycle) fail('board_cycle_identity_mismatch');
        const choices = new Set((await candidates(cycle)).map(x => x.requestId));
        const existing = await getCycle(cycle);
        if (!input.value?.requestIds?.every(id => choices.has(id) || existing.value?.requestIds.includes(id))) fail('board_roster_candidate_mismatch', 'Refresh the proposal list; one or more requests changed.');
        return res.json(await saveCycle(actor, input.value, input.expectedRevision, input.reason));
      }
      if (input.action === 'reconcileConfig') return res.json(await resumeConfig(cycle, actor));
      if (input.action === 'archive') return res.json(await startArchive(cycle, actor, input.expectedRevision));
      if (input.action === 'recover') return res.json(await recover(cycle, actor, input.resolution));
      if (input.action === 'resolve') return res.json(await resolveDiscrepancy(cycle, actor, input.resolution));
      fail('board_action_invalid', 'Unknown action.', 400);
    } catch (e) { return res.status(e.httpStatus || 500).json({ error: e.httpStatus ? e.message : 'Board operation failed.', code: e.code || 'board_operation_failed' }); }
  });
}
