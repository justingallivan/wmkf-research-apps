/** @jest-environment node */
import { queueRelease, deliverRelease } from '../../lib/services/board-writeups/service';
import { noticeIntents, deliverNotice, reconcileNotices } from '../../lib/services/board-writeups/notifications';
import { deliverHourlyReleases } from '../../lib/services/board-writeups/hourly-releases';
import { recover } from '../../lib/services/board-writeups/recovery';
import { emptyState } from '../../lib/services/board-writeups/store';
import { runBoardWorkflow } from '../../lib/services/board-writeups/worker';
import AlertService from '../../lib/services/alert-service';
import { eligibleStaff } from '../../lib/services/board-writeups/config';
import { PROGRAM_ID } from '../../lib/services/board-writeups/model';
import { RESEARCH_BOARD_MATERIALS_TARGET as TARGET } from '../../lib/services/sharepoint-target-registry';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const CSO = '33333333-3333-4333-8333-333333333333', PRESIDENT = '44444444-4444-4444-8444-444444444444';
const actor = { profileId: 'cso-profile', systemUserId: CSO };
function draft(d) {
  const input = d.create.mock.calls.at(-1)?.[0] || {};
  return { activityid: 'email-id', statuscode: 1, subject: input.subject, description: input.body,
    email_activity_parties: [{ participationtypemask: 1, addressused: input.from, _partyid_value: CSO }, ...(input.to || []).map(addressused => ({ participationtypemask: 2, addressused })), ...(input.cc || []).map(addressused => ({ participationtypemask: 3, addressused })), { participationtypemask: 9, _partyid_value: CSO, addressused: null }] };
}
const selection = id => ({ requestId: id, documentId: id, eTag: 'one', versionId: '1', draftConfirmed: true });
function fixture() {
  const state = emptyState();
  const config = { version: 1, cycle: 'D26', programId: PROGRAM_ID, active: true, rosterConfirmed: true, requestIds: [A, B], adminId: CSO };
  const folder = { ...TARGET, folderId: 'cycle-folder', webUrl: `${TARGET.webUrl}/D26` };
  const d = {
    getCycle: jest.fn(async () => ({ value: config, revision: 'etag' })),
    cycleDates: jest.fn(async () => ({ materialsDue: '2026-11-01', boardEnds: '2026-12-10' })),
    readCycle: async () => ({ state: structuredClone(state), revision: 0 }),
    mutateCycle: async (_cycle, fn) => { const next = structuredClone(state); const result = fn(next); Object.assign(state, next); return result; },
    now: () => '2026-10-18T22:00:00Z', assertWrite: jest.fn(), assertBudget: jest.fn(),
    boardActor: async () => ({ canRelease: true, canArchive: true, systemUserId: CSO, name: 'Example CSO' }),
    sourceFor: jest.fn(async (_cycle, id) => ({ source: { documentId: id, eTag: 'one', versionId: '1', number: id === A ? '1001' : '1002', institution: 'Institute', filename: `${id} - Writeup.docx` } })),
    getRole: jest.fn(async role => ({ value: { systemUserId: role === 'president' ? PRESIDENT : CSO } })),
    eligibleStaff: jest.fn(async id => { if (![CSO, PRESIDENT].includes(id)) throw new Error('ineligible'); return { systemUserId: id, profileId: id === CSO ? actor.profileId : 'president-profile', email: id === CSO ? 'cso@wmkeck.org' : 'president@wmkeck.org', name: 'Example CSO' }; }),
    getRequest: jest.fn(async id => ({ akoya_requestid: id, akoya_requestnum: id === A ? '1001' : '1002', _akoya_applicantid_value_formatted: 'Institute <&>', _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null })),
    boardFolder: jest.fn(async () => folder),
    approvedBytes: async () => ({ buffer: Buffer.from('doc'), hash: 'hash' }),
    session: async () => ({ uploadUrl: 'upload', folder }), put: jest.fn(async () => ({ item: { id: 'copied' } })),
    metadata: jest.fn(async () => ({ id: 'copied', parentReference: { id: folder.folderId }, size: 3, eTag: 'copied-etag', versionId: '1' })),
    download: async () => ({ buffer: Buffer.from('doc') }), hash: async () => 'hash',
    create: jest.fn(async () => 'email-id'), get: jest.fn(async () => draft(d)),
    find: jest.fn(async () => []), send: jest.fn(), alert: jest.fn()
  };
  return { state, config, folder, d };
}
const notices = (config, state) => noticeIntents(config, state, '2026-10-18T22:00:00Z', { materialsDue: '2026-11-01', boardEnds: '2026-12-10' }).filter(x => x.kind === 'president');
async function run(f) { return deliverHourlyReleases('D26', { ...f.d, deliverRelease: (cycle, id, budget) => deliverRelease(cycle, id, { ...f.d, ...budget }) }); }
async function release(f, ids = [A, B]) { await queueRelease('D26', actor, ids.map(selection), f.d); await run(f); return notices(f.config, f.state)[0]; }
const env = { ...process.env };
beforeEach(() => { process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true'; });
afterEach(() => { process.env = { ...env }; });

test('hourly notification follows the copy phase and sends once from CSO with proposal list and cycle folder', async () => {
  const f = fixture();
  await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  expect(Object.values(f.state.releaseBatches)[0].requestIds).toEqual([A, B]);
  await deliverRelease('D26', A, f.d);
  expect(notices(f.config, f.state)).toEqual([]);
  await deliverRelease('D26', B, f.d);
  await run(f);
  const intent = notices(f.config, f.state)[0];
  await Promise.all([deliverNotice('D26', intent, f.d), deliverNotice('D26', intent, f.d)]);
  await deliverNotice('D26', intent, f.d);
  expect(f.d.create).toHaveBeenCalledTimes(1); expect(f.d.send).toHaveBeenCalledTimes(1);
  expect(f.d.create).toHaveBeenCalledWith(expect.objectContaining({ from: 'cso@wmkeck.org', to: ['president@wmkeck.org'], cc: ['cso@wmkeck.org'], actingUserSystemId: CSO, noFallback: true }));
  expect(f.d.send).toHaveBeenCalledWith('email-id', { actingUserSystemId: CSO, noFallback: true });
  const { body } = f.d.create.mock.calls[0][0];
  expect(body).toContain('1001'); expect(body).toContain('1002'); expect(body).toContain('Institute &lt;&amp;&gt;'); expect(body).toContain(f.folder.webUrl);
  await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  expect(Object.keys(f.state.releaseBatches)).toHaveLength(1);
});
test('source failures are excluded, overlapping clicks cannot duplicate membership, and legacy releases never backfill', async () => {
  const f = fixture();
  f.d.sourceFor.mockImplementation(async (_cycle, id) => id === B ? { source: null } : { source: { documentId: id, eTag: 'one', versionId: '1' } });
  const response = await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  expect(response.results.map(x => x.status)).toEqual(['queued', 'failed']);
  await queueRelease('D26', actor, [selection(A)], f.d);
  expect(Object.values(f.state.releaseBatches).map(x => x.requestIds)).toEqual([[A]]);
  delete f.state.releaseBatches; f.state.releases[A].releasedAt = f.d.now();
  expect(notices(f.config, f.state)).toEqual([]);
});
test('worker cannot observe a partially assembled batch while the next source loads', async () => {
  const f = fixture(); let finish; const pending = new Promise(resolve => { finish = resolve; });
  const source = f.d.sourceFor.getMockImplementation();
  f.d.sourceFor.mockImplementation(async (cycle, id) => { if (id === B) await pending; return source(cycle, id); });
  const queued = queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  await new Promise(resolve => setImmediate(resolve));
  expect(f.state.releases).toEqual({}); expect(f.state.releaseBatches).toBeUndefined();
  finish(); await queued;
  expect(Object.values(f.state.releaseBatches)[0].requestIds).toEqual([A, B]);
});
test('failed member waits for recovery or cancellation and email lists successful members only', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  await deliverRelease('D26', A, f.d);
  f.d.approvedBytes = async () => { throw new Error('source unavailable'); };
  await deliverRelease('D26', B, f.d);
  expect(notices(f.config, f.state)).toEqual([]);
  await recover('D26', actor, { requestId: B, operation: 'release', action: 'cancel', reason: 'Cancel failed copy after review' }, f.d);
  await run(f);
  await deliverNotice('D26', notices(f.config, f.state)[0], f.d);
  expect(f.d.create.mock.calls[0][0].body).toContain('1001'); expect(f.d.create.mock.calls[0][0].body).not.toContain('1002');
});
test('successful copies notify independently of a failed sibling; later recovery belongs to a later hourly run', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  await deliverRelease('D26', A, f.d); f.state.releases[B].state = 'failed';
  await run(f);
  const first = notices(f.config, f.state)[0];
  expect(f.state.releaseRuns[first.runId].releases.map(row => row.requestId)).toEqual([A]);
  await queueRelease('D26', actor, [selection(B)], f.d);
  f.d.now = () => '2026-10-18T23:00:00Z'; await run(f);
  expect(notices(f.config, f.state)).toHaveLength(2);
  expect(Object.values(f.state.releaseRuns)[1].releases.map(row => row.requestId)).toEqual([B]);
});
test.each(['queued', 'uploading', 'validating', 'held', 'failed', 'unknown'])('unfinished member state %s is omitted from the hourly notification', async state => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  await deliverRelease('D26', A, f.d);
  f.state.releases[B].state = state;
  await deliverHourlyReleases('D26', { ...f.d, deliverRelease: jest.fn() });
  const intent = notices(f.config, f.state)[0];
  expect(f.state.releaseRuns[intent.runId].releases.map(row => row.requestId)).toEqual([A]);
});
test('all-cancelled run and inactive cycle send no email', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  for (const row of Object.values(f.state.releases)) row.state = 'cancelled';
  await run(f); expect(notices(f.config, f.state)).toEqual([]);
  const g = fixture(); await release(g); g.config.active = false;
  expect(notices(g.config, g.state)).toEqual([]);
});
test.each(['test', 'moved', 'unsafe-folder', 'changed-cso', 'missing-president', 'disabled-impersonation'])('%s prevents email creation', async problem => {
  const f = fixture(), intent = await release(f);
  if (problem === 'test') f.d.getRequest.mockResolvedValue({ wmkf_istestrequest: true });
  if (problem === 'moved') f.d.metadata.mockResolvedValue({ parentReference: { id: 'elsewhere' } });
  if (problem === 'unsafe-folder') f.folder.webUrl = 'https://evil.example/D26';
  if (problem === 'changed-cso') f.d.getRole.mockResolvedValue({ value: { systemUserId: PRESIDENT } });
  if (problem === 'missing-president') f.d.getRole.mockImplementation(async role => ({ value: role === 'president' ? null : { systemUserId: CSO } }));
  if (problem === 'disabled-impersonation') delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  await expect(deliverNotice('D26', intent, f.d)).rejects.toThrow(); expect(f.d.create).not.toHaveBeenCalled();
});
test.each(['recipient', 'sender', 'test', 'config'])('%s changes during preparation prevent dispatch', async change => {
  const f = fixture(), intent = await release(f);
  f.d.get.mockImplementation(async () => {
    if (change === 'recipient') f.d.eligibleStaff.mockImplementation(async id => ({ profileId: actor.profileId, email: id === CSO ? 'cso@wmkeck.org' : 'replacement@wmkeck.org', name: 'Example CSO' }));
    if (change === 'sender') f.d.getRole.mockResolvedValue({ value: { systemUserId: PRESIDENT } });
    if (change === 'test') f.d.getRequest.mockResolvedValue({ wmkf_istestrequest: true });
    if (change === 'config') f.config.active = false;
    return draft(f.d);
  });
  await deliverNotice('D26', intent, f.d); expect(f.d.create).toHaveBeenCalledTimes(1); expect(f.d.send).not.toHaveBeenCalled();
});
test('uncertain send never resends and accepted outcome reconciles', async () => {
  const f = fixture(), intent = await release(f); f.d.send.mockRejectedValue(new Error('timeout'));
  await deliverNotice('D26', intent, f.d); await deliverNotice('D26', intent, f.d);
  expect(f.d.send).toHaveBeenCalledTimes(1); expect(f.d.create).toHaveBeenCalledTimes(1);
  f.d.get.mockResolvedValue({ ...draft(f.d), statuscode: 3 }); await reconcileNotices('D26', f.d);
  expect(f.state.emails[intent.key].acceptedAt).toBe(f.d.now());
});
test('uncertain create never creates a second activity', async () => {
  const f = fixture(), intent = await release(f); f.d.create.mockRejectedValue(new Error('timeout'));
  await deliverNotice('D26', intent, f.d); await deliverNotice('D26', intent, f.d);
  expect(f.d.create).toHaveBeenCalledTimes(1); expect(f.d.send).not.toHaveBeenCalled();
});
test('normal worker dispatches completed hourly runs outside the daily reminder hour', async () => {
  const f = fixture(); await release(f);
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com'; delete process.env.DYNAMICS_SANDBOX_URL;
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  f.state.handoffBackfilledAt = f.d.now(); const dispatch = jest.fn();
  await runBoardWorkflow({ ...f.d, now: () => Date.parse(f.d.now()), listCycles: async () => ['D26'], deliverNotice: dispatch, reconcileNotices: jest.fn() });
  expect(dispatch).toHaveBeenCalledWith('D26', expect.objectContaining({ kind: 'president' }));
});


