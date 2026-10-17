/** @jest-environment node */
import { PROGRAM_ID, validateCycle, filename, pacificTime, progress } from '../../lib/services/board-writeups/model';
import { emptyState } from '../../lib/services/board-writeups/store';
import { noticeIntents, deliverNotice, reconcileNotices } from '../../lib/services/board-writeups/notifications';
import { queueRelease, deliverRelease, dashboard } from '../../lib/services/board-writeups/service';
import { startArchive } from '../../lib/services/board-writeups/archive';
import { boardMode, boardWorkEnabled } from '../../lib/services/board-writeups/mode';
import { recover } from '../../lib/services/board-writeups/recovery';
const ID = '11111111-1111-4111-8111-111111111111';
const actor = { profileId: 'profile', systemUserId: ID };
const value = { version: 1, cycle: 'D26', programId: PROGRAM_ID, active: true, rosterConfirmed: true, requestIds: [ID], materialsDue: '2026-11-01', boardEnds: '2026-12-01', adminId: ID };
const source = { number: '1002988', institution: 'Institute', filename: '1002988 - Institute - Writeup.docx', documentId: ID, driveId: 'source-drive', itemId: 'source', eTag: 'one', versionId: '1', earlyDraft: true, webUrl: 'https://example.com/private-draft' };
function fixture() {
  const state = emptyState(); let revision = 0;
  const d = { getCycle: async () => ({ value, revision: 'etag' }), boardActor: async () => ({ canRelease: true, canArchive: true, systemUserId: ID, isSuperuser: true }),
    readCycle: async () => ({ state: structuredClone(state), revision }), mutateCycle: async (_cycle, fn) => { const next = structuredClone(state); const result = fn(next, revision); Object.assign(state, next); revision++; return result; },
    assertWrite: jest.fn(), schemaReady: () => true, sourceFor: async () => ({ source }), now: () => '2026-10-16T16:00:00Z', approvedBytes: async () => ({ buffer: Buffer.from('doc'), hash: 'hash', byteHash: 'sha' }),
    session: jest.fn(async () => ({ uploadUrl: 'upload', folder: { driveId: 'board-drive', folderId: 'folder' } })), put: jest.fn(async () => ({ item: { id: 'board-item' } })),
    metadata: async () => ({ id: 'board-item', parentReference: { id: 'folder' }, size: 3, eTag: 'board-etag', versionId: '1' }), download: async () => ({ buffer: Buffer.from('doc') }), hash: async () => 'hash' };
  return { state, d };
}
const selection = { requestId: ID, documentId: ID, eTag: 'one', versionId: '1', draftConfirmed: true };
test('activation requires dates and confirmed roster; duplicate identities rejected', () => {
  expect(() => validateCycle({ ...value, boardEnds: null })).toThrow();
  expect(() => validateCycle({ ...value, requestIds: [ID, ID] })).toThrow();
  expect(validateCycle(value)).toEqual(value);
  expect(() => validateCycle({ ...value, extra: true })).toThrow();
});
test('filenames preserve request and Writeup while removing unsafe path characters', () => expect(filename('123', 'Test / Institute:*')).toBe('123 - Test Institute - Writeup.docx'));
test('daily scheduling uses Pacific time across DST and stops at completion', () => {
  expect(pacificTime('2026-10-16T16:00:00Z').hour).toBe(9);
  expect(pacificTime('2026-12-16T17:00:00Z').hour).toBe(9);
  const state = emptyState(); state.firstEventAt = '2026-10-15T18:00:00Z';
  expect(noticeIntents(value, state, '2026-10-16T16:00:00Z')).toContainEqual({ kind: 'release', key: 'release:2026-10-16' });
  expect(noticeIntents(value, state, Date.parse('2026-10-16T16:00:00Z'))).toContainEqual({ kind: 'release', key: 'release:2026-10-16' });
  state.releases[ID] = { releasedAt: '2026-10-15T20:00:00Z' };
  expect(progress(value, state).complete).toBe(true);
  expect(noticeIntents(value, state, '2026-10-16T16:00:00Z')).toEqual([]);
  expect(noticeIntents(value, state, '2026-12-02T17:00:00Z').map(x => x.kind)).toEqual(['confirm']);
  state.archiveStartedAt = '2026-12-02T16:00:00Z';
  expect(noticeIntents(value, state, '2026-12-02T17:00:00Z')).toEqual([]);
});
test('non-CSO cannot release and draft warning is enforced by service', async () => {
  const { d } = fixture();
  await expect(queueRelease('D26', actor, [selection], { ...d, boardActor: async () => ({ canArchive: true }) })).rejects.toThrow();
  expect((await queueRelease('D26', actor, [{ ...selection, draftConfirmed: false }], d)).results[0].code).toBe('board_draft_confirmation_required');
});
test('one successful release is a no-op on replay; archive fence blocks queue', async () => {
  const { state, d } = fixture();
  await queueRelease('D26', actor, [selection], d);
  await deliverRelease('D26', ID, d);
  expect(state.releases[ID].state).toBe('released');
  await deliverRelease('D26', ID, d);
  expect(d.put).toHaveBeenCalledTimes(1);
  state.archiveStartedAt = d.now();
  expect((await queueRelease('D26', actor, [selection], d)).results[0].code).toBe('board_cycle_locked');
});
test('unknown upload outcome is held and cannot upload again, including recovery retry', async () => {
  const { state, d } = fixture(); d.put.mockRejectedValue(new Error('lost response'));
  await queueRelease('D26', actor, [selection], d);
  await deliverRelease('D26', ID, d);
  expect(state.releases[ID].state).toBe('held');
  await deliverRelease('D26', ID, d);
  expect(d.put).toHaveBeenCalledTimes(1);
  await expect(recover('D26', actor, { operation: 'release', action: 'retry', requestId: ID, reason: 'Investigated copy failure' }, d)).rejects.toThrow();
});
test('administrator payload strips actual early draft URL from receipt and audit', async () => {
  const { state, d } = fixture(); await queueRelease('D26', actor, [selection], d);
  const result = await dashboard('D26', actor, { ...d, boardActor: async () => ({ canArchive: true, canRelease: false }) });
  expect(JSON.stringify(result)).not.toContain(source.webUrl);
  expect(state.releases[ID].source.webUrl).toBe(source.webUrl);
});
test('archive all-excluded manifest completes and no uploads are needed', async () => {
  const { state, d } = fixture();
  state.releases[ID] = { requestId: ID, source, releasedAt: d.now(), destination: { itemId: 'missing', driveId: 'board-drive' } };
  state.archives[ID] = { excluded: { reason: 'Withdrawn before Board meeting' } };
  await startArchive('D26', actor, 0, { ...d, children: async () => ({ folder: null, items: [] }) });
  expect(state.archiveCompletedAt).toBe(d.now());
  expect(d.put).not.toHaveBeenCalled();
});
test('archive rejects a concurrent journal change after reconciliation', async () => {
  const { state, d } = fixture();
  state.releases[ID] = { requestId: ID, source, releasedAt: d.now(), destination: { itemId: 'missing' } };
  state.archives[ID] = { excluded: { reason: 'Withdrawn before Board meeting' } };
  await expect(startArchive('D26', actor, 0, { ...d, children: async () => { await d.mutateCycle('D26', x => { x.events.push({ action: 'concurrent' }); }); return { folder: null, items: [] }; } })).rejects.toThrow();
  expect(state.archiveStartedAt).toBeNull();
});

