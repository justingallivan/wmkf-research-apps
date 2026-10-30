/** @jest-environment node */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import {
  approvePresentationVideoSplit, resolvePresentationVideoSplitOpen, frozenIdentityStaleCode, frozenIdentityIsCurrent,
  reconcileAbandonedForStart,
} from '../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js';
import { presentationVideoGenerationKey } from '../../lib/services/post-presentation-materials/presentation-video-binding.js';
import {
  REQUEST_ID, REVISION, RECORDING_ID, END_MS, PRODUCER, manifest, transcriptRow, recordingRow, videoRow, boundFingerprint,
} from '../helpers/presentation-video-fixtures.js';

const SPLIT = '99999999-9999-4999-8999-999999999999';
const OLD_SPLIT = '98989898-9898-4898-8898-989898989898';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const NEW_DOC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD_DOC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const KEY = presentationVideoGenerationKey(SPLIT, REQUEST_ID);
const args = (over = {}) => ({ requestId: REQUEST_ID, splitId: SPLIT, actorProfileId: 9, actingUserSystemId: ACTOR, ...over });
async function rejection(promise) { try { await promise; } catch (error) { return error; } throw new Error('expected rejection'); }

function splitRow(over = {}) {
  return {
    id: SPLIT, request_id: REQUEST_ID, state: 'review', transcript_revision_id: REVISION, presentation_end_ms: END_MS,
    source_document_id: RECORDING_ID, source_etag: 'rec-etag-1', output_drive_id: 'drive', output_item_id: 'out-item',
    output_etag: 'out-etag-1', output_size: 4000, output_quickxor_hash: 'qx', approval_claim_token: null,
    approval_claimed_at: null, approval_registration_attempted: false, request_document_id: null, ...over,
  };
}

/** In-memory twin of the store's approval state machine (same guards as the SQL). */
function fakeStore(rows) {
  const byId = id => rows.find(r => r.id === id);
  const byToken = token => rows.find(r => r.approval_claim_token === token && r.state === 'registering');
  const log = [];
  const abandoned = r => r.approval_claim_token == null || r.abandoned === true;
  return {
    log, rows,
    claimPresentationVideoApproval: jest.fn(async ({ id, token }) => {
      const r = byId(id);
      if (!r || !(r.state === 'review' || (r.state === 'registering' && abandoned(r)))) return null;
      Object.assign(r, { state: 'registering', approval_claim_token: token, abandoned: false });
      log.push('claim'); return { ...r };
    }),
    findAbandonedRegisteringPresentationVideoSplit: jest.fn(async () => { const r = rows.find(x => x.state === 'registering' && abandoned(x)); return r ? { ...r } : null; }),
    getPresentationVideoSplitForApproval: jest.fn(async ({ id }) => (byId(id) ? { ...byId(id) } : null)),
    markPresentationVideoApprovalAttempted: jest.fn(async ({ token }) => { const r = byToken(token); if (!r) return null; r.approval_registration_attempted = true; log.push('attempted'); return { id: r.id }; }),
    releasePresentationVideoApproval: jest.fn(async ({ token }) => {
      const r = byToken(token); if (!r || r.approval_registration_attempted) return null;
      Object.assign(r, { state: 'review', approval_claim_token: null }); log.push('release'); return { id: r.id };
    }),
    yieldPresentationVideoApproval: jest.fn(async ({ token }) => { const r = byToken(token); if (!r) return null; r.approval_claim_token = null; log.push('yield'); return { id: r.id }; }),
    markPresentationVideoApproved: jest.fn(async ({ token, requestDocumentId, approvedBy }) => {
      const r = byToken(token); if (!r) return null;
      Object.assign(r, { state: 'approved', request_document_id: requestDocumentId, approved_by_profile_id: approvedBy, approval_claim_token: null }); log.push('approved'); return { id: r.id };
    }),
    settleStalePresentationVideoApproval: jest.fn(async ({ token, failureCode, supersededDocumentId }) => {
      const r = byToken(token); if (!r) return null;
      Object.assign(r, { state: 'superseded', failure_code: failureCode, superseded_document_id: supersededDocumentId, approval_claim_token: null }); log.push('settled'); return { id: r.id };
    }),
    supersedeApprovedPresentationVideos: jest.fn(async ({ exceptId }) => rows.filter(r => r.state === 'approved' && r.id !== exceptId).map(r => { r.state = 'superseded'; return { id: r.id }; })),
  };
}

