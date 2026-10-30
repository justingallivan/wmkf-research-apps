/** @jest-environment node */
import { sourceFor } from '../../lib/services/board-writeups/source';
import { boardReferences } from '../../lib/services/board-writeups/reader';
import { assertBoardWriteEnvironment } from '../../lib/services/graph/board-writeups';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE as TYPE, REQUEST_DOCUMENT_OPERATION_STATUS as OP, REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE, FINAL_WRITEUP_CONTRACT } from '../../shared/config/requestDocument';
import { PROGRAM_ID, validateCycle, filename, pacificTime, progress } from '../../lib/services/board-writeups/model';
import { emptyState } from '../../lib/services/board-writeups/store';
import { noticeIntents, deliverNotice, reconcileNotices } from '../../lib/services/board-writeups/notifications';
import { queueRelease, deliverRelease, dashboard } from '../../lib/services/board-writeups/service';
import { startArchive, archiveOne } from '../../lib/services/board-writeups/archive';
import { saveCycle, resumeConfig, saveRole, boardActor } from '../../lib/services/board-writeups/config';
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
    getRequest: async () => ({ akoya_requestid: ID, akoya_requestnum: '123', _akoya_applicantid_value_formatted: 'Institute', _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null }),
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

test('archive registry failure resumes the known copy without another upload', async () => {
  const { state, d } = fixture();
  state.archiveStartedAt = d.now(); state.archiveActor = actor;
  state.archiveManifest = [{ requestId: ID }];
  state.releases[ID] = { requestId: ID, source, hash: 'working-hash', releasedAt: d.now(), destination: { itemId: 'board-item', driveId: 'board-drive' } };
  state.archives[ID] = { state: 'queued', source: { ...source, driveId: 'board-drive', itemId: 'board-item' }, uploadStartedAt: null, lease: null };
  let registry = null, refuse = true;
  const deps = { ...d, getRequest: async () => ({ akoya_requestid: ID, akoya_requestnum: '123', _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null }),
    buckets: async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'request-folder' }], site: async () => 'site', drive: async () => 'archive-drive', ensureFolder: async () => ({ id: 'folder' }),
    findDocument: async () => ({ records: registry ? [registry] : [] }),
    createDocument: jest.fn(async payload => { if (refuse) throw new Error('registry unavailable'); registry = { wmkf_requestdocumentid: 'registry-id', _wmkf_request_value: ID, wmkf_artifacttype: payload.wmkf_artifacttype, wmkf_operationstatus: payload.wmkf_operationstatus, wmkf_sharepointitemid: payload.wmkf_sharepointitemid, wmkf_sharepointdriveid: payload.wmkf_sharepointdriveid }; }) };
  await archiveOne('D26', ID, deps);
  expect(state.archives[ID].state).toBe('held');
  expect(state.archives[ID].destination.itemId).toBe('board-item');
  expect(state.archiveCompletedAt).toBeNull();
  refuse = false;
  await recover('D26', actor, { operation: 'archive', action: 'retry', requestId: ID, reason: 'Registry is available again' }, deps);
  await archiveOne('D26', ID, deps);
  expect(deps.put).toHaveBeenCalledTimes(1);
  expect(state.archives[ID].state).toBe('archived');
  expect(state.archiveCompletedAt).toBe(d.now());
  expect(deps.createDocument.mock.calls[1][0].wmkf_sourceversionid).toBe(source.versionId);
  expect(deps.createDocument.mock.calls[1][0].wmkf_sourcecontenthash).toBe('working-hash');
});

