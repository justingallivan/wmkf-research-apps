/** @jest-environment node */

import {
  PROOF_AUDIENCE,
  PROOF_MIN_BYTES,
  PROOF_OPERATION,
  beginPresentationMediaProofUpload,
  cleanupPresentationMediaProofUpload,
  deletePresentationMediaProofItemWithEtag,
  finalizePresentationMediaProofUpload,
  getPresentationMediaProofUploadStatus,
  resolvePresentationMediaProof,
  verifyPresentationMediaProofToken,
} from '../../lib/services/post-presentation-materials/presentation-media-proof-service';
import { GraphService } from '../../lib/services/graph-service';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PROOF_ID = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const SESSION_EXPIRY = '2026-09-22T13:00:00.000Z';
const SECRET = 'presentation-proof-test-secret-32-characters';

function mp4Signature() {
  const bytes = Buffer.alloc(32);
  bytes.write('ftyp', 4, 'ascii');
  return bytes;
}

function dependencies(overrides = {}) {
  return {
    deployment: jest.fn(() => 'preview'),
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '24-1000' })),
    getBuckets: jest.fn(async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'Requests/24-1000' }]),
    ensureFolder: jest.fn(async () => ({ siteId: 'site-1', driveId: 'drive-1' })),
    createSession: jest.fn(async () => ({
      siteId: 'site-1', driveId: 'drive-1', uploadUrl: 'https://upload.example/session-secret',
      expiresAt: SESSION_EXPIRY, nextExpectedRanges: ['0-'],
    })),
    getSessionStatus: jest.fn(async () => ({ expiresAt: SESSION_EXPIRY, nextExpectedRanges: ['10485760-'] })),
    cancelSession: jest.fn(async () => ({ outcome: 'cancelled', status: 204 })),
    getByPath: jest.fn(async () => null),
    getById: jest.fn(async () => ({ driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES })),
    readRange: jest.fn(async () => ({ bytes: mp4Signature(), malware: null })),
    resolveMedia: jest.fn(async () => ({
      driveId: 'drive-1', itemId: 'item-1', filename: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES,
      malware: null, downloadUrl: 'https://media.example/one-shot', mimeType: 'video/mp4',
    })),
    deleteFile: jest.fn(async () => undefined),
    mint: jest.fn(async () => ({ jwt: 'signed-proof' })),
    verify: jest.fn(),
    now: jest.fn(() => new Date(NOW)),
    randomUUID: jest.fn(() => PROOF_ID),
    secret: jest.fn(() => SECRET),
    ...overrides,
  };
}

async function begin(deps) {
  return beginPresentationMediaProofUpload({
    requestId: REQUEST_ID,
    profileId: 'profile-1',
    filename: 'Zoom recording.mp4',
    mimeType: 'video/mp4',
    size: PROOF_MIN_BYTES,
    lastModified: 1_790_000_000_000,
  }, deps);
}

test('production denies before any request or Graph work', async () => {
  const deps = dependencies({ deployment: jest.fn(() => 'production') });
  await expect(begin(deps)).rejects.toMatchObject({ httpStatus: 404, code: 'presentation_media_proof_not_found' });
  expect(deps.getRequest).not.toHaveBeenCalled();
  expect(deps.createSession).not.toHaveBeenCalled();
});

test('begin derives an exact disposable server path and returns an opaque staff-bound permit', async () => {
  const deps = dependencies();
  const result = await begin(deps);
  expect(deps.ensureFolder).toHaveBeenCalledWith(
    'akoya_request',
    'Requests/24-1000/Post Site Visit Materials',
  );
  expect(deps.createSession).toHaveBeenCalledWith(
    'akoya_request',
    'Requests/24-1000/Post Site Visit Materials',
    `${PROOF_ID}.mp4`,
    { conflictBehavior: 'fail', siteId: 'site-1', driveId: 'drive-1' },
  );
  expect(result.chunkBytes).toBe(320 * 1024);
  expect(result.uploadUrl).toBe('https://upload.example/session-secret');
  expect(result.permit).not.toContain('session-secret');

  await expect(getPresentationMediaProofUploadStatus({ permit: result.permit, profileId: 'profile-2' }, deps))
    .rejects.toMatchObject({ httpStatus: 403, code: 'presentation_media_proof_permit_forbidden' });
  expect(deps.getSessionStatus).not.toHaveBeenCalled();
});

