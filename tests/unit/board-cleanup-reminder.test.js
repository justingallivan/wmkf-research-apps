/** @jest-environment node */
import { cleanupStatus, PROGRAM_ID } from '../../lib/services/board-writeups/model';
import { emptyState } from '../../lib/services/board-writeups/store';
import { noticeIntents, deliverNotice, reconcileNotices } from '../../lib/services/board-writeups/notifications';
import { runBoardWorkflow } from '../../lib/services/board-writeups/worker';
import { completeCleanup, dashboard } from '../../lib/services/board-writeups/service';
const ID = '11111111-1111-4111-8111-111111111111';
const config = { version: 1, cycle: 'D26', programId: PROGRAM_ID, active: true, rosterConfirmed: true, requestIds: [ID], adminId: ID };
const DATES = { materialsDue: '2026-11-01', boardEnds: '2026-12-01' };
const actor = { profileId: 'admin-profile', systemUserId: ID };
function fixture() {
  const state = emptyState();
  let now = '2026-12-08T17:00:00Z';
  const d = { getCycle: jest.fn(async () => ({ value: config, revision: 'etag' })), cycleDates: jest.fn(async () => DATES),
    now: () => now, readCycle: async () => ({ state: structuredClone(state), revision: 0 }),
    mutateCycle: jest.fn(async (_cycle, fn) => fn(state)),
    boardActor: jest.fn(async () => ({ canArchive: true, isSuperuser: true, systemUserId: ID, name: 'Admin' })),
    eligibleStaff: jest.fn(async () => ({ email: 'admin@wmkeck.org' })), getRole: jest.fn(() => { throw new Error('No other recipients'); }),
    getRequest: jest.fn(() => { throw new Error('Cleanup must not read discussion/proposal data'); }),
    create: jest.fn(async () => 'email-id'), get: jest.fn(async () => ({ activityid: 'email-id', statuscode: 1 })),
    find: jest.fn(async () => []), send: jest.fn(), alert: jest.fn() };
  return { state, d, setNow: value => { now = value; } };
}
const original = { ...process.env };
beforeEach(() => { process.env.NEXTAUTH_URL = 'https://tools.wmkeck.org'; process.env.NOTIFICATION_EMAIL_FROM = 'system@wmkeck.org'; });
afterAll(() => { process.env = original; });
const cleanup = (value, state, now, dates = DATES) => noticeIntents(value, state, now, dates).filter(x => x.kind === 'cleanup');