function world({ splits = [splitRow()], docs = [transcriptRow(), recordingRow()], item = {}, failCreateOnce = false } = {}) {
  const store = fakeStore(splits);
  const documents = [...docs];
  let fence = 4;
  const events = [];
  const deps = {
    store,
    schemaReady: () => true, requestAllowed: () => true,
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1002912', wmkf_meetingdate: '2026-12-04', wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } })),
    findActiveSiteVisit: jest.fn(async () => ({ records: [{ activityid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', _regardingobjectid_value: REQUEST_ID }] })),
    findDocuments: jest.fn(async () => ({ records: documents.map(d => ({ ...d })) })),
    findDocumentsWithMeetingTranscriptBundle: jest.fn(async () => ({ records: documents.filter(d => d.wmkf_artifacttype === 100000006).map(d => ({ ...d })) })),
    findDocumentByGenerationKey: jest.fn(async key => ({ records: documents.filter(d => d.wmkf_generationkey === key) })),
    createDocument: jest.fn(async (payload, options) => {
      if (failCreateOnce) { failCreateOnce = false; documents.push({ ...payload, wmkf_requestdocumentid: NEW_DOC, _wmkf_request_value: REQUEST_ID, createdon: '2026-10-10T00:00:00Z' }); throw new Error('response lost'); }
      const row = { ...payload, wmkf_requestdocumentid: NEW_DOC, _wmkf_request_value: REQUEST_ID, createdon: '2026-10-10T00:00:00Z' };
      delete row['wmkf_Request@odata.bind'];
      documents.push(row); return { wmkf_requestdocumentid: NEW_DOC };
    }),
    updateDocument: jest.fn(async (id, patch) => { Object.assign(documents.find(d => d.wmkf_requestdocumentid === id), patch); return {}; }),
    getSharePointBuckets: jest.fn(async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'akoya_request/1002912_x' }]),
    getFileMetadataById: jest.fn(async (driveId, itemId) => ({
      siteId: 'site', driveId, id: itemId, name: 'presentation-video.mp4', size: 4000, webUrl: 'https://sp.example/v.mp4',
      eTag: 'out-etag-1', versionId: '2.0', lastModified: '2026-10-10T00:00:00Z', quickXorHash: 'qx', ...item,
    })),
    resolveMediaDownloadUrl: jest.fn(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-1', size: 4000, quickXorHash: 'qx', malware: null, filename: 'v.mp4', mimeType: 'video/mp4', downloadUrl: 'https://tenant.sharepoint.com/dl' })),
    acquireSlotLease: jest.fn(async () => ({ fence_version: ++fence })),
    getSlotLease: jest.fn(async () => null),
    renewSlotLease: jest.fn(async lease => ({ fence_version: lease.fenceVersion })),
    releaseSlotLease: jest.fn(async () => ({})),
    recordEvent: jest.fn(async event => { events.push(event); }),
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    now: () => new Date(),
  };
  return { deps, store, documents, events };
}

let saved;
beforeEach(() => { saved = process.env.PRESENTATION_VIDEO_SPLIT_ACCESS; process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = 'on'; });
afterEach(() => { if (saved === undefined) delete process.env.PRESENTATION_VIDEO_SPLIT_ACCESS; else process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = saved; });

describe('approve: happy path', () => {
  test('registers the type-100000011 row under the slot fence with the binding fingerprint, then settles approved', async () => {
    const { deps, store, documents } = world();
    const result = await approvePresentationVideoSplit(args(), deps);
    expect(result).toEqual({ status: 200, body: { split: { id: SPLIT, state: 'approved' } } });
    expect(store.log).toEqual(['claim', 'attempted', 'approved']);
    expect(deps.acquireSlotLease).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST_ID, artifactType: 100000011 }));
    const [payload, options] = deps.createDocument.mock.calls[0];
    expect(payload).toMatchObject({
      wmkf_artifacttype: 100000011, wmkf_operationstatus: 100000001, wmkf_lifecyclestate: 100000000, wmkf_producer: PRODUCER,
      wmkf_generationkey: KEY, wmkf_inputfingerprint: boundFingerprint(), wmkf_slotversion: 5, wmkf_contenttype: 'video/mp4',
      wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'out-item', wmkf_sharepointetag: 'out-etag-1', wmkf_sharepointversionid: '2.0',
      wmkf_sharepointfolderpath: 'akoya_request/1002912_x/Post Site Visit Materials', wmkf_filename: 'presentation-video.mp4',
      wmkf_filesize: 4000, wmkf_name: '1002912 presentation video', wmkf_cyclecode: expect.any(String),
    });
    expect(payload['wmkf_Request@odata.bind']).toBe(`/akoya_requests(${REQUEST_ID})`);
    expect(options).toMatchObject({ actorPolicy: expect.anything(), actingUserSystemId: ACTOR });
    expect(options.actorPolicy).toBe(require('../../lib/services/request-document-actor-service.js').REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED);
    expect(store.rows[0]).toMatchObject({ state: 'approved', request_document_id: NEW_DOC, approved_by_profile_id: 9 });
    expect(documents.filter(d => d.wmkf_artifacttype === 100000011)).toHaveLength(1);
    expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
    // The attempted flag is durable before the create call.
    expect(store.markPresentationVideoApprovalAttempted.mock.invocationCallOrder[0]).toBeLessThan(deps.createDocument.mock.invocationCallOrder[0]);
  });
  test('a metadata-only output eTag bump (size and hash unchanged) does not block approval, and the live eTag is registered', async () => {
    const { deps, store, documents } = world({ item: { eTag: 'out-etag-2' } });
    await approvePresentationVideoSplit(args(), deps);
    expect(store.rows[0]).toMatchObject({ state: 'approved' });
    expect(documents.find(d => d.wmkf_artifacttype === 100000011)).toMatchObject({ wmkf_sharepointetag: 'out-etag-2' });
  });
  test('an older approved cut is superseded in Postgres and, by the slot fence, in Dataverse', async () => {
    const old = videoRow({ wmkf_requestdocumentid: OLD_DOC, wmkf_slotversion: 2, wmkf_generationkey: 'o'.repeat(64) });
    const { deps, store, documents } = world({ splits: [splitRow(), splitRow({ id: OLD_SPLIT, state: 'approved' })], docs: [transcriptRow(), recordingRow(), old] });
    await approvePresentationVideoSplit(args(), deps);
    expect(store.rows.find(r => r.id === OLD_SPLIT).state).toBe('superseded');
    expect(documents.find(d => d.wmkf_requestdocumentid === OLD_DOC).wmkf_lifecyclestate).toBe(100000003);
  });
});

describe('approve: refusals before any registry write', () => {
  test('flag off is 404; a bad split id is 400; a missing actor is 403', async () => {
    const { deps } = world();
    process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = 'off';
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ httpStatus: 404 });
    process.env.PRESENTATION_VIDEO_SPLIT_ACCESS = 'on';
    expect(await rejection(approvePresentationVideoSplit(args({ splitId: 'x' }), deps))).toMatchObject({ httpStatus: 400 });
    expect(await rejection(approvePresentationVideoSplit(args({ actingUserSystemId: null }), deps))).toMatchObject({ httpStatus: 403 });
    expect(deps.createDocument).not.toHaveBeenCalled();
  });
  test('a live claim is 409 approval_in_progress; an unknown id is 404; a non-review row is 409', async () => {
    const live = world({ splits: [splitRow({ state: 'registering', approval_claim_token: 'live-token' })] });
    expect(await rejection(approvePresentationVideoSplit(args(), live.deps))).toMatchObject({ httpStatus: 409, code: 'presentation_video_approval_in_progress' });
    const missing = world({ splits: [] });
    expect(await rejection(approvePresentationVideoSplit(args(), missing.deps))).toMatchObject({ httpStatus: 404, code: 'presentation_video_split_not_found' });
    const done = world({ splits: [splitRow({ state: 'approved' })] });
    expect(await rejection(approvePresentationVideoSplit(args(), done.deps))).toMatchObject({ httpStatus: 409, code: 'presentation_video_split_not_reviewable' });
  });
  test('an error before the registry phase releases the claim back to review', async () => {
    const { deps, store } = world();
    deps.getFileMetadataById.mockRejectedValue(new Error('graph down'));
    await rejection(approvePresentationVideoSplit(args(), deps));
    expect(store.rows[0].state).toBe('review');
    expect(store.log).toEqual(['claim', 'release']);
  });
});