test('definite settings refusal clears intent; uncertain conditional write remains recoverable', async () => {
  const { state, d } = fixture();
  let current = value, revision = 'etag';
  const deps = { ...d, getUser: async () => ({ isdisabled: false, internalemailaddress: 'admin@wmkeck.org', fullname: 'Admin' }), resolveSystemUserToProfile: async () => actor.profileId, profile: async () => ({ is_active: true, superuser: true }),
    getSettingStrict: async () => ({ found: true, value: JSON.stringify(current), revision }),
    setSettingIfUnchanged: jest.fn(async () => { throw Object.assign(new Error('conflict'), { status: 409 }); }) };
  await expect(saveCycle(actor, { ...value, active: false }, 'etag', '', deps)).rejects.toThrow('conflict');
  expect(state.configIntent).toBeNull();
  deps.setSettingIfUnchanged.mockImplementation(async () => { throw new Error('network timeout'); });
  await expect(saveCycle(actor, { ...value, active: false }, 'etag', '', deps)).rejects.toThrow('network timeout');
  expect(state.configIntent).not.toBeNull();
  deps.setSettingIfUnchanged.mockImplementation(async (_key, serialized, expected) => { expect(expected).toBe('etag'); current = JSON.parse(serialized); revision = 'next-etag'; });
  await resumeConfig('D26', actor, deps);
  expect(state.configIntent).toBeNull();
  expect(state.configHistory).toHaveLength(1);
});

test('unknown source lifecycle is refused without falling back to another document', async () => {
  const getDocuments = jest.fn(async () => ({ records: [{ wmkf_requestdocumentid: ID, _wmkf_request_value: ID, wmkf_artifacttype: TYPE.FINAL_WRITEUP, wmkf_cyclecode: 'D26', wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: 999, wmkf_contenttype: FINAL_WRITEUP_CONTRACT.contentType, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'file' }] }));
  await expect(sourceFor('D26', ID, { getDocuments, getRequest: async () => ({ akoya_requestid: ID, _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null, _wmkf_currentfinalwriteup_value: ID, _wmkf_currentpresitevisit_value: '22222222-2222-4222-8222-222222222222' }) })).rejects.toThrow();
  expect(getDocuments).toHaveBeenCalledTimes(1); expect(getDocuments).toHaveBeenCalledWith([ID]);
});
test('historical Board reader excludes working, foreign-request and unsafe-link rows', async () => {
  const record = { _wmkf_request_value: ID, wmkf_requestdocumentid: 'registry', wmkf_artifacttype: TYPE.BOARD_WRITEUP, wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.BOARD_READY, wmkf_sharepointweburl: 'https://appriver3651007194.sharepoint.com/sites/akoyaGO/Board.docx' };
  const find = jest.fn(async () => ({ records: [record, { ...record, wmkf_artifacttype: TYPE.FINAL_WRITEUP }, { ...record, _wmkf_request_value: 'other' }, { ...record, wmkf_sharepointweburl: 'https://untrusted.example/Board.docx' }] }));
  expect(await boardReferences(ID, { find, ready: () => true })).toHaveLength(1);
  find.mockClear(); expect(await boardReferences(ID, { find, ready: () => false })).toEqual([]); expect(find).not.toHaveBeenCalled();
});
test('Graph write boundary rejects local, preview, unknown targets and disabled modes', () => {
  const env = { VERCEL_ENV: 'production', BOARD_WRITEUPS_ENABLED: 'on', RESEARCH_LEADERSHIP_DIGEST_MODE: 'board-release', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' };
  expect(() => assertBoardWriteEnvironment(env)).not.toThrow();
  for (const patch of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: '' }, { DYNAMICS_URL: 'https://unknown.crm.dynamics.com' }, { BOARD_WRITEUPS_ENABLED: 'off' }, { RESEARCH_LEADERSHIP_DIGEST_MODE: 'legacy' }]) expect(() => assertBoardWriteEnvironment({ ...env, ...patch })).toThrow();
});

