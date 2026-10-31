/** Bounded durable worker; disabled until explicit production activation. */
import { boardWorkEnabled } from './mode.js';
import { GraphService } from '../graph-service.js';
import AlertService from '../alert-service.js';
import { listCycles, getCycle, eligibleStaff } from './config.js';
import { cycleDates } from './calendar.js';
import { readCycle, mutateCycle, firstEvent } from './store.js';
import { pacificTime, fail } from './model.js';
import { earliestHandoff } from './source.js';
import { deliverRelease } from './service.js';
import { deliverHourlyReleases } from './hourly-releases.js';
import { archiveOne, reconcile } from './archive.js';
import { deliverNotice, noticeIntents, reconcileNotices } from './notifications.js';
export async function runBoardWorkflow(overrides = {}) {
  const d = { cycleDates, eligibleStaff, reconcile, reconcileNotices, listCycles, getCycle, readCycle, mutateCycle, earliestHandoff, deliverRelease, archiveOne, deliverNotice, now: () => Date.now(), ...overrides };
  if (!boardWorkEnabled()) return { enabled: false, results: [] };
  GraphService.assertBoardWriteEnvironment();
  const start = d.now(), results = [];
  const writeBudget = { assertBudget: () => { if (d.now() - start > 180000) fail('board_worker_budget_exhausted'); } };
  for (const cycle of await d.listCycles()) {
    if (d.now() - start > 150000) break;
    try {
      const config = await d.getCycle(cycle);
      if (!config.value?.active) continue;
      // Archive start and every notice wait for a readable calendar: a failed read never moves archive timing.
      let dates = null;
      try { dates = await d.cycleDates(cycle); }
      catch (error) {
        if (error.code !== 'board_calendar_unavailable') throw error;
        results.push({ cycle, status: 'calendar_unavailable', code: error.code });
        try { await AlertService.createAlert({ type: 'board_writeup_worker', severity: 'warning', source: 'board-writeups', title: 'Board writeups could not read the cycle calendar', message: `${cycle}: ${error.code}`, autoResolveKey: `board-writeup-calendar:${cycle}` }); }
        catch { /* Release and archive deliveries below still run. */ }
      }
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
      for (const intent of dates ? noticeIntents(config.value, state, d.now(), dates).filter(x => ['release', 'confirm', 'cleanup'].includes(x.kind)) : []) {
        try { await d.deliverNotice(cycle, intent); } catch (error) { results.push({ cycle, status: 'notice_failed', code: error.code || 'board_notice_failed' }); }
      }
      try { results.push(...await deliverHourlyReleases(cycle, d, writeBudget, start + 150000)); }
      catch (error) {
        const code = error.code || 'board_release_run_failed';
        results.push({ cycle, status: 'needs_attention', code });
        try { await AlertService.createAlert({ type: 'board_writeup_attention', severity: 'warning', source: 'board-writeups', title: 'Board release run needs attention', message: `${cycle}: ${code}`, autoResolveKey: `board-writeups:${cycle}:${code}` }); }
        catch { /* Release/alert failures must not starve independent archive or email reconciliation. */ }
      }
      state = (await d.readCycle(cycle)).state;
      for (const [id, row] of Object.entries(state.archives)) {
        if (d.now() - start > 150000) break;
        if (row.state === 'queued' || row.lease) await d.archiveOne(cycle, id, writeBudget);
      }
      state = (await d.readCycle(cycle)).state;
      const local = pacificTime(d.now());
      if (dates && !state.archiveStartedAt && local.hour === 9 && dates.boardEnds && local.date > dates.boardEnds) {
        const admin = await d.eligibleStaff(config.value.adminId, { admin: true });
        await d.reconcile(cycle, admin);
        state = (await d.readCycle(cycle)).state;
      }
      await d.reconcileNotices(cycle);
      for (const intent of dates ? noticeIntents(config.value, state, d.now(), dates) : []) {
        if (d.now() - start > 210000) break;
        try { await d.deliverNotice(cycle, intent); }
        catch (error) {
          try { await AlertService.createAlert({ type: 'board_writeup_attention', severity: 'warning', source: 'board-writeups', title: 'Board notification needs attention', message: `${cycle}: ${error.code || 'board_notice_failed'}`, autoResolveKey: `board-writeups:${cycle}:${intent.key}` }); }
          catch { /* An alert outage must not starve later batch notices. */ }
          results.push({ cycle, status: 'notice_failed', code: error.code || 'board_notice_failed' });
        }
      }
    } catch (e) {
      await AlertService.createAlert({ type: 'board_writeup_worker', severity: 'warning', source: 'board-writeups', title: 'Board writeups need attention', message: `${cycle}: ${e.code || 'worker_failed'}`, autoResolveKey: `board-writeup-worker:${cycle}` });
      results.push({ cycle, status: 'failed', code: e.code || 'board_worker_failed' });
    }
  }
  return { enabled: true, results };
}
