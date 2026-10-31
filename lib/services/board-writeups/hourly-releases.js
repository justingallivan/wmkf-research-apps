/** One frozen notification group per hourly copy run; the cycle lock fences overlapping workers.
 * Stored as bounded releaseRuns in the existing cycle journal. This helper copies files, never sends mail.
 */
import crypto from 'node:crypto';
import { fail } from './model.js';
import { getRole, eligibleStaff } from './config.js';
import AlertService from '../alert-service.js';

export function legacyNoticeClaimed(state, batchId) {
  const mail = state.emails[`president:${batchId}`];
  return Boolean(mail && (mail.createStartedAt || mail.activityId || mail.sendStartedAt || mail.acceptedAt || mail.lease));
}

/** Resume an interrupted run before starting another; external copies stay outside the journal lock. */
export async function deliverHourlyReleases(cycle, overrides, writeBudget = {}, deadline = Infinity) {
  const d = { getRole, eligibleStaff, alert: async () => AlertService.createAlert({ type: 'board_writeup_attention', severity: 'warning', source: 'board-writeups', title: 'Board release approvals need attention', message: `${cycle}: An approval belongs to a different CSO; its notification remains held.`, autoResolveKey: `board-writeups:${cycle}:board_run_cso_changed` }), ...overrides };
  const initial = (await d.readCycle(cycle)).state;
  const covered = new Set(Object.values(initial.releaseRuns || {}).flatMap(run => (run.releases || []).map(row => `${row.requestId}:${row.approvedAt}`)));
  if (!Object.values(initial.releaseRuns || {}).some(run => !run.completedAt)
    && !Object.values(initial.releases).some(row => ['queued', 'uploading', 'validating'].includes(row.state)
      || row.state === 'released' && initial.releaseBatches?.[row.batchId] && !legacyNoticeClaimed(initial, row.batchId) && !covered.has(`${row.requestId}:${row.approvedAt}`))) return [];
  const cso = await d.getRole('cso');
  const staff = await d.eligibleStaff(cso.value?.systemUserId);
  const eligibleActor = row => row.actor?.systemUserId === cso.value?.systemUserId && row.actor?.profileId === staff.profileId;
  const now = () => new Date(d.now()).toISOString();
  const started = Date.parse(now()), token = crypto.randomUUID();
  const hour = new Date(started).toISOString().slice(0, 13);
  let heldActor = false;
  const claim = await d.mutateCycle(cycle, state => {
    state.releaseRuns ||= {};
    const pending = Object.entries(state.releaseRuns).find(([, run]) => !run.completedAt);
    const id = pending?.[0] || hour;
    let run = state.releaseRuns[id];
    if (run?.completedAt || run?.lease && Date.parse(run.lease.until) > Date.parse(now())) return null;
    if (!run) {
      const assigned = new Set(Object.values(state.releaseRuns).flatMap(item => (item.releases || []).map(row => `${row.requestId}:${row.approvedAt}`)));
      const candidates = Object.values(state.releases).filter(row => ['queued', 'uploading', 'validating', 'released'].includes(row.state)
        && !assigned.has(`${row.requestId}:${row.approvedAt}`)
        && (row.state !== 'released' || state.releaseBatches?.[row.batchId] && !legacyNoticeClaimed(state, row.batchId)));
      heldActor = candidates.some(row => !eligibleActor(row));
      const members = candidates.filter(eligibleActor).map(row => ({ requestId: row.requestId, approvedAt: row.approvedAt, batchId: row.batchId,
          notify: Boolean(state.releaseBatches?.[row.batchId]) && !legacyNoticeClaimed(state, row.batchId) }));
      if (!members.length) return null;
      if (Object.keys(state.releaseRuns).length >= 1000) fail('board_run_capacity', 'The cycle journal needs administrator attention.', 503);
      run = state.releaseRuns[id] = { startedAt: now(), members, releases: [], completedAt: null };
    }
    run.lease = { id: token, until: new Date(Date.parse(now()) + 600000).toISOString() };
    return { id, members: structuredClone(run.members) };
  });
  if (!claim) {
    if (heldActor) await d.alert(cycle, 'board_run_cso_changed');
    return [];
  }
  const assertLease = state => {
    const run = state.releaseRuns?.[claim.id];
    if (run?.lease?.id !== token || Date.parse(run.lease.until) <= Date.parse(now())) fail('board_run_lease_lost');
    return run;
  };
  const results = [];
  for (const member of claim.members) {
    if (Date.parse(now()) - started > 150000 || Date.parse(now()) > deadline) break;
    const { state } = await d.readCycle(cycle);
    assertLease(state);
    const row = state.releases[member.requestId];
    if (row?.approvedAt !== member.approvedAt || row?.batchId !== member.batchId) continue;
    if (['queued', 'uploading', 'validating'].includes(row.state)) results.push(await d.deliverRelease(cycle, member.requestId, writeBudget));
  }
  await d.mutateCycle(cycle, state => {
    const run = assertLease(state);
    run.releases = claim.members.flatMap(member => {
      const row = state.releases[member.requestId];
      if (row?.state === 'released' && !eligibleActor(row)) heldActor = true;
      return member.notify && eligibleActor(row || {}) && row?.approvedAt === member.approvedAt && row?.batchId === member.batchId
        && row.state === 'released' && row.releasedAt && !legacyNoticeClaimed(state, row.batchId) ? [structuredClone(row)] : [];
    });
    run.completedAt = now(); run.lease = null;
  });
  if (heldActor) await d.alert(cycle, 'board_run_cso_changed');
  return results;
}

export function releasedRun(state, runId) {
  const run = state.releaseRuns?.[runId];
  if (!run?.completedAt || !run.releases?.length) return null;
  const actor = run.releases[0].actor;
  if (!run.releases.every(row => row.actor?.systemUserId === actor?.systemUserId && row.actor?.profileId === actor?.profileId)) fail('board_run_cso_mismatch');
  return { ...run, actor };
}
