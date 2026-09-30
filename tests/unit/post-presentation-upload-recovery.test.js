/** @jest-environment node */
import { cancelMp4Upload, retryMp4Upload } from '../../lib/services/post-presentation-materials/material-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const UPLOAD_ID = '44444444-4444-4444-8444-444444444444';
const FINGERPRINT = 'a'.repeat(64);
const LEASE = '55555555-5555-4555-8555-555555555555';
const FILENAME = `1003220-Recording-${UPLOAD_ID}.mp4`;
const expired = () => Object.assign(new Error('expired'), { status: 410 });
const missing = () => Object.assign(new Error('missing'), { status: 404 });

function intent(overrides = {}) {
  return {
    id: UPLOAD_ID, request_id: REQUEST_ID, site_visit_id: VISIT_ID, actor_id: ACTOR_ID,
    state: 'failed', last_error: 'session_expired', candidate_item_id: null,
    request_document_id: null, client_resume_fingerprint: FINGERPRINT,
    original_display_filename: 'recording.mp4', validated_mime_type: 'video/mp4',
    declared_size: 100, library_name: 'akoya_request',
    folder_path: '1003220/Post Site Visit Materials', physical_filename: FILENAME,
    generation_key: 'b'.repeat(64), upload_url_ciphertext: 'sealed-old-url',
    ...overrides,
  };
}

function dependencies(row = intent(), overrides = {}) {
  return {
    schemaReady: jest.fn(() => true), requestAllowed: jest.fn(() => true),
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID, akoya_requestnum: '1003220',
      wmkf_meetingdate: '2026-12-10T00:00:00Z',
    })),
    findActiveSiteVisit: jest.fn(async () => ({ records: [{
      activityid: VISIT_ID, _regardingobjectid_value: REQUEST_ID,
    }] })),
    findDocuments: jest.fn(async () => ({ records: [] })),
    getUploadIntent: jest.fn(async () => row),
    claimUploadRecovery: jest.fn(async () => ({ row, leaseToken: LEASE })),
    renewUploadRecovery: jest.fn(async () => row),
    releaseUploadRecovery: jest.fn(async () => row),
    markUploadRecoveryTerminal: jest.fn(async () => row),
    markUploadRecoveryUncertain: jest.fn(async () => row),
    cancelUploadRecovery: jest.fn(async () => ({ ...row, state: 'abandoned' })),
    recordUploadRecoverySession: jest.fn(async () => ({ ...row, state: 'initiated' })),
    recordUploadCandidate: jest.fn(async () => ({ ...row, state: 'uploaded' })),
    refreshUploadSession: jest.fn(async () => row),
    getFileMetadataByPath: jest.fn(async () => null),
    getFileMetadataById: jest.fn(),
    openUploadUrl: jest.fn(() => 'https://upload.example/old'),
    sealUploadUrl: jest.fn(() => 'sealed-new-url'),
    getBrowserUploadSessionStatus: jest.fn(async () => { throw expired(); }),
    cancelBrowserUploadSession: jest.fn(async () => ({ outcome: 'cancelled' })),
    createBrowserUploadSession: jest.fn(async () => ({
      uploadUrl: 'https://upload.example/new',
      expiresAt: '2026-09-30T13:00:00Z', nextExpectedRanges: ['0-'],
    })),
    recordEvent: jest.fn(async () => {}),
    sleep: jest.fn(async () => {}),
    now: jest.fn(() => new Date('2026-09-29T12:00:00Z')),
    ...overrides,
  };
}

const cancelArgs = { requestId: REQUEST_ID, uploadId: UPLOAD_ID, actingUserSystemId: ACTOR_ID };
const retryArgs = { ...cancelArgs, resumeFingerprint: FINGERPRINT };

test('Cancel repeats cleanly after an abandoned response is lost', async () => {
  const d = dependencies(intent({ state: 'abandoned', upload_url_ciphertext: null }));
  await expect(cancelMp4Upload(cancelArgs, d)).resolves.toEqual({ uploadId: UPLOAD_ID, cancelled: true });
  expect(d.claimUploadRecovery).not.toHaveBeenCalled();
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
});

test('stale Cancel and Retry return a finalized material without touching Graph', async () => {
  const d = dependencies(intent({ state: 'finalized', request_document_id: '66666666-6666-4666-8666-666666666666' }));
  await expect(cancelMp4Upload(cancelArgs, d)).resolves.toMatchObject({
    uploadId: UPLOAD_ID, finalized: true, requestDocumentId: '66666666-6666-4666-8666-666666666666',
    materials: expect.any(Array),
  });
  await expect(retryMp4Upload(retryArgs, d)).resolves.toMatchObject({ finalized: true });
  expect(d.claimUploadRecovery).not.toHaveBeenCalled();
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
});