test.each(['to', 'cc', 'missing-cc', 'from', 'sender-identity', 'bcc', 'subject', 'body', 'owner-identity', 'owner-address', 'duplicate-owner', 'unknown-party'])('modified Dynamics draft %s cannot dispatch', async change => {
  const f = fixture(), intent = await release(f);
  f.d.get.mockImplementation(async () => {
    const activity = draft(f.d);
    if (change === 'subject') activity.subject = 'Unapproved subject';
    if (change === 'body') activity.description = 'Unapproved content';
    if (change === 'to') activity.email_activity_parties[1].addressused = 'other@wmkeck.org';
    if (change === 'cc') activity.email_activity_parties.find(party => party.participationtypemask === 3).addressused = 'other@wmkeck.org';
    if (change === 'missing-cc') activity.email_activity_parties = activity.email_activity_parties.filter(party => party.participationtypemask !== 3);
    if (change === 'from') activity.email_activity_parties[0].addressused = 'other@wmkeck.org';
    if (change === 'sender-identity') activity.email_activity_parties[0]._partyid_value = PRESIDENT;
    if (change === 'owner-identity') activity.email_activity_parties.find(party => party.participationtypemask === 9)._partyid_value = PRESIDENT;
    if (change === 'owner-address') activity.email_activity_parties.find(party => party.participationtypemask === 9).addressused = 'other@wmkeck.org';
    if (change === 'duplicate-owner') activity.email_activity_parties.push({ participationtypemask: 9, _partyid_value: CSO });
    if (change === 'unknown-party') activity.email_activity_parties.push({ participationtypemask: 12, addressused: 'other@wmkeck.org' });
    if (change === 'bcc') activity.email_activity_parties.push({ participationtypemask: 4, addressused: 'other@wmkeck.org' });
    return activity;
  });
  await deliverNotice('D26', intent, f.d);
  expect(f.d.send).not.toHaveBeenCalled(); expect(f.state.emails[intent.key].error).toBe('board_email_activity_changed');
});
test('one blocked legacy notification does not starve the hourly notification in the worker', async () => {
  const f = fixture();
  await queueRelease('D26', actor, [selection(A)], f.d);
  await queueRelease('D26', actor, [selection(B)], f.d);
  await deliverRelease('D26', A, f.d);
  const batchId = f.state.releases[A].batchId;
  f.state.emails[`president:${batchId}`] = { createStartedAt: f.d.now() };
  await run(f);
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com'; delete process.env.DYNAMICS_SANDBOX_URL;
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  f.state.handoffBackfilledAt = f.d.now();
  const dispatch = jest.fn().mockRejectedValueOnce(Object.assign(new Error('old CSO'), { code: 'board_batch_cso_changed' })).mockResolvedValue(undefined);
  const alert = jest.spyOn(AlertService, 'createAlert').mockResolvedValue(undefined);
  try {
    const result = await runBoardWorkflow({ ...f.d, now: () => Date.parse(f.d.now()), listCycles: async () => ['D26'], deliverNotice: dispatch, reconcileNotices: jest.fn() });
    expect(dispatch.mock.calls.map(([, intent]) => intent.key)).toEqual([`president:${batchId}`, `president-run:${Object.keys(f.state.releaseRuns)[0]}`]);
    expect(result.results).toContainEqual({ cycle: 'D26', status: 'notice_failed', code: 'board_batch_cso_changed' });
  } finally { alert.mockRestore(); }
});

