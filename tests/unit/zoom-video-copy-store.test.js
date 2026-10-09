/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));

import { createZoomVideoCopyStore, hashZoomHostEmail, zoomCopyResumeFingerprint } from '../../lib/services/meeting-tracker-recordings/video-copy-store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const TOKEN = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';
const flat = text => text.replace(/\s+/g, ' ');

function harness(rowsFor = () => [{ id: ID }]) {
  const calls = [];
  const run = (text, params = []) => { calls.push({ text: flat(text), params }); return Promise.resolve({ rows: rowsFor(flat(text), params, calls.length) }); };
  const database = { query: run, transaction: async fn => fn({ query: run }) };
  const store = createZoomVideoCopyStore(database, { mp4GenerationIdentity: ({ operationId }) => ({ physicalFilename: `f-${operationId}.mp4`, generationKey: 'g'.repeat(64) }) });
  return { store, calls };
}

const LEASED = 'lease_token = $2 AND lease_expires_at > NOW()';
const START = {
  copyId: ID, requestId: REQ, requestNum: '1001', siteVisitActivityId: SITE, actorProfileId: 7, actorSystemId: SITE,
  zoomMeetingUuid: 'm==', zoomHostId: 'h', zoomHostEmail: ' A@B.org ', zoomMeetingStart: '2026-10-01T00:00:00Z',
  zoomFileId: 'f1', zoomRecordingType: 'shared_screen', declaredSize: 99, originalDisplayFilename: 'Zoom video.mp4',
  libraryName: 'L', folderPath: 'F',
};

test('host email hash normalizes like readZoomImportConfig and the fingerprint follows the plan formula', () => {
  expect(hashZoomHostEmail('  A@B.org ')).toBe(hashZoomHostEmail('a@b.org'));
  expect(hashZoomHostEmail('a@b.org')).toMatch(/^[0-9a-f]{64}$/);
  expect(zoomCopyResumeFingerprint({ meetingUuid: 'm', fileId: 'f', size: 5 })).toMatch(/^[0-9a-f]{64}$/);
});

test('N1 runs lock, failed recheck, replay lookup, active check, intent insert, copy insert in one transaction, in that order', async () => {
  const { store, calls } = harness((text) => (/^SELECT (id|\*) FROM zoom_video_copies/.test(text) || /^SELECT c\.id/.test(text) ? [] : [{ id: ID }]));
  const result = await store.startZoomVideoCopy(START);
  expect(result.status).toBe('started');
  const texts = calls.map(c => c.text);
  expect(texts[0]).toContain('pg_advisory_xact_lock(hashtext($1), 0)');
  expect(calls[0].params).toEqual([`zoom_video_copy:${REQ}:100000005`]);
  expect(texts[1]).toContain("c.state = 'failed'");
  expect(texts[2]).toContain("request_id = $1 AND zoom_file_id = $2 AND state = 'copied'");
  expect(texts[3]).toContain("state IN ('queued', 'copying', 'registering')");
  expect(texts[4]).toContain('INSERT INTO presentation_material_uploads');
  expect(texts[4]).toContain("'initiated'");
  expect(texts[4]).toContain("'zoom_copy'");
  expect(texts[5]).toContain('INSERT INTO zoom_video_copies');
  expect(texts[5]).toContain("VALUES ($1, $1,");
  expect(calls[4].params[0]).toBe(ID);
  expect(calls[4].params).toContain(`f-${ID}.mp4`);
  expect(calls[4].params[4]).toBe(100000005);
  expect(calls[5].params).toContain(hashZoomHostEmail('a@b.org'));
});

test('N1 replays a copied file before the active check and inserts nothing', async () => {
  const { store, calls } = harness((text) => (text.includes("state = 'copied'") ? [{ id: ID, state: 'copied' }] : []));
  expect(await store.startZoomVideoCopy(START)).toMatchObject({ status: 'replayed', copy: { id: ID } });
  expect(calls.some(c => c.text.includes('INSERT'))).toBe(false);
  expect(calls.some(c => c.text.includes("state IN ('queued', 'copying', 'registering')"))).toBe(false);
});

test('N1 reports an active request and writes nothing', async () => {
  const { store, calls } = harness((text) => (text.includes("state IN ('queued', 'copying', 'registering')") ? [{ id: 'other' }] : []));
  expect((await store.startZoomVideoCopy(START)).status).toBe('active');
  expect(calls.some(c => c.text.includes('INSERT'))).toBe(false);
});

