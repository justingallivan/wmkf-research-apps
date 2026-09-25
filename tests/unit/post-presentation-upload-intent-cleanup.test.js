/** @jest-environment node */
import { cleanupPresentationMaterialUploads } from '../../lib/services/post-presentation-materials/upload-intent-cleanup.js';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  request_id: '22222222-2222-4222-8222-222222222222',
  actor_id: '33333333-3333-4333-8333-333333333333',
  artifact_type: 100000005,
  declared_size: 100,
  library_name: 'akoya_request',
  folder_path: '1003220/Post Site Visit Materials',
  physical_filename: 'recording.mp4',
  generation_key: 'a'.repeat(64),
  upload_url_ciphertext: 'sealed',
  state: 'initiated',
};

const ITEM = {
  siteId: 'site', driveId: 'drive', id: 'item', name: 'recording.mp4', size: 100,
  eTag: 'etag', versionId: '1.0',
};

function deps(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    access: jest.fn(() => ({ mode: 'off', valid: true })),
    claim: jest.fn(async () => ({ leaseToken: 'lease', rows: [ROW] })),
    release: jest.fn(async () => ({})),
    renew: jest.fn(async () => ({ id: ROW.id })),
    recordCandidate: jest.fn(async () => ({ id: ROW.id })),
    bind: jest.fn(async () => ({ id: ROW.id })),
    abandon: jest.fn(async () => ({ id: ROW.id })),
    refreshSession: jest.fn(async () => ({ id: ROW.id })),
    openUploadUrl: jest.fn(() => 'https://upload.example/session'),
    getSessionStatus: jest.fn(async () => ({
      expiresAt: '2026-09-30T12:00:00Z', nextExpectedRanges: ['10-'],
    })),
    getByPath: jest.fn(async () => ITEM),
    getById: jest.fn(async () => ITEM),
    deleteByEtag: jest.fn(async () => 204),
    findByGenerationKey: jest.fn(async () => ({ records: [] })),
    recordEvent: jest.fn(async () => ({})),
    sleep: jest.fn(async () => {}),
    destructiveCleanupEnabled: jest.fn(() => false),
    ...overrides,
  };
}

test.each(['off', 'test'])('%s mode records but never deletes an exact unbound candidate', async (mode) => {
  const d = deps({ access: () => ({ mode, valid: true }) });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(result).toEqual(expect.objectContaining({ scanned: 1, retained: 1, deleted: 0 }));
  expect(d.recordCandidate).toHaveBeenCalled();
  expect(d.deleteByEtag).not.toHaveBeenCalled();
  expect(d.abandon).not.toHaveBeenCalled();
  expect(d.release).toHaveBeenCalledWith(expect.objectContaining({ lastError: 'unbound_inspect_only' }));
});

test('on mode remains inspect-only until routine destructive cleanup is separately enabled', async () => {
  const d = deps({ access: () => ({ mode: 'on', valid: true }) });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(result.retained).toBe(1);
  expect(d.deleteByEtag).not.toHaveBeenCalled();
});

test('approved on-mode cleanup deletes only the exact zero-row candidate with its observed ETag', async () => {
  const d = deps({
    access: () => ({ mode: 'on', valid: true }),
    destructiveCleanupEnabled: () => true,
  });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(d.findByGenerationKey).toHaveBeenCalledWith(ROW.generation_key);
  expect(d.deleteByEtag).toHaveBeenCalledWith('drive', 'item', 'etag');
  expect(d.renew).toHaveBeenCalledWith({ uploadId: ROW.id, leaseToken: 'lease' });
  expect(d.abandon).toHaveBeenCalledWith({
    uploadId: ROW.id, leaseToken: 'lease', lastError: 'unbound_candidate_deleted',
  });
  expect(result.deleted).toBe(1);
});