test('President without Workbench receives the batch email with live eligibility rechecked before send', async () => {
  const f = fixture(), intent = await release(f);
  const grants = jest.fn(async profileId => profileId === actor.profileId ? ['reviewers'] : []);
  f.d.eligibleStaff = jest.fn((id, options) => eligibleStaff(id, options, {
    getUser: async userId => ({ isdisabled: false, internalemailaddress: userId === CSO ? 'cso@wmkeck.org' : 'president@wmkeck.org', fullname: 'Staff' }),
    resolveSystemUserToProfile: async userId => userId === CSO ? actor.profileId : 'president-profile',
    profile: async () => ({ is_active: true, superuser: false }), listAppKeysForUser: grants,
  }));
  await deliverNotice('D26', intent, f.d);
  expect(f.d.send).toHaveBeenCalledTimes(1);
  expect(f.d.eligibleStaff.mock.calls.filter(([id]) => id === PRESIDENT)).toEqual([[PRESIDENT, { app: false }], [PRESIDENT, { app: false }]]);
  expect(grants.mock.calls.every(([id]) => id === actor.profileId)).toBe(true);
});


test.each([1, 3])('legacy no-cc activity at provider status %s is preserved without recreation or resend', async statuscode => {
  const f = fixture(), intent = await release(f);
  await deliverNotice('D26', intent, f.d);
  const row = f.state.emails[intent.key];
  row.cc = []; row.acceptedAt = null; row.sendStartedAt = null;
  const activity = { ...draft(f.d), statuscode };
  activity.email_activity_parties = activity.email_activity_parties.filter(party => party.participationtypemask !== 3);
  f.d.get.mockResolvedValue(activity); f.d.create.mockClear(); f.d.send.mockClear();
  await deliverNotice('D26', intent, f.d);
  expect(row.cc).toEqual([]);
  expect(f.state.emails[intent.key].cc).toEqual([]);
  expect(f.d.create).not.toHaveBeenCalled(); expect(f.d.send).not.toHaveBeenCalled();
  if (statuscode === 1) expect(f.state.emails[intent.key].error).toBe('board_email_parties_or_content_changed');
  else expect(f.state.emails[intent.key].acceptedAt).toBe(f.d.now());
});