test('N1 refuses (reconciliation_pending) when a failed row is unseen, changed, leased or already finalized', async () => {
  const failed = (over = {}) => ({ id: 'old', updated_key: 'k1', intent_state: 'failed', intent_lease_live: false, ...over });
  for (const [rows, snapshot] of [
    [[failed()], []],
    [[failed({ updated_key: 'k2' })], [failed()]],
    [[failed({ intent_state: 'uploaded' })], [failed()]],
    [[failed({ intent_lease_live: true })], [failed()]],
    [[failed({ intent_state: 'finalized' })], [failed({ intent_state: 'finalized' })]],
  ]) {
    const { store, calls } = harness(text => (text.includes("c.state = 'failed'") ? rows : []));
    expect((await store.startZoomVideoCopy({ ...START, failedSnapshot: snapshot })).status).toBe('reconciliation_pending');
    expect(calls.some(c => c.text.includes('INSERT'))).toBe(false);
  }
  const { store } = harness(text => (text.includes("c.state = 'failed'") ? [failed()] : []));
  expect((await store.startZoomVideoCopy({ ...START, failedSnapshot: [failed()] })).status).toBe('started');
});

test('N1 maps a unique violation to in_progress and rethrows other errors', async () => {
  const unique = Object.assign(new Error('dup'), { code: '23505' });
  const make = error => createZoomVideoCopyStore({ query: jest.fn(), transaction: async () => { throw error; } }, { mp4GenerationIdentity: () => ({ physicalFilename: 'f', generationKey: 'g' }) });
  expect(await make(unique).startZoomVideoCopy(START)).toEqual({ status: 'in_progress', copy: null });
  await expect(make(Object.assign(new Error('check'), { code: '23514' })).startZoomVideoCopy(START)).rejects.toThrow('check');
  await expect(harness().store.startZoomVideoCopy({ ...START, confirmedWinnerDocumentId: ID })).rejects.toThrow(TypeError);
  await expect(harness().store.startZoomVideoCopy({ ...START, requestId: 'nope' })).rejects.toThrow(TypeError);
});