test.each([
  ['2026-12-01', '2026-12-08T17:00:00Z', '2026-12-08'],
  ['2026-10-28', '2026-11-04T17:00:00Z', '2026-11-04'], // fall DST
  ['2027-03-07', '2027-03-14T16:00:00Z', '2027-03-14'], // spring DST
  ['2026-12-28', '2027-01-04T17:00:00Z', '2027-01-04'],
])('seven calendar days after %s, at 9 Pacific across DST/year boundaries', (boardEnds, now, date) => {
  const dates = { ...DATES, boardEnds }, state = emptyState();
  expect(cleanupStatus(dates, state, now).dueDate).toBe(date);
  expect(cleanup(config, state, now, dates)).toEqual([{ key: `cleanup:${date}`, kind: 'cleanup' }]);
  expect(cleanup(config, state, Date.parse(now) - 3600000, dates)).toEqual([]);
  expect(cleanup(config, state, Date.parse(now) - 86400000, dates)).toEqual([]);
});
test('inactive/missing-date/completed cycles stay quiet; archive completion does not stop cleanup', () => {
  const { state, d } = fixture();
  expect(cleanup({ ...config, active: false }, state, d.now())).toEqual([]);
  expect(cleanup(config, state, d.now(), { ...DATES, boardEnds: null })).toEqual([]);
  expect(cleanup(config, state, d.now(), null)).toEqual([]);
  state.archiveStartedAt = '2026-12-02T18:00:00Z'; state.archiveCompletedAt = '2026-12-03T18:00:00Z';
  expect(cleanup(config, state, d.now())).toHaveLength(1);
  state.cleanupCompletedAt = d.now();
  expect(cleanup(config, state, d.now())).toEqual([]);
});
test('one email per Pacific day to admin only, no catch-up burst or proposal reads', async () => {
  const { state, d, setNow } = fixture();
  const intent = { key: 'cleanup:2026-12-08', kind: 'cleanup' };
  await Promise.all([deliverNotice('D26', intent, d), deliverNotice('D26', intent, d)]);
  await deliverNotice('D26', intent, d);
  expect(d.create).toHaveBeenCalledTimes(1); expect(d.send).toHaveBeenCalledTimes(1);
  expect(d.create).toHaveBeenCalledWith(expect.objectContaining({ to: ['admin@wmkeck.org'], cc: [], subject: 'D26: Staff-discussion cleanup reminder' }));
  expect(d.create.mock.calls[0][0].body).toContain('The D26 Board meeting ended on 2026-12-01; the one-week grace period ended on 2026-12-08.');
  expect(d.create.mock.calls[0][0].body).toContain('Mark cleanup complete');
  expect(d.create.mock.calls[0][0].body).toContain('does not delete');
  expect(d.getRequest).not.toHaveBeenCalled(); expect(d.getRole).not.toHaveBeenCalled();
  setNow('2026-12-11T17:00:00Z');
  await deliverNotice('D26', intent, d); // stale day must not dispatch
  await deliverNotice('D26', { key: 'cleanup:2026-12-11', kind: 'cleanup' }, d);
  expect(d.send).toHaveBeenCalledTimes(2);
  expect(Object.keys(state.emails)).toEqual(['cleanup:2026-12-08', 'cleanup:2026-12-11']);
});
test('admin completion is idempotent, retains actor/time, and removes future notices', async () => {
  const { state, d, setNow } = fixture();
  const result = await completeCleanup('D26', actor, d);
  expect(result).toMatchObject({ completedAt: '2026-12-08T17:00:00Z', completedBy: 'Admin', due: false });
  expect(state.cleanupCompletedBy.systemUserId).toBe(ID);
  expect(state.events).toHaveLength(1);
  setNow('2026-12-09T17:00:00Z');
  expect(await completeCleanup('D26', actor, d)).toEqual(result);
  expect(state.events).toHaveLength(1);
  await deliverNotice('D26', { key: 'cleanup:2026-12-09', kind: 'cleanup' }, d);
  expect(d.create).not.toHaveBeenCalled();
  expect(state.releases).toEqual({}); expect(state.archives).toEqual({});
});
test('completion rejects non-admin, early requests, and unresolved setup before changing state', async () => {
  const { state, d, setNow } = fixture();
  await expect(completeCleanup('D26', actor, { ...d, boardActor: async () => ({ canArchive: true, isSuperuser: false }) })).rejects.toMatchObject({ code: 'board_cleanup_forbidden' });
  expect(d.mutateCycle).not.toHaveBeenCalled();
  setNow('2026-12-07T17:00:00Z');
  await expect(completeCleanup('D26', actor, d)).rejects.toMatchObject({ code: 'board_cleanup_not_due' });
  setNow('2026-12-08T17:00:00Z'); state.configIntent = { id: 'pending' };
  await expect(completeCleanup('D26', actor, d)).rejects.toMatchObject({ code: 'board_cycle_locked' });
  expect(state.cleanupCompletedAt).toBeUndefined(); expect(state.events).toEqual([]);
});
test('completion while email is being prepared prevents sending', async () => {
  const { state, d } = fixture();
  d.get.mockImplementation(async () => { await completeCleanup('D26', actor, d); return { activityid: 'email-id', statuscode: 1 }; });
  await deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, d);
  expect(d.create).toHaveBeenCalledTimes(1); expect(d.send).not.toHaveBeenCalled();
  expect(state.emails['cleanup:2026-12-08'].error).toBe('board_notice_no_longer_due');
});
test('configuration change or revoked recipient prevents send', async () => {
  const { d } = fixture();
  d.getCycle.mockResolvedValueOnce({ value: config, revision: 'etag' }).mockResolvedValue({ value: { ...config, adminId: null }, revision: 'new' });
  await deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, d);
  expect(d.send).not.toHaveBeenCalled();
  const moved = fixture(); moved.d.cycleDates.mockResolvedValueOnce(DATES).mockResolvedValue({ ...DATES, boardEnds: '2026-12-15' });
  await deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, moved.d);
  expect(moved.d.create).toHaveBeenCalledTimes(1); expect(moved.d.send).not.toHaveBeenCalled();
  expect(moved.state.emails['cleanup:2026-12-08'].error).toBe('board_notice_configuration_changed');
  // A retry reads the moved date twice; it must still compare against the date the draft was written from.
  await deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, moved.d);
  expect(moved.d.send).not.toHaveBeenCalled();
  expect(moved.state.emails['cleanup:2026-12-08']).toMatchObject({ dates: DATES, error: 'board_notice_configuration_changed' });
  const next = fixture(); next.d.eligibleStaff.mockRejectedValue(new Error('disabled admin'));
  await expect(deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, next.d)).rejects.toThrow('disabled admin');
  expect(next.d.create).not.toHaveBeenCalled();
});
test('uncertain send is not retried, even after completion; accepted outcome reconciles', async () => {
  const { state, d } = fixture();
  d.send.mockRejectedValue(new Error('timeout'));
  const intent = { key: 'cleanup:2026-12-08', kind: 'cleanup' };
  await deliverNotice('D26', intent, d); await deliverNotice('D26', intent, d);
  expect(d.send).toHaveBeenCalledTimes(1);
  await completeCleanup('D26', actor, d);
  d.get.mockResolvedValue({ activityid: 'email-id', statuscode: 3 });
  await reconcileNotices('D26', d);
  expect(state.emails[intent.key].acceptedAt).toBe(d.now());
  expect(d.send).toHaveBeenCalledTimes(1);
});
test('dashboard exposes completion status and grants action to administrators only', async () => {
  const { d } = fixture();
  expect((await dashboard('D26', actor, d)).cleanup).toMatchObject({ dueDate: '2026-12-08', canComplete: true });
  const view = await dashboard('D26', actor, { ...d, boardActor: async () => ({ canArchive: true, isSuperuser: false }) });
  expect(view.cleanup.canComplete).toBe(false);
});