test('five separate release clicks in one hourly worker run produce one email for all nine writeups, cc CSO', async () => {
  const f = fixture();
  const ids = [A, B, ...Array.from({ length: 7 }, (_, i) => `${(i + 5).toString(16)}5555555-5555-4555-8555-555555555555`)];
  f.config.requestIds = ids;
  for (const group of [ids.slice(0, 3), ids.slice(3, 4), ids.slice(4, 7), ids.slice(7, 8), ids.slice(8)]) await queueRelease('D26', actor, group.map(selection), f.d);
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com'; delete process.env.DYNAMICS_SANDBOX_URL;
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  f.state.handoffBackfilledAt = f.d.now(); f.state.firstEventAt = f.d.now();
  const deps = { ...f.d, now: () => Date.parse(f.d.now()), listCycles: async () => ['D26'],
    deliverRelease: (cycle, id, budget) => deliverRelease(cycle, id, { ...f.d, ...budget }),
    deliverNotice: (cycle, intent) => deliverNotice(cycle, intent, f.d), reconcileNotices: jest.fn() };
  await runBoardWorkflow(deps); await runBoardWorkflow(deps);
  expect(f.d.put).toHaveBeenCalledTimes(9);
  expect(f.d.create).toHaveBeenCalledTimes(1); expect(f.d.send).toHaveBeenCalledTimes(1);
  expect(f.d.create).toHaveBeenCalledWith(expect.objectContaining({ to: ['president@wmkeck.org'], cc: ['cso@wmkeck.org'], subject: 'D26: 9 Board writeups released' }));
  expect(Object.values(f.state.releaseRuns)[0].releases.map(row => row.requestId).sort()).toEqual(ids.sort());
});