test('definite single-PUT refusal permits audited cancellation and a fresh CSO selection', async () => {
  const { state, d } = fixture(); d.put.mockRejectedValue(Object.assign(new Error('name conflict'), { status: 409, code: 'nameAlreadyExists' }));
  await queueRelease('D26', actor, [selection], d); await deliverRelease('D26', ID, d);
  expect(state.releases[ID].state).toBe('held'); expect(state.releases[ID].uploadRefusal.status).toBe(409);
  await recover('D26', actor, { operation: 'release', action: 'cancel', requestId: ID, reason: 'Confirmed Graph refused the conflicting name' }, d);
  expect(state.releases[ID].uploadStartedAt).toBeNull();
  expect(state.events.at(-1).details.priorUpload.uploadRefusal.status).toBe(409);
  expect((await queueRelease('D26', actor, [selection], d)).results[0].status).toBe('queued');
  expect(d.put).toHaveBeenCalledTimes(1);
});
test.each([404, 410, 429, 500, 503])('HTTP %s never establishes no-upload proof', async status => {
  const { state, d } = fixture(); d.put.mockRejectedValue(Object.assign(new Error('unknown outcome'), { status }));
  await queueRelease('D26', actor, [selection], d); await deliverRelease('D26', ID, d);
  expect(state.releases[ID].uploadRefusal).toBeUndefined();
  await expect(recover('D26', actor, { operation: 'release', action: 'cancel', requestId: ID, reason: 'Missing file is not proof of refusal' }, d)).rejects.toThrow();
  expect(d.put).toHaveBeenCalledTimes(1);
});
test('archive records a definite refusal and can retry the same confirmed source', async () => {
  const { state, d } = fixture();
  state.archiveStartedAt = d.now(); state.archiveActor = actor; state.archiveManifest = [{ requestId: ID }];
  state.releases[ID] = { source, releasedAt: d.now() };
  state.archives[ID] = { state: 'queued', source, uploadStartedAt: null };
  d.put.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }));
  const deps = { ...d, getRequest: async () => ({ _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null }), buckets: async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'request' }], site: async () => 'site', drive: async () => 'drive', ensureFolder: async () => ({ id: 'folder' }) };
  await archiveOne('D26', ID, deps);
  expect(state.archives[ID].uploadRefusal.status).toBe(409);
  await recover('D26', actor, { operation: 'archive', action: 'retry', requestId: ID, reason: 'The conflicting unrelated file has been resolved' }, deps);
  expect(state.archives[ID].uploadStartedAt).toBeNull(); expect(state.archives[ID].state).toBe('queued'); expect(state.archives[ID].source).toEqual(source);
});

test('an authorized archive exclusion completes a held entry only before any copy committed', async () => {
  const { state, d } = fixture();
  state.archiveStartedAt = d.now(); state.archiveManifest = [{ requestId: ID }];
  state.archives[ID] = { state: 'held', source, uploadStartedAt: null, error: 'board_archive_request_changed' };
  await recover('D26', actor, { operation: 'archive', action: 'exclude', requestId: ID, reason: 'Confirmed withdrawn after the Board meeting' }, d);
  expect(state.archives[ID].excluded.reason).toContain('withdrawn'); expect(state.archiveCompletedAt).toBe(d.now());
  const other = fixture(); other.state.archiveStartedAt = d.now(); other.state.archiveManifest = [{ requestId: ID }];
  other.state.archives[ID] = { state: 'held', source, uploadStartedAt: d.now(), destination: null };
  await expect(recover('D26', actor, { operation: 'archive', action: 'exclude', requestId: ID, reason: 'Uncertain upload cannot be ignored' }, other.d)).rejects.toThrow();
});


test('a definite archive refusal permits audited exclusion', async () => {
  const { state, d } = fixture(); state.archiveStartedAt = d.now(); state.archiveManifest = [{ requestId: ID }];
  state.archives[ID] = { state: 'held', source, uploadStartedAt: d.now(), destination: null, uploadRefusal: { status: 409, at: d.now() } };
  await recover('D26', actor, { operation: 'archive', action: 'exclude', requestId: ID, reason: 'Confirmed withdrawal after refused copy' }, d);
  expect(state.archiveCompletedAt).toBe(d.now());
  expect(state.archives[ID].excluded.reason).toContain('withdrawal');
  expect(state.events.at(-1).details.priorUpload.uploadRefusal.status).toBe(409);
});