test('malformed later batch row cannot hide an earlier committed approval', async () => {
  const { state, d } = fixture();
  await expect(queueRelease('D26', actor, [selection, { requestId: 'bad' }], d)).rejects.toThrow();
  expect(Object.keys(state.releases)).toHaveLength(0);
});
test.each(['legacy', 'board-release', 'paused', 'invalid'])('one mail owner for mode %s, including Board kill switch', mode => {
  for (const flag of ['on', 'off']) {
    const env = { RESEARCH_LEADERSHIP_DIGEST_MODE: mode, BOARD_WRITEUPS_ENABLED: flag };
    expect((boardMode(env) === 'legacy' ? 1 : 0) + (boardWorkEnabled(env) ? 1 : 0)).toBeLessThanOrEqual(1);
    if (mode === 'board-release' && flag === 'off') expect(boardMode(env)).not.toBe('legacy');
  }
});
test('failed release before upload can be explicitly cancelled, opening audited roster repair', async () => {
  const { state, d } = fixture();
  state.releases[ID] = { state: 'failed', source, uploadStartedAt: null };
  await recover('D26', actor, { operation: 'release', action: 'cancel', requestId: ID, reason: 'Proposal moved to a different cycle' }, d);
  expect(state.releases[ID].state).toBe('cancelled');
  state.releases[ID].state = 'held'; state.releases[ID].uploadStartedAt = d.now();
  await expect(recover('D26', actor, { operation: 'release', action: 'cancel', requestId: ID, reason: 'Cannot cancel unknown file copy' }, d)).rejects.toThrow();
});

test('uncertain email send never blindly resends and later acceptance reconciles', async () => {
  const { state, d } = fixture(); state.firstEventAt = '2026-10-15T18:00:00Z';
  const previousOrigin = process.env.NEXTAUTH_URL, previousFrom = process.env.NOTIFICATION_EMAIL_FROM;
  process.env.NEXTAUTH_URL = 'https://tools.wmkeck.org'; process.env.NOTIFICATION_EMAIL_FROM = 'test@wmkeck.org';
  let status = 1;
  const send = jest.fn(async () => { throw new Error('response lost'); });
  const deps = { ...d, getRole: async () => ({ value: { systemUserId: ID } }), eligibleStaff: async () => ({ email: 'test@wmkeck.org' }),
    getRequest: async () => ({ akoya_requestid: ID, akoya_requestnum: '123', _akoya_applicantid_value_formatted: 'Institute', _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_istestrequest: false, wmkf_testcreationrunid: null }),
    create: jest.fn(async () => 'email-id'), get: async () => ({ activityid: 'email-id', statuscode: status }), find: async () => [], send, alert: jest.fn() };
  const intent = { key: 'release:2026-10-16', kind: 'release' };
  try {
    await deliverNotice('D26', intent, deps); await deliverNotice('D26', intent, deps);
    expect(send).toHaveBeenCalledTimes(1); expect(deps.create).toHaveBeenCalledTimes(1);
    expect(state.emails[intent.key].acceptedAt).toBeNull();
    status = 3;
    await reconcileNotices('D26', deps);
    expect(state.emails[intent.key].acceptedAt).toBe(d.now());
    await deliverNotice('D26', intent, deps); expect(send).toHaveBeenCalledTimes(1);
  } finally {
    if (previousOrigin === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = previousOrigin;
    if (previousFrom === undefined) delete process.env.NOTIFICATION_EMAIL_FROM; else process.env.NOTIFICATION_EMAIL_FROM = previousFrom;
  }
});