test('Cancel abandons only after confirmed session cancellation and three absent exact-path reads', async () => {
  const d = dependencies();
  await expect(cancelMp4Upload(cancelArgs, d)).resolves.toEqual({ uploadId: UPLOAD_ID, cancelled: true });
  expect(d.cancelBrowserUploadSession).toHaveBeenCalledWith('https://upload.example/old');
  expect(d.getFileMetadataByPath).toHaveBeenCalledTimes(4);
  expect(d.sleep.mock.calls).toEqual([[2_000], [8_000]]);
  expect(d.cancelUploadRecovery).toHaveBeenCalledWith({ uploadId: UPLOAD_ID, leaseToken: LEASE });
  expect(d.recordUploadCandidate).not.toHaveBeenCalled();
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
});

test('Cancel preserves a late complete item after ambiguous Graph 404', async () => {
  const item = { siteId: 'site', driveId: 'drive', id: 'item', name: FILENAME,
    size: 100, eTag: 'etag', versionId: '1.0' };
  const d = dependencies(intent(), {
    cancelBrowserUploadSession: jest.fn(async () => ({ outcome: 'gone' })),
    getFileMetadataByPath: jest.fn()
      .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(item),
    getFileMetadataById: jest.fn(async () => item),
  });
  await expect(cancelMp4Upload(cancelArgs, d)).resolves.toMatchObject({ complete: true, canFinalize: true });
  expect(d.recordUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    leaseToken: LEASE, candidate: expect.objectContaining({ itemId: 'item', size: 100 }),
  }));
  expect(d.cancelUploadRecovery).not.toHaveBeenCalled();
});

test('Cancel never treats Graph 404 plus an absent path as confirmed cancellation', async () => {
  const d = dependencies(intent(), {
    cancelBrowserUploadSession: jest.fn(async () => ({ outcome: 'gone' })),
  });
  await expect(cancelMp4Upload(cancelArgs, d)).rejects.toMatchObject({
    code: 'post_presentation_upload_reconciliation_pending',
  });
  expect(d.cancelUploadRecovery).not.toHaveBeenCalled();
  expect(d.markUploadRecoveryUncertain).toHaveBeenCalledWith(expect.objectContaining({
    lastError: 'cancel_status_unknown',
  }));
});

test('Cancel retains a partial placeholder and records an uncertain state', async () => {
  const d = dependencies(intent(), {
    getFileMetadataByPath: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'partial', name: FILENAME, size: 20,
    })),
  });
  await expect(cancelMp4Upload(cancelArgs, d)).rejects.toMatchObject({
    code: 'post_presentation_upload_reconciliation_pending',
  });
  expect(d.markUploadRecoveryUncertain).toHaveBeenCalledWith(expect.objectContaining({
    lastError: 'cancel_path_uncertain',
  }));
  expect(d.cancelUploadRecovery).not.toHaveBeenCalled();
});

test('Cancel refuses changed visit or actor before Graph mutation', async () => {
  const d = dependencies(intent({ site_visit_id: '99999999-9999-4999-8999-999999999999' }));
  await expect(cancelMp4Upload(cancelArgs, d)).rejects.toMatchObject({ code: 'post_presentation_site_visit_changed' });
  expect(d.claimUploadRecovery).not.toHaveBeenCalled();
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
  const foreign = dependencies(null);
  await expect(cancelMp4Upload(cancelArgs, foreign)).rejects.toMatchObject({ code: 'post_presentation_upload_not_found' });
  expect(foreign.cancelBrowserUploadSession).not.toHaveBeenCalled();
  const disabled = dependencies(intent(), { requestAllowed: jest.fn(() => false) });
  await expect(cancelMp4Upload(cancelArgs, disabled)).rejects.toMatchObject({
    code: 'post_presentation_not_available',
  });
  expect(disabled.claimUploadRecovery).not.toHaveBeenCalled();
});

test('a lost recovery lease blocks both cancellation and fresh-session creation', async () => {
  const d = dependencies(intent(), { renewUploadRecovery: jest.fn(async () => null) });
  await expect(cancelMp4Upload(cancelArgs, d)).rejects.toMatchObject({ code: 'post_presentation_upload_changed' });
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
  await expect(retryMp4Upload(retryArgs, d)).rejects.toMatchObject({ code: 'post_presentation_upload_changed' });
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
});

test('recovery cannot claim an active finalizer even after its candidate was recorded', async () => {
  const row = intent({
    state: 'finalizing', candidate_item_id: 'item',
    lease_expires_at: '2026-09-29T12:05:00Z',
  });
  const d = dependencies(row);
  await expect(cancelMp4Upload(cancelArgs, d)).rejects.toMatchObject({
    code: 'post_presentation_finalize_in_progress',
  });
  expect(d.claimUploadRecovery).not.toHaveBeenCalled();
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
});