test('overlapping workers cannot close or email a run while its copy phase is still in progress', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  f.d.put.mockImplementationOnce(async () => { await pending; return { item: { id: 'copied' } }; });
  const first = run(f); await new Promise(resolve => setImmediate(resolve));
  expect(await run(f)).toEqual([]); expect(notices(f.config, f.state)).toEqual([]);
  finish(); await first;
  expect(Object.keys(f.state.releaseRuns)).toHaveLength(1);
  expect(Object.values(f.state.releaseRuns)[0].releases).toHaveLength(2);
});

test('copy-phase crash resumes the same frozen run after lease expiry without copying successful members twice', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  const deliver = jest.fn(async (cycle, id) => {
    if (id === B) throw new Error('worker stopped');
    return deliverRelease(cycle, id, f.d);
  });
  await expect(deliverHourlyReleases('D26', { ...f.d, deliverRelease: deliver })).rejects.toThrow('worker stopped');
  expect(notices(f.config, f.state)).toEqual([]);
  f.d.now = () => '2026-10-18T23:00:00Z'; await run(f);
  expect(f.d.put).toHaveBeenCalledTimes(2);
  expect(Object.keys(f.state.releaseRuns)).toEqual(['2026-10-18T22']);
  expect(Object.values(f.state.releaseRuns)[0].releases).toHaveLength(2);
});