test('enabled worker schedules cleanup independently of finished archival and respects completion', async () => {
  const saved = { ...process.env };
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  const { state, d } = fixture();
  state.firstEventAt = state.handoffBackfilledAt = '2026-10-01T16:00:00Z';
  state.archiveStartedAt = state.archiveCompletedAt = '2026-12-02T17:00:00Z';
  state.releases[ID] = { releasedAt: state.firstEventAt, state: 'released' };
  const deliverNotice = jest.fn(), reconcile = jest.fn();
  const deps = { ...d, now: () => Date.parse(d.now()), listCycles: async () => ['D26'], deliverNotice, reconcile, reconcileNotices: jest.fn() };
  try {
    expect((await runBoardWorkflow(deps)).enabled).toBe(true);
    expect(deliverNotice).toHaveBeenCalledWith('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' });
    expect(reconcile).not.toHaveBeenCalled();
    await completeCleanup('D26', actor, d);
    deliverNotice.mockClear(); await runBoardWorkflow(deps);
    expect(deliverNotice.mock.calls.some(([, intent]) => intent.kind === 'cleanup')).toBe(false);
  } finally { process.env = saved; }
});

test('worker withholds archive start and every notice when the calendar cannot be read', async () => {
  const saved = { ...process.env };
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  const { state, d } = fixture();
  state.firstEventAt = state.handoffBackfilledAt = '2026-10-01T16:00:00Z';
  state.releases[ID] = { releasedAt: state.firstEventAt, state: 'released' };
  const deliverNotice = jest.fn(), reconcile = jest.fn(), reconcileNotices = jest.fn();
  const cycleDates = jest.fn(async () => { throw Object.assign(new Error('down'), { code: 'board_calendar_unavailable' }); });
  const deps = { ...d, cycleDates, now: () => Date.parse('2026-12-02T17:00:00Z'), listCycles: async () => ['D26'], deliverNotice, reconcile, reconcileNotices };
  try {
    const run = await runBoardWorkflow(deps);
    expect(run.results).toContainEqual({ cycle: 'D26', status: 'calendar_unavailable', code: 'board_calendar_unavailable' });
    expect(reconcile).not.toHaveBeenCalled(); expect(deliverNotice).not.toHaveBeenCalled();
    expect(reconcileNotices).toHaveBeenCalledWith('D26');
    cycleDates.mockResolvedValue(DATES);
    await runBoardWorkflow(deps);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(deliverNotice).toHaveBeenCalledWith('D26', { key: 'confirm:2026-12-02', kind: 'confirm' });
  } finally { process.env = saved; }
});
test('dashboard reports an unreadable calendar rather than a missing date', async () => {
  const { d } = fixture();
  d.cycleDates.mockRejectedValue(Object.assign(new Error('down'), { code: 'board_calendar_unavailable' }));
  const view = await dashboard('D26', actor, d);
  expect(view.dates).toEqual({ boardEnds: null, materialsDue: null, unavailable: true });
  expect(view.cleanup).toMatchObject({ dueDate: null, due: false });
  await expect(completeCleanup('D26', actor, d)).rejects.toMatchObject({ code: 'board_calendar_unavailable' });
});

test('an unsent draft written before calendar dates is never sent', async () => {
  const { state, d } = fixture();
  state.emails['cleanup:2026-12-08'] = { subject: 'old', body: 'typed date', to: ['admin@wmkeck.org'], cc: [], from: 'system@wmkeck.org', kind: 'cleanup', createStartedAt: '2026-12-08T16:00:00Z', sendStartedAt: null, activityId: 'email-id', acceptedAt: null };
  await deliverNotice('D26', { key: 'cleanup:2026-12-08', kind: 'cleanup' }, d);
  expect(d.send).not.toHaveBeenCalled();
  expect(state.emails['cleanup:2026-12-08'].error).toBe('board_notice_configuration_changed');
});