test('status can resume a live session, while the cleanup permit survives session expiry', async () => {
  const deps = dependencies();
  const result = await begin(deps);
  await expect(getPresentationMediaProofUploadStatus({ permit: result.permit, profileId: 'profile-1' }, deps))
    .resolves.toMatchObject({ complete: false, uploadUrl: 'https://upload.example/session-secret', nextExpectedRanges: ['10485760-'] });

  deps.now.mockReturnValue(new Date(Date.parse(SESSION_EXPIRY) + 1));
  await expect(getPresentationMediaProofUploadStatus({ permit: result.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 410, code: 'presentation_media_proof_session_expired' });
  await expect(cleanupPresentationMediaProofUpload({ permit: result.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'session_cancelled', deletedItem: false });
  expect(deps.cancelSession).toHaveBeenCalledWith('https://upload.example/session-secret');
});

test('status recognizes only the exact full-size path item as committed', async () => {
  const committed = {
    driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES,
  };
  const deps = dependencies({ getByPath: jest.fn(async () => committed) });
  const started = await begin(deps);

  await expect(getPresentationMediaProofUploadStatus({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toMatchObject({ complete: true, canFinalize: true });
  expect(deps.getSessionStatus).not.toHaveBeenCalled();
});

test('status treats a same-path partial SharePoint placeholder as resumable while the session is live', async () => {
  const partial = {
    driveId: 'drive-1', id: 'partial-item', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024,
  };
  const deps = dependencies({ getByPath: jest.fn(async () => partial) });
  const started = await begin(deps);

  await expect(getPresentationMediaProofUploadStatus({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toMatchObject({
      complete: false,
      canFinalize: false,
      uploadUrl: 'https://upload.example/session-secret',
      nextExpectedRanges: ['10485760-'],
    });
  expect(deps.getSessionStatus).toHaveBeenCalledWith('https://upload.example/session-secret');
});

test('status never treats a partial placeholder as resumable after Microsoft reports the session gone', async () => {
  const partial = {
    driveId: 'drive-1', id: 'partial-item', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024,
  };
  const sessionError = Object.assign(new Error('gone'), { status: 404 });
  const deps = dependencies({
    getByPath: jest.fn(async () => partial),
    getSessionStatus: jest.fn(async () => { throw sessionError; }),
  });
  const started = await begin(deps);

  await expect(getPresentationMediaProofUploadStatus({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 410, code: 'presentation_media_proof_session_expired' });
});

test.each([
  ['drive', { driveId: 'other-drive', id: 'item-1', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024 }],
  ['name', { driveId: 'drive-1', id: 'item-1', name: 'other.mp4', size: 10 * 1024 * 1024 }],
  ['missing id', { driveId: 'drive-1', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024 }],
  ['negative size', { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: -1 }],
  ['oversized', { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES + 1 }],
])('status rejects a partial-path item with mismatched %s before exposing resume authority', async (_field, mismatched) => {
  const deps = dependencies({ getByPath: jest.fn(async () => mismatched) });
  const started = await begin(deps);

  await expect(getPresentationMediaProofUploadStatus({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 409, code: 'presentation_media_proof_identity_mismatch' });
  expect(deps.getSessionStatus).not.toHaveBeenCalled();
});

test('finalize validates the committed item and MP4 signature, then mints an encrypted five-minute audience token', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES };
  const deps = dependencies({ getByPath: jest.fn(async () => item) });
  const started = await begin(deps);
  const result = await finalizePresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps);
  expect(result.proofUrl).toBe('/external/presentation-media-proof/signed-proof');
  expect(deps.readRange).toHaveBeenCalledWith('drive-1', 'item-1', { start: 0, end: 31 });
  expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({
    audience: PROOF_AUDIENCE,
    ops: [PROOF_OPERATION],
    expiresAt: new Date(NOW + 5 * 60 * 1000),
  }));
  const minted = deps.mint.mock.calls[0][0];
  expect(minted.subject).not.toContain('drive-1');
  expect(minted.subject).not.toContain('item-1');

  deps.verify.mockResolvedValue({
    valid: true,
    payload: { aud: PROOF_AUDIENCE, ops: [PROOF_OPERATION], subject: minted.subject, exp: (NOW + 300_000) / 1000 },
  });
  const verified = await verifyPresentationMediaProofToken('signed-proof', deps);
  expect(verified).toMatchObject({ ok: true, claims: { driveId: 'drive-1', itemId: 'item-1' } });
  await expect(resolvePresentationMediaProof(verified, deps)).resolves.toMatchObject({ downloadUrl: 'https://media.example/one-shot' });
});

test('the same committed item can mint a new token after the first five-minute proof expires', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES };
  const deps = dependencies({ getByPath: jest.fn(async () => item) });
  const started = await begin(deps);
  await finalizePresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps);
  deps.now.mockReturnValue(new Date(NOW + 6 * 60 * 1000));
  const renewed = await finalizePresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps);
  expect(renewed.expiresAt).toBe(new Date(NOW + 11 * 60 * 1000).toISOString());
  expect(deps.getByPath).toHaveBeenCalledTimes(2);
  expect(deps.createSession).toHaveBeenCalledTimes(1);
  expect(deps.mint).toHaveBeenCalledTimes(2);
});

test('finalize rejects a committed item without an MP4 ftyp signature before token minting', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES };
  const deps = dependencies({
    getByPath: jest.fn(async () => item),
    readRange: jest.fn(async () => ({ bytes: Buffer.alloc(32), malware: null })),
  });
  const started = await begin(deps);
  await expect(finalizePresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 415, code: 'presentation_media_proof_signature_invalid' });
  expect(deps.mint).not.toHaveBeenCalled();
});