test('approval after the frozen hourly run waits for the next run, without altering the first email', async () => {
  const f = fixture(), first = await release(f, [A]);
  await deliverNotice('D26', first, f.d);
  await queueRelease('D26', actor, [selection(B)], f.d);
  await run(f); expect(f.state.releases[B].state).toBe('queued');
  f.d.now = () => '2026-10-18T23:00:00Z'; await run(f);
  const second = notices(f.config, f.state).find(x => x.key !== first.key);
  await deliverNotice('D26', second, f.d);
  expect(f.d.create).toHaveBeenCalledTimes(2);
  expect(f.d.create.mock.calls[0][0].body).toContain('1001'); expect(f.d.create.mock.calls[0][0].body).not.toContain('1002');
  expect(f.d.create.mock.calls[1][0].body).toContain('1002'); expect(f.d.create.mock.calls[1][0].body).not.toContain('1001');
});

test('previously created per-click email is never included in the new hourly email', async () => {
  const f = fixture();
  await queueRelease('D26', actor, [selection(A)], f.d); await queueRelease('D26', actor, [selection(B)], f.d);
  await deliverRelease('D26', A, f.d);
  const batchId = f.state.releases[A].batchId;
  f.state.emails[`president:${batchId}`] = { acceptedAt: f.d.now(), createStartedAt: f.d.now() };
  await run(f);
  expect(Object.values(f.state.releaseRuns)[0].releases.map(row => row.requestId)).toEqual([B]);
  const intent = notices(f.config, f.state).find(x => x.runId);
  await deliverNotice('D26', intent, f.d);
  expect(f.d.create.mock.calls[0][0].body).not.toContain('1001');
});

