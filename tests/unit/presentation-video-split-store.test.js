/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));

import { createPresentationVideoSplitStore, SNAPSHOT_COLUMNS } from '../../lib/services/meeting-tracker-recordings/presentation-video-split-store.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222AAA';
const SITE = '44444444-4444-4444-8444-444444444444';
const COPY = '55555555-5555-4555-8555-555555555555';
const REV = '66666666-6666-4666-8666-666666666666';
const DOC = '77777777-7777-4777-8777-777777777777';
const flat = text => text.replace(/\s+/g, ' ');

function harness(rowsFor = () => [{ id: ID }], { failOn = null } = {}) {
  const calls = [];
  const run = (text, params = []) => {
    calls.push({ text: flat(text), params });
    if (failOn && flat(text).startsWith(failOn)) return Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
    return Promise.resolve({ rows: rowsFor(flat(text), params, calls.length) });
  };
  const database = { query: run, transaction: async fn => fn({ query: run }) };
  return { store: createPresentationVideoSplitStore(database), calls };
}

const START = {
  id: ID, requestId: REQ, siteVisitActivityId: SITE, actorProfileId: 7, sourceCopyId: COPY, transcriptRevisionId: REV,
  presentationEndMs: 1234, sourceDocumentId: DOC, sourceDriveId: 'd', sourceItemId: 'i', sourceVersionId: '3',
  sourceEtag: 'e', sourceSize: 99, sourceQuickXorHash: 'q', lineage: { version: 1 },
};
const none = text => (/^(SELECT id|UPDATE)/.test(text) ? [] : [{ id: ID, state: 'queued' }]);

test('start runs lock, processing check, registering check, supersede, insert in one transaction, in that order', async () => {
  const { store, calls } = harness(none);
  const result = await store.startPresentationVideoSplit(START);
  expect(result).toEqual({ status: 'started', split: { id: ID, state: 'queued' }, supersededIds: [] });
  const texts = calls.map(c => c.text);
  expect(texts[0]).toContain('pg_advisory_xact_lock(hashtext($1), 0)');
  expect(calls[0].params).toEqual([`presentation_video_split:${REQ.toLowerCase()}`]);
  expect(texts[1]).toContain("state IN ('queued', 'cutting', 'uploading')");
  expect(texts[2]).toContain("state = 'registering'");
  expect(texts[3]).toContain("UPDATE presentation_video_splits SET state = 'superseded'");
  expect(texts[3]).toContain("state = 'review'");
  expect(texts[3]).toContain('completed_at = NOW()');
  expect(texts[4]).toContain('INSERT INTO presentation_video_splits');
  expect(texts[4]).toContain("'queued'");
  expect(calls[4].params).toEqual([ID, REQ, SITE, 7, COPY, REV, 1234, DOC, 'd', 'i', '3', 'e', 99, 'q', '{"version":1}']);
  expect(texts).toHaveLength(5);
});

test('start returns the superseded review row ids', async () => {
  const { store } = harness(text => (text.startsWith('SELECT id') ? [] : text.startsWith('UPDATE') ? [{ id: DOC }] : [{ id: ID, state: 'queued' }]));
  expect(await store.startPresentationVideoSplit(START)).toMatchObject({ status: 'started', supersededIds: [DOC] });
});

test('start refuses a processing split without writing', async () => {
  const { store, calls } = harness(text => (text.includes("'queued', 'cutting', 'uploading'") ? [{ id: ID }] : []));
  expect(await store.startPresentationVideoSplit(START)).toEqual({ status: 'active', split: null });
  expect(calls.some(c => /^(INSERT|UPDATE)/.test(c.text))).toBe(false);
});

test('start refuses any registering split without writing', async () => {
  const { store, calls } = harness(text => (text.includes("state = 'registering'") ? [{ id: ID }] : []));
  expect(await store.startPresentationVideoSplit(START)).toEqual({ status: 'approval_in_progress', split: null });
  expect(calls.some(c => /^(INSERT|UPDATE)/.test(c.text))).toBe(false);
});

test('a unique violation from the insert maps to active', async () => {
  const { store } = harness(none, { failOn: 'INSERT' });
  expect(await store.startPresentationVideoSplit(START)).toEqual({ status: 'active', split: null });
});

test('other database errors propagate', async () => {
  const database = { query: jest.fn(), transaction: async () => { throw new Error('boom'); } };
  await expect(createPresentationVideoSplitStore(database).startPresentationVideoSplit(START)).rejects.toThrow('boom');
});

test.each([
  ['requestId', { requestId: 'nope' }], ['sourceCopyId', { sourceCopyId: 'x' }], ['actorProfileId', { actorProfileId: 0 }],
  ['presentationEndMs', { presentationEndMs: -1 }], ['sourceSize', { sourceSize: 0 }], ['sourceEtag', { sourceEtag: '' }],
  ['lineage', { lineage: null }], ['sourceQuickXorHash', { sourceQuickXorHash: 'q'.repeat(101) }],
])('start rejects invalid %s before any query', async (_label, over) => {
  const { store, calls } = harness(none);
  await expect(store.startPresentationVideoSplit({ ...START, ...over })).rejects.toThrow(TypeError);
  expect(calls).toHaveLength(0);
});

test('copied-copy lookup is scoped by request, document and copied state', async () => {
  const { store, calls } = harness(() => [{ id: COPY }]);
  expect(await store.findCopiedZoomVideoCopyForDocument({ requestId: REQ, requestDocumentId: DOC })).toEqual({ id: COPY });
  expect(calls[0].text).toContain("FROM zoom_video_copies WHERE request_id = $1 AND request_document_id = $2 AND state = 'copied'");
  expect(calls[0].text).toContain('recording_start, recording_end');
  expect(calls[0].params).toEqual([REQ, DOC]);
  await expect(store.findCopiedZoomVideoCopyForDocument({ requestId: REQ, requestDocumentId: 'x' })).rejects.toThrow(TypeError);
});

test('snapshot list clamps the limit and never selects secrets, lineage or receipts', async () => {
  const { store, calls } = harness(() => []);
  await store.listPresentationVideoSplitSnapshotsForRequest({ requestId: REQ, limit: 500 });
  expect(calls[0].params).toEqual([REQ, 20]);
  await store.listPresentationVideoSplitSnapshotsForRequest({ requestId: REQ });
  expect(calls[1].params).toEqual([REQ, 10]);
  for (const column of ['lease_token', 'approval_claim_token', 'upload_url_ciphertext', 'lineage', 'cleanup_receipt', 'verification_receipt', 'sandbox_command_id']) {
    expect(SNAPSHOT_COLUMNS).not.toMatch(new RegExp(`\\b${column}\\b`));
  }
  expect(calls[0].text).toContain('ORDER BY created_at DESC LIMIT $2');
});