describe('approve: stale frozen identity (reconciliation)', () => {
  const republished = () => transcriptRow(manifest({ revisionId: '44444444-4444-4444-8444-444444444444', operationId: '44444444-4444-4444-8444-444444444444', sourceRevisionId: REVISION }));
  test.each([
    ['transcript revision changed', () => ({ docs: [republished(), recordingRow()] }), 'presentation_video_transcript_changed'],
    ['presentation end moved', () => ({ docs: [transcriptRow(manifest({ presentationEnd: { endMs: 1000, confirmedBy: 5, confirmedAt: '2026-10-05T19:00:00.000Z' } })), recordingRow()] }), 'presentation_video_transcript_changed'],
    ['recording replaced', () => ({ docs: [transcriptRow(), recordingRow({ wmkf_sharepointetag: 'rec-etag-2' })] }), 'presentation_video_source_changed'],
    ['transcript gone', () => ({ docs: [recordingRow()] }), 'presentation_video_transcript_changed'],
    ['output size changed', () => ({ item: { size: 4001 } }), 'presentation_video_output_changed'],
    ['output quickXorHash missing live', () => ({ item: { quickXorHash: undefined } }), 'presentation_video_output_changed'],
    ['output quickXorHash missing on the row', () => ({ splits: [splitRow({ output_quickxor_hash: null })] }), 'presentation_video_output_changed'],
    ['output quickXorHash changed', () => ({ item: { quickXorHash: 'other' } }), 'presentation_video_output_changed'],
    ['output item gone', () => ({ item: { id: 'other-item' } }), 'presentation_video_output_changed'],
  ])('%s: no registration, split settled superseded with the specific code, 409 approval_stale', async (_l, make, code) => {
    const { deps, store, documents } = world(make());
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ httpStatus: 409, code: 'presentation_video_approval_stale' });
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.acquireSlotLease).not.toHaveBeenCalled();
    expect(store.rows[0]).toMatchObject({ state: 'superseded', failure_code: code, superseded_document_id: null });
    expect(documents.some(d => d.wmkf_artifacttype === 100000011)).toBe(false);
  });
  test('stale with an orphan row from a lost create response: the orphan is patched SUPERSEDED and recorded on the split', async () => {
    const orphan = videoRow({ wmkf_requestdocumentid: NEW_DOC, wmkf_generationkey: KEY, wmkf_lifecyclestate: 100000000 });
    const { deps, store, documents } = world({ docs: [republished(), recordingRow(), orphan],
      splits: [splitRow({ state: 'registering', approval_claim_token: null, approval_registration_attempted: true })] });
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ code: 'presentation_video_approval_stale' });
    expect(documents.find(d => d.wmkf_requestdocumentid === NEW_DOC).wmkf_lifecyclestate).toBe(100000003);
    expect(store.rows[0]).toMatchObject({ state: 'superseded', failure_code: 'presentation_video_transcript_changed', superseded_document_id: NEW_DOC });
    expect(deps.createDocument).not.toHaveBeenCalled();
  });
  test('an ambiguous generation key during reconciliation yields the claim and stays registering', async () => {
    const dupes = [videoRow({ wmkf_requestdocumentid: NEW_DOC, wmkf_generationkey: KEY }), videoRow({ wmkf_requestdocumentid: OLD_DOC, wmkf_generationkey: KEY })];
    const { deps, store } = world({ docs: [republished(), recordingRow(), ...dupes] });
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ httpStatus: 500, code: 'presentation_video_generation_ambiguous' });
    expect(store.rows[0]).toMatchObject({ state: 'registering', approval_claim_token: null, approval_registration_attempted: true });
  });
});