test('Retry reuses a live Graph session and its confirmed range without creating another', async () => {
  const row = intent({ state: 'initiated' });
  const d = dependencies(row, {
    getBrowserUploadSessionStatus: jest.fn(async () => ({
      expiresAt: '2026-09-30T13:00:00Z', nextExpectedRanges: ['20-'],
    })),
  });
  await expect(retryMp4Upload(retryArgs, d)).resolves.toMatchObject({
    restarted: false, uploadUrl: 'https://upload.example/old', nextExpectedRanges: ['20-'],
  });
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
  expect(d.refreshUploadSession).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: LEASE }));
});

test('Retry starts one zero-based session under the same intent after terminal 410 and absent path', async () => {
  const d = dependencies();
  await expect(retryMp4Upload(retryArgs, d)).resolves.toMatchObject({
    uploadId: UPLOAD_ID, restarted: true, nextExpectedRanges: ['0-'],
  });
  expect(d.getFileMetadataByPath).toHaveBeenCalledTimes(4);
  expect(d.markUploadRecoveryTerminal).toHaveBeenCalledWith({ uploadId: UPLOAD_ID, leaseToken: LEASE });
  expect(d.createBrowserUploadSession).toHaveBeenCalledTimes(1);
  expect(d.createBrowserUploadSession).toHaveBeenCalledWith(
    'akoya_request', '1003220/Post Site Visit Materials', FILENAME, { conflictBehavior: 'fail' },
  );
  expect(d.recordUploadRecoverySession).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: UPLOAD_ID, leaseToken: LEASE, uploadUrlCiphertext: 'sealed-new-url',
  }));
});

test('Retry does not replace an ambiguous 404 session or a partial exact-path item', async () => {
  const d = dependencies(intent(), {
    getBrowserUploadSessionStatus: jest.fn(async () => { throw missing(); }),
  });
  await expect(retryMp4Upload(retryArgs, d)).rejects.toMatchObject({
    code: 'post_presentation_upload_reconciliation_pending',
  });
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
  expect(d.markUploadRecoveryUncertain).toHaveBeenCalled();

  const partial = dependencies(intent({ upload_url_ciphertext: null }), {
    getFileMetadataByPath: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'partial', name: FILENAME, size: 20,
    })),
  });
  await expect(retryMp4Upload(retryArgs, partial)).rejects.toMatchObject({
    code: 'post_presentation_upload_reconciliation_pending',
  });
  expect(partial.createBrowserUploadSession).not.toHaveBeenCalled();
});

test('Retry from pre-URL creation failure still proves an absent path', async () => {
  const d = dependencies(intent({ upload_url_ciphertext: null, last_error: 'session_create_failed' }));
  await expect(retryMp4Upload(retryArgs, d)).resolves.toMatchObject({ restarted: true });
  expect(d.getBrowserUploadSessionStatus).not.toHaveBeenCalled();
  expect(d.getFileMetadataByPath).toHaveBeenCalledTimes(4);
});

test('Retry rejects wrong file and a nonzero fresh range without publishing the new URL', async () => {
  const d = dependencies();
  await expect(retryMp4Upload({ ...retryArgs, resumeFingerprint: 'c'.repeat(64) }, d))
    .rejects.toMatchObject({ code: 'post_presentation_resume_fingerprint_mismatch' });
  expect(d.claimUploadRecovery).not.toHaveBeenCalled();

  const badRange = dependencies(intent(), {
    createBrowserUploadSession: jest.fn(async () => ({
      uploadUrl: 'https://upload.example/new', expiresAt: '2026-09-30T13:00:00Z',
      nextExpectedRanges: ['20-'],
    })),
  });
  await expect(retryMp4Upload(retryArgs, badRange)).rejects.toMatchObject({
    code: 'post_presentation_upload_range_invalid',
  });
  expect(badRange.recordUploadRecoverySession).not.toHaveBeenCalled();
  expect(badRange.cancelBrowserUploadSession).toHaveBeenCalledWith('https://upload.example/new');
});

test('Retry readback adopts a persisted session after its database response is lost', async () => {
  const row = intent();
  const d = dependencies(row, {
    recordUploadRecoverySession: jest.fn(async () => { throw new Error('response lost'); }),
    getUploadIntent: jest.fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(intent({ state: 'initiated', upload_url_ciphertext: 'sealed-new-url' })),
  });
  await expect(retryMp4Upload(retryArgs, d)).resolves.toMatchObject({ restarted: true });
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
  expect(d.createBrowserUploadSession).toHaveBeenCalledTimes(1);
});

test('Retry retains an uncertain database commit instead of cancelling a possibly stored session', async () => {
  const row = intent();
  const d = dependencies(row, {
    recordUploadRecoverySession: jest.fn(async () => { throw new Error('database response lost'); }),
    getUploadIntent: jest.fn()
      .mockResolvedValueOnce(row)
      .mockRejectedValueOnce(new Error('readback unavailable')),
  });
  await expect(retryMp4Upload(retryArgs, d)).rejects.toThrow('database response lost');
  expect(d.cancelBrowserUploadSession).not.toHaveBeenCalled();
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_upload_retry_persistence_uncertain',
  }));
});
