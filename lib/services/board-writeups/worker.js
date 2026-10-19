/** Bounded durable worker; disabled until explicit production activation. */
import { boardWorkEnabled } from './mode.js';
import { GraphService } from '../graph-service.js';
import AlertService from '../alert-service.js';
import { listCycles, getCycle, eligibleStaff } from './config.js';
import { readCycle, mutateCycle, firstEvent } from './store.js';
import { pacificTime, fail } from './model.js';
import { earliestHandoff } from './source.js';
import { deliverRelease } from './service.js';
import { archiveOne, reconcile } from './archive.js';
import { deliverNotice, noticeIntents, reconcileNotices } from './notifications.js';
export async function runBoardWorkflow(overrides = {}) {
  const d = { eligibleStaff, reconcile, reconcileNotices, listCycles, getCycle, readCycle, mutateCycle, earliestHandoff, deliverRelease, archiveOne, deliverNotice, now: () => Date.now(), ...overrides };
  if (!boardWorkEnabled()) return { enabled: false, results: [] };
  GraphService.assertBoardWriteEnvironment();
  const start = d.now(), results = [];
  const writeBudget = { assertBudget: () => { if (d.now() - start > 180000) fail('board_worker_budget_exhausted'); } };
  for (const cycle of await d.listCycles()) {
    if (d.now() - start > 150000) break;
    try {
      const config = await d.getCycle(cycle);
      if (!config.value?.active) continue;
      let { state } = await d.readCycle(cycle);
      if (!state.firstEventAt || !state.handoffBackfilledAt) {
        try {
          const at = await d.earliestHandoff(cycle, config.value.requestIds);
          await d.mutateCycle(cycle, journal => { firstEvent(journal, at); journal.handoffBackfilledAt = new Date(d.now()).toISOString(); journal.handoffError = null; });
        } catch (error) {
          await d.mutateCycle(cycle, journal => { journal.handoffError = error.code || 'board_handoff_unavailable'; });
          results.push({ cycle, status: 'needs_attention', code: error.code || 'board_handoff_unavailable' });
        }
      }
      // Prioritize scheduled staff reminders before potentially slow file work.
      state = (await d.readCycle(cycle)).state;
      for (const intent of noticeIntents(config.value, state, d.now()).filter(x => ['release', 'confirm', 'cleanup'].includes(x.kind))) {
        try { await d.deliverNotice(cycle, intent); } catch (error) { results.push({ cycle, status: 'notice_failed', code: error.code || 'board_notice_failed' }); }
      }
      for (const [id, row] of Object.entries(state.releases)) {
        if (d.now() - start > 150000) break;
        if (['queued', 'uploading', 'validating'].includes(row.state)) results.push(await d.deliverRelease(cycle, id, writeBudget));
      }
      state = (await d.readCycle(cycle)).state;
      for (const [id, row] of Object.entries(state.archives)) {
        if (d.now() - start > 150000) break;
        if (row.state === 'queued' || row.lease) await d.archiveOne(cycle, id, writeBudget);
      }
      state = (await d.readCycle(cycle)).state;
      const local = pacificTime(d.now());
      if (!state.archiveStartedAt && local.hour === 9 && config.value.boardEnds && local.date > config.value.boardEnds) {
        const admin = await d.eligibleStaff(config.value.adminId, { admin: true });
        await d.reconcile(cycle, admin);
        state = (await d.readCycle(cycle)).state;
      }
      await d.reconcileNotices(cycle);
      for (const intent of noticeIntents(config.value, state, d.now())) {
        if (d.now() - start > 210000) break;
        await d.deliverNotice(cycle, intent);
      }
    } catch (e) {
      await AlertService.createAlert({ type: 'board_writeup_worker', severity: 'warning', source: 'board-writeups', title: 'Board writeups need attention', message: `${cycle}: ${e.code || 'worker_failed'}`, autoResolveKey: `board-writeup-worker:${cycle}` });
      results.push({ cycle, status: 'failed', code: e.code || 'board_worker_failed' });
    }
  }
  return { enabled: true, results };
}