describe('frozenIdentityStaleCode and reconcileAbandonedForStart', () => {
  const current = (over = {}) => ({
    boundary: { revisionId: REVISION, presentationEnd: { endMs: END_MS } },
    recording: { wmkf_requestdocumentid: RECORDING_ID, wmkf_sharepointetag: 'rec-etag-1' }, ...over,
  });
  test('returns transcript_changed, source_changed or null', () => {
    const row = splitRow();
    expect(frozenIdentityStaleCode(row, current())).toBeNull();
    expect(frozenIdentityIsCurrent(row, current())).toBe(true);
    expect(frozenIdentityStaleCode(row, current({ boundary: null }))).toBe('presentation_video_transcript_changed');
    expect(frozenIdentityStaleCode(row, current({ boundary: { revisionId: REVISION, presentationEnd: { endMs: END_MS + 1 } } }))).toBe('presentation_video_transcript_changed');
    expect(frozenIdentityStaleCode(row, current({ recording: null }))).toBe('presentation_video_source_changed');
    expect(frozenIdentityStaleCode(row, current({ recording: { wmkf_requestdocumentid: RECORDING_ID, wmkf_sharepointetag: 'x' } }))).toBe('presentation_video_source_changed');
    expect(frozenIdentityIsCurrent(row, current({ recording: null }))).toBe(false);
  });
  test.each([
    ['transcript', () => current({ boundary: { revisionId: REVISION, presentationEnd: { endMs: 1 } } }), 'presentation_video_transcript_changed'],
    ['recording', () => current({ recording: { wmkf_requestdocumentid: RECORDING_ID, wmkf_sharepointetag: 'x' } }), 'presentation_video_source_changed'],
  ])('an abandoned registering row with a changed %s is settled with the helper code', async (_l, make, code) => {
    const { deps, store } = world({ splits: [splitRow({ state: 'registering', approval_claim_token: null })] });
    expect(await reconcileAbandonedForStart({ requestId: REQUEST_ID, actorProfileId: 9, actingUserSystemId: ACTOR, current: make() }, deps)).toBe('reconciled');
    expect(store.rows[0]).toMatchObject({ state: 'superseded', failure_code: code });
  });
});