test('an exact registry binding in any lifecycle retains bytes and closes authority only in on mode', async () => {
  const d = deps({
    access: () => ({ mode: 'on', valid: true }),
    destructiveCleanupEnabled: () => true,
    findByGenerationKey: jest.fn(async () => ({ records: [{
      wmkf_requestdocumentid: '44444444-4444-4444-8444-444444444444',
      _wmkf_request_value: ROW.request_id,
      wmkf_artifacttype: ROW.artifact_type,
      wmkf_producer: 'meeting-tracker-post-presentation',
      wmkf_generationkey: ROW.generation_key,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'item',
      wmkf_lifecyclestate: 100000003,
    }] })),
  });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(d.bind).toHaveBeenCalledWith({
    uploadId: ROW.id,
    leaseToken: 'lease',
    requestDocumentId: '44444444-4444-4444-8444-444444444444',
  });
  expect(d.deleteByEtag).not.toHaveBeenCalled();
  expect(result.bound).toBe(1);
});

test('a live session only refreshes server-observed expiry and review-after', async () => {
  const d = deps({ getByPath: jest.fn(async () => null) });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(d.refreshSession).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: ROW.id,
    expiresAt: '2026-09-30T12:00:00.000Z',
    intentExpiresAt: '2026-10-03T12:00:00.000Z',
  }));
  expect(d.release).toHaveBeenCalledWith({
    uploadId: ROW.id, leaseToken: 'lease', lastError: null,
  });
  expect(d.deleteByEtag).not.toHaveBeenCalled();
  expect(result.refreshed).toBe(1);
});

test('an unexpected item at the exact path is retained without consulting session state or deleting bytes', async () => {
  const d = deps({
    access: () => ({ mode: 'on', valid: true }),
    destructiveCleanupEnabled: () => true,
    getByPath: jest.fn(async () => ({ ...ITEM, size: 99 })),
  });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(result).toEqual(expect.objectContaining({ retained: 1, deleted: 0, abandoned: 0 }));
  expect(d.getSessionStatus).not.toHaveBeenCalled();
  expect(d.deleteByEtag).not.toHaveBeenCalled();
  expect(d.abandon).not.toHaveBeenCalled();
  expect(d.release).toHaveBeenCalledWith(expect.objectContaining({ lastError: 'candidate_mismatch' }));
});

test('approved cleanup closes a failed intent that never received an upload-session URL', async () => {
  const d = deps({
    access: () => ({ mode: 'on', valid: true }),
    destructiveCleanupEnabled: () => true,
    claim: jest.fn(async () => ({
      leaseToken: 'lease',
      rows: [{ ...ROW, state: 'failed', upload_url_ciphertext: null }],
    })),
    getByPath: jest.fn(async () => null),
  });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(d.renew).toHaveBeenCalledWith({ uploadId: ROW.id, leaseToken: 'lease' });
  expect(d.abandon).toHaveBeenCalledWith({
    uploadId: ROW.id,
    leaseToken: 'lease',
    lastError: 'session_create_failed_no_candidate',
  });
  expect(result.abandoned).toBe(1);
});

test('inspect-only cleanup retains a failed intent that never received an upload-session URL', async () => {
  const d = deps({
    claim: jest.fn(async () => ({
      leaseToken: 'lease',
      rows: [{ ...ROW, state: 'failed', upload_url_ciphertext: null }],
    })),
    getByPath: jest.fn(async () => null),
  });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(d.abandon).not.toHaveBeenCalled();
  expect(d.release).toHaveBeenCalledWith(expect.objectContaining({ lastError: 'session_url_missing' }));
  expect(result.retained).toBe(1);
});

test('the default batch size is four and rows are reconciled concurrently', async () => {
  let active = 0;
  let peak = 0;
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const rows = [ROW, { ...ROW, id: '55555555-5555-4555-8555-555555555555' }];
  const d = deps({
    claim: jest.fn(async () => ({ leaseToken: 'lease', rows })),
    getByPath: jest.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (peak === rows.length) unblock();
      await gate;
      active -= 1;
      return ITEM;
    }),
  });
  await cleanupPresentationMaterialUploads({}, d);
  expect(d.claim).toHaveBeenCalledWith({ limit: 4 });
  expect(peak).toBe(2);
});

test('unknown or invalid access remains inspect-only', async () => {
  const d = deps({ access: () => ({ mode: 'off', valid: false }) });
  const result = await cleanupPresentationMaterialUploads({}, d);
  expect(result.retained).toBe(1);
  expect(d.deleteByEtag).not.toHaveBeenCalled();
});