test('cleanup deletes only the stable item resolved at the exact permit path', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES, eTag: 'etag-1' };
  const deps = dependencies({ getByPath: jest.fn(async () => item) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'item_deleted', deletedItem: true });
  expect(deps.deleteFile).toHaveBeenCalledWith('drive-1', 'item-1', 'etag-1');
  expect(deps.deleteFile).toHaveBeenCalledTimes(1);
  expect(deps.getByPath).toHaveBeenCalledWith('akoya_request', 'Requests/24-1000/Post Site Visit Materials', `${PROOF_ID}.mp4`, { siteId: 'site-1', driveId: 'drive-1' });
});

test('cleanup retains its permit if the exact committed item lacks an ETag or conditional deletion fails', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES };
  const deps = dependencies({ getByPath: jest.fn(async () => item) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ code: 'presentation_media_proof_cleanup_uncertain' });
  expect(deps.deleteFile).not.toHaveBeenCalled();

  item.eTag = 'etag-1';
  deps.deleteFile.mockRejectedValueOnce(new Error('Graph 412'));
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toThrow('Graph 412');
  expect(deps.deleteFile).toHaveBeenCalledWith('drive-1', 'item-1', 'etag-1');
});

test('conditional proof deletion sends the exact item id and observed ETag to Graph', async () => {
  const getToken = jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('test-token');
  const previousFetch = global.fetch;
  const fetchMock = jest.fn(async () => ({ status: 204 }));
  global.fetch = fetchMock;
  try {
    await expect(deletePresentationMediaProofItemWithEtag('drive-1', 'item-1', 'etag-1'))
      .resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/drives/drive-1/items/item-1',
      expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer test-token', 'If-Match': 'etag-1' } }),
    );
    fetchMock.mockResolvedValueOnce({ status: 412 });
    await expect(deletePresentationMediaProofItemWithEtag('drive-1', 'item-1', 'etag-1'))
      .rejects.toMatchObject({ httpStatus: 409, code: 'presentation_media_proof_cleanup_uncertain' });
  } finally {
    global.fetch = previousFetch;
    getToken.mockRestore();
  }
});

test.each([
  ['drive', { driveId: 'other-drive', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES }],
  ['name', { driveId: 'drive-1', id: 'item-1', name: 'other.mp4', size: PROOF_MIN_BYTES }],
  ['size', { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES + 1 }],
])('cleanup never deletes an exact-path item whose stable %s mismatches the permit', async (_field, mismatched) => {
  const deps = dependencies({ getByPath: jest.fn(async () => mismatched) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 409, code: 'presentation_media_proof_identity_mismatch' });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test.each(['cancelled', 'gone', 'expired'])('cleanup deletes only an exact partial placeholder after a %s session outcome', async (outcome) => {
  const partial = { driveId: 'drive-1', id: 'partial-item', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024, eTag: 'etag-partial' };
  const deps = dependencies({
    getByPath: jest.fn(async () => partial),
    cancelSession: jest.fn(async () => ({ outcome })),
  });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'placeholder_deleted', deletedItem: true });
  expect(deps.deleteFile).toHaveBeenCalledWith('drive-1', 'partial-item', 'etag-partial');
  expect(deps.deleteFile).toHaveBeenCalledTimes(1);
});