describe('approve: retry identity and lost responses', () => {
  test('lost create response: the row exists but the call threw; the retry reclaims, reuses it by generation key, and does not create again', async () => {
    const { deps, store, documents } = world({ failCreateOnce: true });
    await rejection(approvePresentationVideoSplit(args(), deps));
    expect(store.rows[0]).toMatchObject({ state: 'registering', approval_claim_token: null, approval_registration_attempted: true });
    expect(deps.createDocument).toHaveBeenCalledTimes(1);
    const result = await approvePresentationVideoSplit(args(), deps);
    expect(result.body.split.state).toBe('approved');
    expect(deps.createDocument).toHaveBeenCalledTimes(1);
    expect(documents.filter(d => d.wmkf_artifacttype === 100000011)).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ state: 'approved', request_document_id: NEW_DOC });
    // the slot version was restored to the retry's fence
    expect(documents.find(d => d.wmkf_requestdocumentid === NEW_DOC).wmkf_slotversion).toBe(6);
  });
  test('lost create response followed by a transcript change before retry: the retry supersedes the orphan and settles the split', async () => {
    const { deps, store, documents } = world({ failCreateOnce: true });
    await rejection(approvePresentationVideoSplit(args(), deps));
    const t = documents.findIndex(d => d.wmkf_artifacttype === 100000006);
    documents[t] = transcriptRow(manifest({ presentationEnd: { endMs: 1000, confirmedBy: 5, confirmedAt: '2026-10-05T19:00:00.000Z' } }));
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ code: 'presentation_video_approval_stale' });
    expect(documents.find(d => d.wmkf_requestdocumentid === NEW_DOC).wmkf_lifecyclestate).toBe(100000003);
    expect(store.rows[0]).toMatchObject({ state: 'superseded', superseded_document_id: NEW_DOC });
    expect(deps.createDocument).toHaveBeenCalledTimes(1);
  });
  test('more than one row for the generation key is 500 ambiguous, claim yielded', async () => {
    const dupes = [videoRow({ wmkf_requestdocumentid: NEW_DOC, wmkf_generationkey: KEY }), videoRow({ wmkf_requestdocumentid: OLD_DOC, wmkf_generationkey: KEY })];
    const { deps, store } = world({ docs: [transcriptRow(), recordingRow(), ...dupes] });
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ httpStatus: 500, code: 'presentation_video_generation_ambiguous' });
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(store.rows[0].state).toBe('registering');
  });
  test.each([
    ['request', { _wmkf_request_value: '12121212-1212-4212-8212-121212121212' }],
    ['type', { wmkf_artifacttype: 100000012 }],
    ['producer', { wmkf_producer: 'someone-else' }],
    ['fingerprint', { wmkf_inputfingerprint: 'f'.repeat(64) }],
  ])('an existing row with a different %s is 409 registry_conflict, never reused', async (_l, over) => {
    const clash = videoRow({ wmkf_requestdocumentid: NEW_DOC, wmkf_generationkey: KEY, ...over });
    const { deps, store } = world({ docs: [transcriptRow(), recordingRow(), clash] });
    expect(await rejection(approvePresentationVideoSplit(args(), deps))).toMatchObject({ httpStatus: 409, code: 'presentation_video_registry_conflict' });
    expect(store.rows[0].state).toBe('registering');
    expect(deps.createDocument).not.toHaveBeenCalled();
  });
  test('a lost approval claim after registration is recorded for reconciliation, not a second create', async () => {
    const { deps, store } = world();
    store.markPresentationVideoApproved.mockResolvedValue(null);
    const result = await approvePresentationVideoSplit(args(), deps);
    expect(result.body.split.state).toBe('registering');
    expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'presentation-video-approval-mark' }));
    expect(deps.releaseSlotLease).toHaveBeenCalled();
  });
  test('a failed create is recorded and the slot lease is still released', async () => {
    const { deps } = world();
    deps.createDocument.mockRejectedValue(Object.assign(new Error('nope'), { code: 'dataverse_down' }));
    await rejection(approvePresentationVideoSplit(args(), deps));
    expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'presentation-video-register' }));
    expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
  });
});