test('N2 claims one due unleased active row with SKIP LOCKED and a 600 second lease', async () => {
  const { store, calls } = harness();
  const claimed = await store.claimZoomVideoCopyWork({ accessRequestId: REQ });
  expect(claimed.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
  const { text, params } = calls[0];
  expect(text).toContain("state IN ('queued', 'copying', 'registering')");
  expect(text).toContain('(lease_token IS NULL OR lease_expires_at <= NOW())');
  expect(text).toContain('(next_attempt_at IS NULL OR next_attempt_at <= NOW())');
  expect(text).toContain('($2::uuid IS NULL OR request_id = $2::uuid)');
  expect(text).toContain('LIMIT 1 FOR UPDATE SKIP LOCKED');
  expect(params).toEqual([claimed.leaseToken, REQ, 600]);
  const none = harness(() => []);
  expect(await none.store.claimZoomVideoCopyWork()).toBeNull();
});

test('N3 and N7 are token fenced; N3 also matches the expected states', async () => {
  const { store, calls } = harness();
  await store.renewZoomVideoCopyLease({ id: ID, leaseToken: TOKEN, states: ['copying'] });
  expect(calls[0].text).toContain(`WHERE id = $1 AND ${LEASED} AND state = ANY($4::text[])`);
  expect(calls[0].text).toContain('RETURNING state, cancel_requested_at');
  await store.releaseZoomVideoCopyLease({ id: ID, leaseToken: TOKEN });
  expect(calls[1].text).toContain('SET lease_token = NULL, lease_expires_at = NULL');
  expect(calls[1].text).toContain('WHERE id = $1 AND lease_token = $2 RETURNING *');
});

test.each([
  ['markZoomVideoCopyCopying', {}, "state = 'queued'"],
  ['recordZoomVideoCopyProgress', { bytesConfirmed: 5 }, "state = 'copying'"],
  ['recordZoomVideoCopySessionCreateFailure', {}, "state = 'queued'"],
  ['recordZoomVideoCopySessionRestart', {}, "state IN ('queued', 'copying')"],
  ['recordZoomVideoCopyUncertainCheck', { capFailureCode: 'zoom_video_cancel_uncertain' }, "state IN ('queued', 'copying')"],
  ['markZoomVideoCopyRegistering', { driveId: 'd', itemId: 'i' }, "state IN ('queued', 'copying')"],
  ['deferZoomVideoCopyRegistration', {}, "state = 'registering'"],
  ['failZoomVideoCopy', { failureCode: 'zoom_recording_changed' }, "state IN ('queued', 'copying', 'registering')"],
  ['cancelZoomVideoCopy', {}, "state IN ('queued', 'copying', 'registering')"],
])('%s matches id, a live copy lease token and its source states', async (name, extra, statePredicate) => {
  const { store, calls } = harness();
  await store[name]({ id: ID, leaseToken: TOKEN, ...extra });
  expect(calls[0].text).toContain(`WHERE id = $1 AND ${LEASED} AND ${statePredicate} RETURNING`);
});

test('counter writers raise the counter and fail at the cap inside one UPDATE', async () => {
  const { store, calls } = harness();
  await store.recordZoomVideoCopySessionCreateFailure({ id: ID, leaseToken: TOKEN, retryAfterSeconds: 30 });
  await store.recordZoomVideoCopySessionRestart({ id: ID, leaseToken: TOKEN });
  await store.recordZoomVideoCopyUncertainCheck({ id: ID, leaseToken: TOKEN, retryAfterSeconds: 600, capFailureCode: 'zoom_video_session_uncertain' });
  await store.deferZoomVideoCopyRegistration({ id: ID, leaseToken: TOKEN });
  const [create, restart, uncertain, registration] = calls;
  expect(create.text).toContain("session_create_attempts = LEAST(session_create_attempts + 1, $4::int)");
  expect(create.text).toContain("WHEN session_create_attempts + 1 >= $4::int THEN 'zoom_video_session_create_failed'");
  expect(create.params).toEqual([ID, TOKEN, 30, 3]);
  expect(restart.text).toContain('session_restarts = LEAST(session_restarts + 1, $3::int)');
  expect(restart.text).toContain("THEN 'zoom_video_session_expired'");
  expect(restart.text).toContain('bytes_confirmed = 0');
  expect(restart.params).toEqual([ID, TOKEN, 3]);
  expect(uncertain.text).toContain('uncertain_checks = LEAST(uncertain_checks + 1, $5::int)');
  expect(uncertain.params).toEqual([ID, TOKEN, 600, 'zoom_video_session_uncertain', 3]);
  expect(registration.text).toContain('registration_attempts = LEAST(registration_attempts + 1, $3::int)');
  expect(registration.text).toContain("THEN 'zoom_video_registration_failed'");
  expect(registration.text).toContain('lease_token = NULL, lease_expires_at = NULL');
  expect(registration.params).toEqual([ID, TOKEN, 5, [60, 300, 900, 3600]]);
  for (const call of [create, restart, uncertain, registration]) expect(call.text).toContain("state = CASE WHEN");
});

test('writer argument guards: uncertain cap code allowlist, item pair, bytes, retry delay, sanitized failure code', async () => {
  const { store, calls } = harness();
  await expect(store.recordZoomVideoCopyUncertainCheck({ id: ID, leaseToken: TOKEN, capFailureCode: 'anything' })).rejects.toThrow(TypeError);
  await expect(store.markZoomVideoCopyRegistering({ id: ID, leaseToken: TOKEN, driveId: 'd' })).rejects.toThrow(TypeError);
  await expect(store.cancelZoomVideoCopy({ id: ID, leaseToken: TOKEN, driveId: 'd' })).rejects.toThrow(TypeError);
  await expect(store.recordZoomVideoCopyProgress({ id: ID, leaseToken: TOKEN, bytesConfirmed: -1 })).rejects.toThrow(TypeError);
  await expect(store.recordZoomVideoCopySessionCreateFailure({ id: ID, leaseToken: TOKEN, retryAfterSeconds: -5 })).rejects.toThrow(TypeError);
  await store.failZoomVideoCopy({ id: ID, leaseToken: TOKEN, failureCode: 'Bad Code!' });
  expect(calls.at(-1).params[2]).toBe('zoom_import_failed');
  expect(calls.at(-1).text).toContain("state = 'failed', failure_code = $3");
});

test('N5 takes the request advisory lock then repairs only from a finalized intent with the null/token lease fence', async () => {
  const { store, calls } = harness();
  await store.markZoomVideoCopyCopied({ id: ID });
  expect(calls[0].text).toContain("pg_advisory_xact_lock(hashtext('zoom_video_copy:' || request_id::text || ':100000005'), 0)");
  const { text, params } = calls[1];
  expect(text).toContain("u.state = 'finalized'");
  expect(text).toContain("c.state IN ('queued', 'copying', 'registering', 'failed')");
  expect(text).toContain('($2::uuid IS NOT NULL AND c.lease_token = $2::uuid AND c.lease_expires_at > NOW())');
  expect(text).toContain('($2::uuid IS NULL AND (c.lease_token IS NULL OR c.lease_expires_at <= NOW()))');
  expect(text).toContain('request_document_id = u.request_document_id');
  expect(text).toContain('sharepoint_item_id = u.candidate_item_id');
  expect(text).toContain('failure_code = NULL');
  expect(params).toEqual([ID, null]);
});

test('N5 turns a copied-file index violation into zoom_video_receipt_conflict', async () => {
  const violation = Object.assign(new Error('dup'), { code: '23505', constraint: 'idx_zoom_video_copies_copied_file' });
  const store = createZoomVideoCopyStore({ query: jest.fn(), transaction: async () => { throw violation; } }, { mp4GenerationIdentity: jest.fn() });
  await expect(store.markZoomVideoCopyCopied({ id: ID })).rejects.toMatchObject({ code: 'zoom_video_receipt_conflict' });
  const other = createZoomVideoCopyStore({ query: jest.fn(), transaction: async () => { throw Object.assign(new Error('x'), { code: '23505', constraint: 'other' }); } }, { mp4GenerationIdentity: jest.fn() });
  await expect(other.markZoomVideoCopyCopied({ id: ID })).rejects.toMatchObject({ code: '23505' });
});

test('N5a lists finalized-intent rows that are not copied and have no live copy lease', async () => {
  const { store, calls } = harness();
  await store.listZoomVideoCopiesWithFinalizedIntent({ limit: 3 });
  expect(calls[0].text).toContain("c.state IN ('queued', 'copying', 'registering', 'failed') AND u.state = 'finalized'");
  expect(calls[0].text).toContain('(c.lease_token IS NULL OR c.lease_expires_at <= NOW())');
  expect(calls[0].params).toEqual([3]);
});

test('N6 sets the flag only on queued/copying and classifies the rest', async () => {
  let select;
  const { store, calls } = harness(text => (text.startsWith('UPDATE') ? [] : select));
  select = [{ id: ID, state: 'registering' }];
  expect(await store.requestZoomVideoCopyCancel({ id: ID, requestId: REQ })).toMatchObject({ outcome: 'saving' });
  expect(calls[0].text).toContain("cancel_requested_at = COALESCE(cancel_requested_at, NOW())");
  expect(calls[0].text).toContain("WHERE id = $1 AND request_id = $2 AND state IN ('queued', 'copying')");
  select = [{ id: ID, state: 'copied' }];
  expect(await store.requestZoomVideoCopyCancel({ id: ID, requestId: REQ })).toMatchObject({ outcome: 'terminal' });
  select = [];
  expect(await store.requestZoomVideoCopyCancel({ id: ID, requestId: REQ })).toEqual({ outcome: 'not_found', row: null });
  const ok = harness();
  expect(await ok.store.requestZoomVideoCopyCancel({ id: ID, requestId: REQ })).toMatchObject({ outcome: 'requested' });
});

test('the failed-due selector locks failed rows, takes no copy lease, and advances next_attempt_at', async () => {
  const { store, calls } = harness();
  await store.claimFailedZoomVideoCopiesDue({ limit: 2, deferSeconds: 900 });
  const { text, params } = calls[0];
  expect(text).toContain("WHERE c.state = 'failed' AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= NOW())");
  // ruling 16: only unsettled linked intents, and the 30-day backstop on the copy's updated_at
  expect(text).toContain("u.state NOT IN ('finalized', 'abandoned')");
  expect(text).toContain("c.updated_at > NOW() - INTERVAL '30 days'");
  expect(text).toContain('FOR UPDATE OF c SKIP LOCKED');
  expect(text).toContain("SET next_attempt_at = NOW() + $2::int * INTERVAL '1 second' FROM due WHERE c.id = due.id AND c.state = 'failed'");
  expect(text).not.toContain('lease_token');
  expect(params).toEqual([2, 900, null]);
});

test('snapshot reads join the intent, expose no lease token or upload URL, and are keyed by id or request', async () => {
  const { store, calls } = harness();
  await store.getZoomVideoCopySnapshot({ id: ID });
  await store.listZoomVideoCopySnapshotsForRequest({ requestId: REQ, limit: 99 });
  for (const call of calls) {
    expect(call.text).toContain('FROM zoom_video_copies c JOIN presentation_material_uploads u ON u.id = c.upload_id');
    expect(call.text).not.toMatch(/\b[cu]\.lease_token(,| AS)|u\.upload_url_ciphertext(,| AS)/);
    expect(call.text).toContain('(u.upload_url_ciphertext IS NOT NULL) AS intent_has_ciphertext');
  }
  expect(calls[0].text).toContain('WHERE c.id = $1');
  expect(calls[1].text).toContain('WHERE c.request_id = $1 ORDER BY c.created_at DESC LIMIT $2');
  expect(calls[1].params).toEqual([REQ, 20]);
});

test('findCopiedZoomVideoCopyForFile reads only the copied row for the request and file', async () => {
  const { store, calls } = harness(() => [{ id: ID, zoom_meeting_uuid: 'm==', state: 'copied' }]);
  expect(await store.findCopiedZoomVideoCopyForFile({ requestId: REQ, zoomFileId: 'f1' })).toEqual({ id: ID, zoom_meeting_uuid: 'm==', state: 'copied' });
  expect(calls[0].text).toContain("WHERE request_id = $1 AND zoom_file_id = $2 AND state = 'copied'");
  expect(calls[0].params).toEqual([REQ, 'f1']);
  await expect(store.findCopiedZoomVideoCopyForFile({ requestId: 'nope', zoomFileId: 'f1' })).rejects.toThrow(TypeError);
});
