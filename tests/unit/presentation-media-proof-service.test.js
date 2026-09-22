/** @jest-environment node */

import {
  PROOF_AUDIENCE,
  PROOF_MIN_BYTES,
  PROOF_OPERATION,
  beginPresentationMediaProofUpload,
  cleanupPresentationMediaProofUpload,
  finalizePresentationMediaProofUpload,
  getPresentationMediaProofUploadStatus,
  resolvePresentationMediaProof,
  verifyPresentationMediaProofToken,
} from '../../lib/services/post-presentation-materials/presentation-media-proof-service';

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
    cancelSession: jest.fn(async () => undefined),
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
    `Requests/24-1000/Artifacts/Presentation Media Proof/${PROOF_ID}`,
  );
  expect(deps.createSession).toHaveBeenCalledWith(
    'akoya_request',
    `Requests/24-1000/Artifacts/Presentation Media Proof/${PROOF_ID}`,
    `${PROOF_ID}.mp4`,
    { conflictBehavior: 'fail', siteId: 'site-1', driveId: 'drive-1' },
  );
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
    .resolves.toEqual({ cleaned: true, deletedItem: false });
  expect(deps.cancelSession).toHaveBeenCalledWith('https://upload.example/session-secret');
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

test('cleanup deletes only the stable item resolved at the exact permit path', async () => {
  const item = { driveId: 'drive-1', id: 'item-1', name: `${PROOF_ID}.mp4`, size: PROOF_MIN_BYTES };
  const deps = dependencies({ getByPath: jest.fn(async () => item) });
  const started = await begin(deps);
  await expect(cleanupPresentationMediaProofUpload({ permit: started.permit, profileId: 'profile-1' }, deps))
    .resolves.toEqual({ cleaned: true, deletedItem: true });
  expect(deps.deleteFile).toHaveBeenCalledWith('drive-1', 'item-1');
  expect(deps.deleteFile).toHaveBeenCalledTimes(1);
});

test('wrong-audience proof tokens fail before item resolution', async () => {
  const deps = dependencies({ verify: jest.fn(async () => ({
    valid: true,
    payload: { aud: 'another-surface', ops: [PROOF_OPERATION], subject: 'opaque', exp: 123 },
  })) });
  await expect(verifyPresentationMediaProofToken('wrong', deps)).resolves.toEqual({ ok: false, reason: 'invalid_claim' });
  expect(deps.getById).not.toHaveBeenCalled();
});