describe('staff review open', () => {
  test.each(['review', 'registering', 'approved'])('redirects a %s row after matching the live item id, size and hash', async (state) => {
    const { deps } = world({ splits: [splitRow({ state })] });
    expect(await resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))
      .toEqual({ redirectUrl: 'https://tenant.sharepoint.com/dl', filename: 'v.mp4', mimeType: 'video/mp4' });
    expect(deps.resolveMediaDownloadUrl).toHaveBeenCalledWith('drive', 'out-item');
  });
  test('a processing or terminal row, an unknown id, or a request mismatch is 404 and never reaches Graph', async () => {
    for (const state of ['queued', 'cutting', 'uploading', 'failed', 'superseded']) {
      const { deps } = world({ splits: [splitRow({ state })] });
      expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))).toMatchObject({ httpStatus: 404 });
      expect(deps.resolveMediaDownloadUrl).not.toHaveBeenCalled();
    }
    const { deps } = world({ splits: [] });
    expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))).toMatchObject({ httpStatus: 404 });
  });
  test('a metadata-only eTag change (size and hash unchanged) still redirects', async () => {
    const { deps } = world({ item: { eTag: 'out-etag-2' } });
    deps.resolveMediaDownloadUrl.mockImplementation(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-2', size: 4000, quickXorHash: 'qx', malware: null, downloadUrl: 'https://x.example/d' }));
    expect(await resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps)).toMatchObject({ redirectUrl: 'https://x.example/d' });
  });
  test('changed output content (hash or size on the URL response) is 409 presentation_video_output_changed', async () => {
    for (const over of [{ quickXorHash: 'other' }, { quickXorHash: null }, { size: 4001 }, { itemId: 'other-item' }]) {
      const { deps } = world();
      deps.resolveMediaDownloadUrl.mockImplementation(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-1', size: 4000, quickXorHash: 'qx', malware: null, downloadUrl: 'https://x.example/d', ...over }));
      expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps)))
        .toMatchObject({ httpStatus: 409, code: 'presentation_video_output_changed' });
    }
  });
  test('a same-size replacement is refused even when a separate metadata read would still match (no metadata/URL race)', async () => {
    const { deps } = world();
    deps.resolveMediaDownloadUrl.mockImplementation(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-9', size: 4000, quickXorHash: 'replaced', malware: null, downloadUrl: 'https://x.example/replaced' }));
    expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps)))
      .toMatchObject({ httpStatus: 409, code: 'presentation_video_output_changed' });
  });
  test('a row without a recorded size or hash is 404', async () => {
    for (const over of [{ output_quickxor_hash: null }, { output_size: null }]) {
      const { deps } = world({ splits: [splitRow(over)] });
      expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))).toMatchObject({ httpStatus: 404 });
    }
  });
  test('a different media size, item, malware or a non-https URL is refused', async () => {
    for (const over of [{ size: 1 }, { itemId: 'other' }, { malware: { x: 1 } }]) {
      const { deps } = world();
      deps.resolveMediaDownloadUrl.mockImplementation(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-1', size: 4000, quickXorHash: 'qx', malware: null, downloadUrl: 'https://x.example/d', ...over }));
      expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))).toMatchObject({ httpStatus: expect.any(Number) });
    }
    const { deps } = world();
    deps.resolveMediaDownloadUrl.mockImplementation(async (driveId, itemId) => ({ driveId, itemId, eTag: 'out-etag-1', size: 4000, quickXorHash: 'qx', downloadUrl: 'http://x.example/d' }));
    expect(await rejection(resolvePresentationVideoSplitOpen({ requestId: REQUEST_ID, splitId: SPLIT }, deps))).toMatchObject({ httpStatus: 502 });
  });
});
