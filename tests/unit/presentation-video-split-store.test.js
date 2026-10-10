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

test('start runs lock, processing check, locked awaiting check, insert in one transaction, in that order (no awaiting row: no UPDATE)', async () => {
  const { store, calls } = harness(none);
  const result = await store.startPresentationVideoSplit(START);
  expect(result).toEqual({ status: 'started', split: { id: ID, state: 'queued' }, supersededIds: [] });
  const texts = calls.map(c => c.text);
  expect(texts[0]).toContain('pg_advisory_xact_lock(hashtext($1), 0)');
  expect(calls[0].params).toEqual([`presentation_video_split:${REQ.toLowerCase()}`]);
  expect(texts[1]).toContain("state IN ('queued', 'cutting', 'uploading')");
  expect(texts[2]).toContain("state IN ('review', 'registering') FOR UPDATE");
  expect(texts[3]).toContain('INSERT INTO presentation_video_splits');
  expect(texts[3]).toContain("'queued'");
  expect(calls[3].params).toEqual([ID, REQ, SITE, 7, COPY, REV, 1234, DOC, 'd', 'i', '3', 'e', 99, 'q', '{"version":1}']);
  expect(texts).toHaveLength(4);
});

test('start supersedes exactly the locked review row by id, then inserts', async () => {
  const { store, calls } = harness(text => (text.includes('FOR UPDATE') ? [{ id: DOC, state: 'review' }]
    : text.startsWith('SELECT id') ? [] : text.startsWith('UPDATE') ? [{ id: DOC }] : [{ id: ID, state: 'queued' }]));
  expect(await store.startPresentationVideoSplit(START)).toMatchObject({ status: 'started', supersededIds: [DOC] });
  const update = calls.find(c => c.text.startsWith('UPDATE'));
  expect(update.text).toContain("WHERE id = $1 AND state = 'review'");
  expect(update.params).toEqual([DOC]);
});

test('a locked review row that no longer updates refuses instead of inserting beside it', async () => {
  const { store, calls } = harness(text => (text.includes('FOR UPDATE') ? [{ id: DOC, state: 'review' }]
    : text.startsWith('SELECT id') || text.startsWith('UPDATE') ? [] : [{ id: ID, state: 'queued' }]));
  expect(await store.startPresentationVideoSplit(START)).toEqual({ status: 'approval_in_progress', split: null });
  expect(calls.some(c => c.text.startsWith('INSERT'))).toBe(false);
});

test('start refuses a processing split without writing', async () => {
  const { store, calls } = harness(text => (text.includes("'queued', 'cutting', 'uploading'") ? [{ id: ID }] : []));
  expect(await store.startPresentationVideoSplit(START)).toEqual({ status: 'active', split: null });
  expect(calls.some(c => /^(INSERT|UPDATE)/.test(c.text))).toBe(false);
});