test('completion notice sends with unavailable removed-roster details redacted', async () => {
  const { state, d } = fixture(); const removed = '22222222-2222-4222-8222-222222222222';
  state.archiveCompletedAt = d.now(); state.configHistory = [{ value: { rosterConfirmed: true, requestIds: [ID, removed] } }];
  const previousOrigin = process.env.NEXTAUTH_URL, previousFrom = process.env.NOTIFICATION_EMAIL_FROM;
  process.env.NEXTAUTH_URL = 'https://tools.wmkeck.org'; process.env.NOTIFICATION_EMAIL_FROM = 'test@wmkeck.org';
  const create = jest.fn(async () => 'email-id'), send = jest.fn();
  try {
    await deliverNotice('D26', { key: `complete:${d.now()}`, kind: 'complete' }, { ...d,
      getRequest: async id => { if (id === removed) throw new Error('not found'); return { _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, wmkf_istestrequest: false, wmkf_testcreationrunid: null }; },
      getRole: async () => ({ value: { systemUserId: ID } }), eligibleStaff: async () => ({ email: 'test@wmkeck.org' }), create, send,
      get: async () => ({ activityid: 'email-id', statuscode: 1 }), alert: jest.fn() });
    expect(send).toHaveBeenCalledTimes(1); expect(create.mock.calls[0][0].body).toContain('Proposal details unavailable');
    expect(state.emails[`complete:${d.now()}`].acceptedAt).toBe(d.now());
  } finally {
    if (previousOrigin === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = previousOrigin;
    if (previousFrom === undefined) delete process.env.NOTIFICATION_EMAIL_FROM; else process.env.NOTIFICATION_EMAIL_FROM = previousFrom;
  }
});

test.each([
  { wmkf_istestrequest: true, wmkf_testcreationrunid: ID },
  { wmkf_istestrequest: false, wmkf_testcreationrunid: ID },
  { wmkf_istestrequest: undefined, wmkf_testcreationrunid: null },
])('release notice refuses nonordinary requests before journal or email writes: %j', async markers => {
  const { state, d } = fixture();
  state.firstEventAt = '2026-10-15T16:00:00Z';
  const mutateCycle = jest.fn(), create = jest.fn(), send = jest.fn();
  await expect(deliverNotice('D26', { key: 'release:2026-10-16', kind: 'release' }, {
    ...d, mutateCycle, create, send,
    getRequest: async () => ({ akoya_requestid: ID, _wmkf_grantprogram_value: PROGRAM_ID, wmkf_meetingdate: '2026-12-01', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' }, ...markers }),
  })).rejects.toMatchObject({ code: 'board_notice_request_ineligible' });
  expect(mutateCycle).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});


test('President assignment persists with revision fencing and grants no workflow privileges', async () => {
  const settings = {};
  const deps = {
    getUser: async () => ({ isdisabled: false, internalemailaddress: 'staff@wmkeck.org', fullname: 'Staff' }),
    resolveSystemUserToProfile: async () => actor.profileId,
    profile: async () => ({ is_active: true, superuser: true }),
    getSettingStrict: async key => settings[key] || { found: false },
    setSettingIfUnchanged: jest.fn(async (key, serialized) => { settings[key] = { found: true, value: serialized, revision: 'next' }; })
  };
  expect(await saveRole(actor, 'president', { version: 1, systemUserId: ID }, null, deps)).toEqual({ value: { version: 1, systemUserId: ID }, revision: 'next' });
  expect(deps.setSettingIfUnchanged).toHaveBeenCalledWith('board_writeups.president', JSON.stringify({ version: 1, systemUserId: ID }), null, actor.profileId);
  expect(await boardActor(actor, { ...deps, profile: async () => ({ is_active: true, superuser: false }), listAppKeysForUser: async () => ['reviewers'] })).toMatchObject({ canRelease: false, canArchive: false });
});

test('active cycle save requires President and succeeds after assignment', async () => {
  const { d } = fixture();
  let president = false, current = value;
  const deps = { ...d,
    getUser: async () => ({ isdisabled: false, internalemailaddress: 'admin@wmkeck.org', fullname: 'Admin' }),
    resolveSystemUserToProfile: async () => actor.profileId, profile: async () => ({ is_active: true, superuser: true }),
    getSettingStrict: async key => key.includes('.cycle.')
      ? { found: true, value: JSON.stringify(current), revision: 'etag' }
      : key === 'board_writeups.president' && !president ? { found: false }
        : { found: true, value: JSON.stringify({ version: 1, systemUserId: ID }), revision: 'role' },
    setSettingIfUnchanged: jest.fn(async (_key, serialized) => { current = JSON.parse(serialized); })
  };
  await expect(saveCycle(actor, value, 'etag', '', deps)).rejects.toThrow('Assign the President');
  expect(deps.setSettingIfUnchanged).not.toHaveBeenCalled();
  president = true;
  await expect(saveCycle(actor, value, 'etag', '', deps)).resolves.toMatchObject({ value });
});