test('uncertain session cancellation retains an exact partial placeholder and retry permit', async () => {
  const partial = { driveId: 'drive-1', id: 'partial-item', name: `${PROOF_ID}.mp4`, size: 10 * 1024 * 1024 };
  const deps = dependencies({
    getByPath: jest.fn(async () => partial),
    cancelSession: jest.fn(async () => { throw new Error('no response'); }),
  });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 502, code: 'presentation_media_proof_cleanup_uncertain' });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test('cleanup retains retry authority when Microsoft does not confirm cancellation and no item exists', async () => {
  const deps = dependencies({ cancelSession: jest.fn(async () => { throw new Error('no response'); }) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 502, code: 'presentation_media_proof_cleanup_uncertain' });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test('cleanup treats a gone session with no visible item as a terminal no-item outcome', async () => {
  const deps = dependencies({ cancelSession: jest.fn(async () => ({ outcome: 'gone', status: 404 })) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'session_gone', deletedItem: false });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test('cleanup treats an expired session with no visible item as a terminal no-item outcome', async () => {
  const deps = dependencies({ cancelSession: jest.fn(async () => ({ outcome: 'expired', status: 410 })) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'session_expired', deletedItem: false });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test('cleanup fails closed on an unknown Microsoft cancellation outcome', async () => {
  const deps = dependencies({ cancelSession: jest.fn(async () => ({ outcome: 'unexpected', status: 299 })) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 502, code: 'presentation_media_proof_cleanup_uncertain' });
  expect(deps.deleteFile).not.toHaveBeenCalled();
});

test('a cancellation error cannot block deletion of an exact committed item', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES, eTag: 'etag-1' };
  const deps = dependencies({
    cancelSession: jest.fn(async () => { throw new Error('session already closed'); }),
    getByPath: jest.fn(async () => item),
  });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, cleanupOutcome: 'item_deleted', deletedItem: true });
  expect(deps.deleteFile).toHaveBeenCalledWith('drive-1', 'item-1', 'etag-1');
});

test('tampered permits fail before any upload-session or committed-item lookup', async () => {
  const deps = dependencies();
  const started = await begin(deps);
  const tamperedBytes = Buffer.from(started.permit, 'base64url');
  tamperedBytes[tamperedBytes.length - 1] ^= 1;
  const tampered = tamperedBytes.toString('base64url');
  await expect(getPresentationMediaProofUploadStatus({ permit: tampered, profileId: 'profile-1' }, deps))
    .rejects.toMatchObject({ httpStatus: 401, code: 'presentation_media_proof_permit_invalid' });
  expect(deps.getByPath).not.toHaveBeenCalled();
  expect(deps.getSessionStatus).not.toHaveBeenCalled();
});

test('playback resolution fails closed when fresh Microsoft metadata drifts from the token identity', async () => {
  const deps = dependencies({
    resolveMedia: jest.fn(async () => ({
      driveId: 'drive-1', itemId: 'different-item', filename: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES,
      malware: null, downloadUrl: 'https://media.example/one-shot', mimeType: 'video/mp4',
    })),
  });
  const claims = {
    requestId: REQUEST_ID, driveId: 'drive-1', itemId: 'item-1', physicalFilename: `${PROOF_ID}.mp4`,
    displayName: 'Zoom recording.mp4', size: PROOF_MIN_BYTES,
  };
  await expect(resolvePresentationMediaProof({ claims }, deps))
    .rejects.toMatchObject({ httpStatus: 409, code: 'presentation_media_proof_identity_mismatch' });
});

test('wrong-audience proof tokens fail before item resolution', async () => {
  const deps = dependencies({ verify: jest.fn(async () => ({
    valid: true,
    payload: { aud: 'another-surface', ops: [PROOF_OPERATION], subject: 'opaque', exp: 123 },
  })) });
  await expect(verifyPresentationMediaProofToken('wrong', deps)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });
  expect(deps.getById).not.toHaveBeenCalled();
});