test('start refuses any registering split without writing', async () => {
  const { store, calls } = harness(text => (text.includes('FOR UPDATE') ? [{ id: ID, state: 'registering' }] : []));
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

// --- slice 3: worker transitions and the cleanup ledger -------------------------------------------------------
const TOKEN = '99999999-9999-4999-8999-999999999999';
const FENCE = 'lease_token = $2 AND lease_expires_at > NOW()';
const one = (store, name, args) => { const h = harness(); return h.store[name](args).then(() => h.calls[0]); };

test('claim takes one due processing row (lease-expired included), skips locked rows, and normalizes BIGINT strings', async () => {
  const { store, calls } = harness(() => [{ id: ID, state: 'queued', presentation_end_ms: '1234', source_size: '99', output_size: null }]);
  const claim = await store.claimPresentationVideoSplitWork({ accessRequestId: REQ, leaseSeconds: 600 });
  expect(claim.row).toMatchObject({ presentation_end_ms: 1234, source_size: 99, output_size: null });
  expect(typeof claim.leaseToken).toBe('string');
  expect(calls[0].text).toContain("state IN ('queued', 'cutting', 'uploading')");
  expect(calls[0].text).toContain('lease_token IS NULL OR lease_expires_at <= NOW()');
  expect(calls[0].text).toContain('next_attempt_at IS NULL OR next_attempt_at <= NOW()');
  expect(calls[0].text).toContain('FOR UPDATE SKIP LOCKED');
  expect(calls[0].params.slice(1)).toEqual([REQ, 600]);
  expect(await harness(() => []).store.claimPresentationVideoSplitWork({ leaseSeconds: 600 })).toBeNull();
});

test('every worker transition is lease-fenced with its own from-state', async () => {
  const cases = [
    ['renewPresentationVideoSplitLease', { id: ID, leaseToken: TOKEN, states: ['cutting'], leaseSeconds: 600 }, 'state = ANY($4::text[])'],
    ['deferPresentationVideoSplitAttempt', { id: ID, leaseToken: TOKEN, retrySeconds: 900 }, "state IN ('queued', 'cutting', 'uploading')"],
    ['recordPresentationVideoSandboxName', { id: ID, leaseToken: TOKEN, sandboxName: 's4-x' }, "state = 'queued' AND sandbox_name IS NULL"],
    ['recordPresentationVideoSandboxCreated', { id: ID, leaseToken: TOKEN }, "state = 'queued'"],
    ['recordPresentationVideoCutStarted', { id: ID, leaseToken: TOKEN, commandId: 'c1' }, "state = 'queued'"],
    ['recordPresentationVideoCutReceiptAndUploadStarted', { id: ID, leaseToken: TOKEN, verificationReceipt: { ok: true }, uploadUrlCiphertext: 'sealed', commandId: 'c2' }, "state = 'cutting'"],
    ['markPresentationVideoSplitReview', { id: ID, leaseToken: TOKEN, outputDriveId: 'd', outputItemId: 'i', outputEtag: 'e', outputSize: 5 }, "state = 'uploading'"],
    ['failPresentationVideoSplit', { id: ID, leaseToken: TOKEN, failureCode: 'processor_lost' }, "state IN ('queued', 'cutting', 'uploading')"],
    ['supersedePresentationVideoSplit', { id: ID, leaseToken: TOKEN, failureCode: 'presentation_video_source_changed' }, "state IN ('queued', 'cutting', 'uploading')"],
  ];
  for (const [name, args, predicate] of cases) {
    const call = await one(null, name, args);
    expect(call.text).toContain(FENCE);
    expect(call.text).toContain(predicate);
    expect(call.params.slice(0, 2)).toEqual([ID, TOKEN]);
  }
});

test('review, failed and superseded clear the lease and the sealed upload URL; release only needs the token', async () => {
  for (const [name, args, state] of [
    ['markPresentationVideoSplitReview', { id: ID, leaseToken: TOKEN, outputDriveId: 'd', outputItemId: 'i', outputEtag: 'e', outputSize: 5 }, 'review'],
    ['failPresentationVideoSplit', { id: ID, leaseToken: TOKEN, failureCode: 'x_y' }, 'failed'],
    ['supersedePresentationVideoSplit', { id: ID, leaseToken: TOKEN }, 'superseded'],
  ]) {
    const call = await one(null, name, args);
    expect(call.text).toContain(`state = '${state}'`);
    expect(call.text).toContain('upload_url_ciphertext = NULL');
    expect(call.text).toContain('lease_token = NULL, lease_expires_at = NULL');
  }
  const release = await one(null, 'releasePresentationVideoSplitLease', { id: ID, leaseToken: TOKEN });
  expect(release.text).toContain('WHERE id = $1 AND lease_token = $2');
});

test('invalid codes, sizes and seconds are rejected before any SQL', async () => {
  const { store, calls } = harness();
  await expect(store.failPresentationVideoSplit({ id: ID, leaseToken: TOKEN, failureCode: 'Has Spaces' })).rejects.toThrow(TypeError);
  await expect(store.markPresentationVideoSplitReview({ id: ID, leaseToken: TOKEN, outputDriveId: 'd', outputItemId: 'i', outputEtag: 'e', outputSize: 0 })).rejects.toThrow(TypeError);
  await expect(store.claimPresentationVideoSplitWork({ leaseSeconds: 0 })).rejects.toThrow(TypeError);
  expect(calls).toHaveLength(0);
});

test('cleanup claim never selects a processing row, orders by next_cleanup_at, and bumps attempts and backoff in the same statement', async () => {
  const { store, calls } = harness(() => [{ id: ID, sandbox_name: 's4-x', cleanup_attempts: 1 }]);
  expect(await store.claimPresentationVideoSplitCleanup({ limit: 2 })).toHaveLength(1);
  const text = calls[0].text;
  expect(text).toContain('sandbox_name IS NOT NULL AND sandbox_cleaned_at IS NULL');
  expect(text).toContain("state NOT IN ('queued', 'cutting', 'uploading')");
  expect(text).not.toContain('lease_token IS NULL');
  expect(text).toContain('ORDER BY next_cleanup_at NULLS FIRST');
  expect(text).toContain('FOR UPDATE SKIP LOCKED');
  expect(text).toContain('cleanup_attempts = s.cleanup_attempts + 1');
  expect(text).toContain("INTERVAL '1 minute'");
  expect(text).toContain("INTERVAL '10 minutes'");
  expect(text).toContain("INTERVAL '1 hour'");
  expect(calls[0].params).toEqual([2]);
});

test('usage, cleaned receipt, orphan lookup and source-copy read', async () => {
  const usage = await one(null, 'recordPresentationVideoSandboxUsage', { id: ID, activeCpuMs: 10, provisionedMs: 20, vcpus: 2 });
  expect(usage.params).toEqual([ID, 10, 20, 2]);
  const cleaned = await one(null, 'markPresentationVideoSandboxCleaned', { id: ID, cleanupReceipt: { snapshots: 0 } });
  expect(cleaned.text).toContain('sandbox_cleaned_at IS NULL AND state NOT IN');
  expect(cleaned.params).toEqual([ID, '{"snapshots":0}']);
  const { store, calls } = harness(() => [{ sandbox_name: 's4-a' }]);
  expect(await store.listUncleanedPresentationVideoSandboxNames({ names: ['s4-a', 's4-b'] })).toEqual(['s4-a']);
  expect(calls[0].text).toContain('sandbox_cleaned_at IS NULL');
  expect(await store.listUncleanedPresentationVideoSandboxNames({ names: [] })).toEqual([]);
  const copy = await one(null, 'getPresentationVideoSourceCopy', { copyId: COPY });
  expect(copy.text).toContain('FROM zoom_video_copies WHERE id = $1');
});

test('recovery claim: unleased processing rows only, access-withdrawn or aged, fresh lease, locked', async () => {
  const { store, calls } = harness(() => [{ id: ID, state: 'cutting', presentation_end_ms: '5', source_size: '9', recovery_reason: 'access_withdrawn' }]);
  const out = await store.claimPresentationVideoSplitRecovery({ accessMode: 'test', testRequestId: REQ, maxAgeSeconds: 11700, leaseSeconds: 600 });
  expect(out[0]).toMatchObject({ reason: 'access_withdrawn', row: { presentation_end_ms: 5 } });
  const text = calls[0].text;
  expect(text).toContain("state IN ('queued', 'cutting', 'uploading')");
  expect(text).toContain('lease_token IS NULL OR lease_expires_at <= NOW()');
  expect(text).toContain('COALESCE(sandbox_created_at, created_at) < NOW() - ($4 || \' seconds\')::INTERVAL');
  expect(text).not.toContain('updated_at < NOW()');
  expect(text).toContain('FOR UPDATE SKIP LOCKED');
  expect(calls[0].params.slice(0, 4)).toEqual([2, 'test', REQ, 11700]);
  await expect(store.claimPresentationVideoSplitRecovery({ accessMode: 'bogus', maxAgeSeconds: 1, leaseSeconds: 1 })).rejects.toThrow(TypeError);
});

describe('slice 4 approval writers', () => {
  const TOKEN = '88888888-8888-4888-8888-888888888888';
  test('claim: advisory lock first, then one UPDATE taking review or an abandoned registering row, with the actor', async () => {
    const { store, calls } = harness(text => (text.startsWith('UPDATE') ? [{ id: ID, state: 'registering', presentation_end_ms: '5', source_size: '9', output_size: '4' }] : []));
    const row = await store.claimPresentationVideoApproval({ id: ID, requestId: REQ, actorProfileId: 7, token: TOKEN });
    expect(row).toMatchObject({ id: ID, presentation_end_ms: 5, output_size: 4 });
    expect(calls[0].text).toContain('pg_advisory_xact_lock(hashtext($1), 0)');
    expect(calls[0].params).toEqual([`presentation_video_split:${REQ.toLowerCase()}`]);
    expect(calls).toHaveLength(2);
    const sql = calls[1].text;
    expect(sql).toContain("SET state = 'registering', approval_claim_token = $3, approval_claimed_at = NOW(), approval_actor_profile_id = $4");
    expect(sql).toContain("state = 'review' OR (state = 'registering' AND (approval_claim_token IS NULL OR approval_claimed_at <= NOW() - INTERVAL '180 seconds'))");
    expect(calls[1].params).toEqual([ID, REQ, TOKEN, 7]);
  });
  test('claim returns null when nothing is claimable', async () => {
    const { store } = harness(() => []);
    expect(await store.claimPresentationVideoApproval({ id: ID, requestId: REQ, actorProfileId: 7, token: TOKEN })).toBeNull();
  });
  test('claim rejects malformed input before any query', async () => {
    const { store, calls } = harness();
    await expect(store.claimPresentationVideoApproval({ id: 'x', requestId: REQ, actorProfileId: 7, token: TOKEN })).rejects.toThrow(TypeError);
    await expect(store.claimPresentationVideoApproval({ id: ID, requestId: REQ, actorProfileId: 0, token: TOKEN })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
  test('markAttempted, release, yield, approve and settle are each guarded by the claim token and from-state', async () => {
    const { store, calls } = harness();
    await store.markPresentationVideoApprovalAttempted({ token: TOKEN });
    await store.releasePresentationVideoApproval({ token: TOKEN });
    await store.yieldPresentationVideoApproval({ token: TOKEN });
    await store.markPresentationVideoApproved({ token: TOKEN, requestDocumentId: DOC, approvedBy: 7 });
    await store.settleStalePresentationVideoApproval({ token: TOKEN, supersededDocumentId: DOC });
    const [attempted, release, yielded, approved, settled] = calls.map(c => c.text);
    expect(attempted).toContain('approval_registration_attempted = TRUE, approval_claimed_at = NOW()');
    expect(attempted).toContain("approval_claim_token = $1 AND state = 'registering'");
    expect(release).toContain("SET state = 'review'");
    expect(release).toContain("approval_claim_token = $1 AND state = 'registering' AND NOT approval_registration_attempted");
    expect(yielded).toContain('SET approval_claim_token = NULL');
    expect(yielded).not.toContain("state = 'review'");
    expect(approved).toContain("SET state = 'approved', request_document_id = $2, approved_by_profile_id = $3, approved_at = NOW(), approval_claim_token = NULL");
    expect(approved).toContain("approval_claim_token = $1 AND state = 'registering'");
    expect(settled).toContain("state = 'superseded', failure_code = 'presentation_video_approval_stale', superseded_document_id = $2");
    expect(settled).toContain("approval_claim_token = $1 AND state = 'registering'");
    expect(calls.map(c => c.params[0])).toEqual(Array(5).fill(TOKEN));
    expect(calls[3].params).toEqual([TOKEN, DOC, 7]);
    expect(calls[4].params).toEqual([TOKEN, DOC]);
  });
  test('settle with no orphan passes a null document id', async () => {
    const { store, calls } = harness();
    await store.settleStalePresentationVideoApproval({ token: TOKEN });
    expect(calls[0].params).toEqual([TOKEN, null]);
  });
  test('supersedeApproved touches only older approved rows of the request, never the kept one', async () => {
    const { store, calls } = harness(() => [{ id: DOC }]);
    expect(await store.supersedeApprovedPresentationVideos({ requestId: REQ, exceptId: ID })).toEqual([{ id: DOC }]);
    expect(calls[0].text).toContain("request_id = $1 AND state = 'approved' AND id <> $2");
    expect(calls[0].params).toEqual([REQ, ID]);
  });
  test('findAbandonedRegistering selects only a registering row with a null or old claim', async () => {
    const { store, calls } = harness(() => [{ id: ID, presentation_end_ms: '10' }]);
    expect(await store.findAbandonedRegisteringPresentationVideoSplit({ requestId: REQ })).toMatchObject({ id: ID, presentation_end_ms: 10 });
    expect(calls[0].text).toContain("state = 'registering' AND (approval_claim_token IS NULL OR approval_claimed_at <= NOW() - INTERVAL '180 seconds')");
  });
  test('getForApproval returns the full row scoped to the request', async () => {
    const { store, calls } = harness(() => [{ id: ID, lineage: { a: 1 }, output_size: '3' }]);
    expect(await store.getPresentationVideoSplitForApproval({ id: ID, requestId: REQ })).toMatchObject({ lineage: { a: 1 }, output_size: 3 });
    expect(calls[0].text).toContain('WHERE id = $1 AND request_id = $2');
  });
});