test('global worker copy deadline leaves deferred work queued without attempting a copy', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A), selection(B)], f.d);
  const copy = jest.fn();
  await deliverHourlyReleases('D26', { ...f.d, deliverRelease: copy }, {}, Date.parse(f.d.now()) - 1);
  expect(copy).not.toHaveBeenCalled();
  expect(Object.values(f.state.releases).map(row => row.state)).toEqual(['queued', 'queued']);
  expect(notices(f.config, f.state)).toEqual([]);
  f.d.now = () => '2026-10-18T23:00:00Z'; await run(f);
  expect(Object.values(f.state.releaseRuns)[1].releases).toHaveLength(2);
});

test('a former CSO approval remains held without trapping the current CSO notification', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A)], f.d);
  await deliverRelease('D26', A, f.d);
  f.state.releases[A].actor = { profileId: 'former-profile', systemUserId: PRESIDENT };
  await queueRelease('D26', actor, [selection(B)], f.d);
  await run(f);
  const intent = notices(f.config, f.state)[0];
  expect(f.state.releaseRuns[intent.runId].releases.map(row => row.requestId)).toEqual([B]);
  expect(f.d.alert).toHaveBeenCalledWith('D26', 'board_run_cso_changed');
  await deliverNotice('D26', intent, f.d); expect(f.d.send).toHaveBeenCalledTimes(1);
  expect(f.d.create.mock.calls[0][0].body).toContain('1002'); expect(f.d.create.mock.calls[0][0].body).not.toContain('1001');
  f.d.now = () => '2026-10-18T23:00:00Z'; await run(f);
  expect(Object.keys(f.state.releaseRuns)).toHaveLength(1);
  expect(f.state.releases[A].actor.systemUserId).toBe(PRESIDENT);
});

test('release-role failure does not starve independent archive copying or email reconciliation', async () => {
  const f = fixture(); await queueRelease('D26', actor, [selection(A)], f.d);
  f.state.archives[B] = { state: 'queued' };
  f.state.handoffBackfilledAt = f.state.firstEventAt = f.d.now();
  f.d.getRole.mockRejectedValue(Object.assign(new Error('CSO unavailable'), { code: 'board_staff_ineligible' }));
  process.env.VERCEL_ENV = 'production'; process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com'; delete process.env.DYNAMICS_SANDBOX_URL;
  process.env.BOARD_WRITEUPS_ENABLED = 'on'; process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  const archiveOne = jest.fn(), reconcileNotices = jest.fn();
  const alert = jest.spyOn(AlertService, 'createAlert').mockRejectedValue(new Error('alert unavailable'));
  try {
    const result = await runBoardWorkflow({ ...f.d, now: () => Date.parse(f.d.now()), listCycles: async () => ['D26'], archiveOne, reconcileNotices, deliverNotice: jest.fn() });
    expect(result.results).toContainEqual({ cycle: 'D26', status: 'needs_attention', code: 'board_staff_ineligible' });
    expect(archiveOne).toHaveBeenCalledWith('D26', B, expect.any(Object));
    expect(reconcileNotices).toHaveBeenCalledWith('D26');
    expect(f.state.releases[A].state).toBe('queued');
  } finally { alert.mockRestore(); }
});
