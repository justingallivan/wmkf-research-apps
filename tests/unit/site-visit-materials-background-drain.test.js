/** @jest-environment node */
import { drainOneMaterialsUpload } from '../../lib/services/site-visit-materials/background-job-drain';
import { acquireLargeUploadAdmission, releaseLargeUploadAdmission } from '../../lib/services/large-upload-admission';

const NOW = new Date('2026-10-01T20:00:00Z');
const JOB = {
  id: 'job', staging_id: 'stage', request_id: 'request', collection_id: 'collection',
  token_digest: 'digest', slot: 'presentation_pdf', lease_token: 'lease', attempt_count: 1,
  created_at: '2026-10-01T19:00:00Z', deadline_at: '2026-10-01T21:00:00Z',
  locked_until: '2026-10-01T20:06:00Z', scan_checkpoint: null,
};
const STAGE = { id: 'stage', status: 'finalizing', pathname: 'exact/private/stage', candidate_result: null };
const COLLECTION = {
  id: 'collection', request_id: 'request', token_digest: 'digest', status: 'open',
  closes_at: '2026-10-01T22:00:00Z', checklist: [{ key: 'presentation_pdf', waived: false }],
};
const CHECKPOINT = { clean: true, sha256: 'actual-loaded-hash', policyVersion: 'policy-v1' };
const FILE = { filename: 'a.pdf', buffer: Buffer.from('%PDF-1.7'), sha256: 'actual-loaded-hash' };

function dependencies(overrides = {}) {
  return {
    schemaReady: () => true, scanEnabled: () => true,
    acquireAdmission: jest.fn(() => ({ token: 'memory-lease' })), releaseAdmission: jest.fn(),
    pruneJobs: jest.fn(async () => 0), claim: jest.fn(async () => ({ ...JOB })),
    getStage: jest.fn(async () => ({ ...STAGE })),
    getCurrentSideEffects: jest.fn(async () => ({ scan_checkpoint: null, candidate_result: null })),
    getCollection: jest.fn(async () => ({ ...COLLECTION })), assertLease: jest.fn(async () => true),
    recordScan: jest.fn(async () => true), completeJob: jest.fn(async () => ({ id: JOB.id })),
    settleJob: jest.fn(async (input) => ({ id: JOB.id, status: input.status })),
    loadFile: jest.fn(async () => FILE), completeStaging: jest.fn(async () => true),
    deleteStagedBlob: jest.fn(async () => undefined),
    finalize: jest.fn(async () => ({ slot: JOB.slot, filename: 'canonical.pdf', receivedAt: NOW.toISOString() })),
    materialFinalizeDependencies: {}, recordEvent: jest.fn(async () => undefined), now: () => NOW,
    ...overrides,
  };
}

const failure = (code) => Object.assign(new Error(code), { code });

test.each([
  ['schema_paused', { schemaReady: () => false }],
  ['scan_paused', { scanEnabled: () => false }],
  ['process_busy', { acquireAdmission: jest.fn(() => null) }],
])('%s never claims work or queries the queue', async (status, overrides) => {
  const d = dependencies(overrides);
  expect(await drainOneMaterialsUpload(d)).toEqual({ status });
  expect(d.claim).not.toHaveBeenCalled();
  expect(d.pruneJobs).not.toHaveBeenCalled();
});

test.each([false, true])('releases the real process memory guard after empty/error invocation: %s', async (throws) => {
  const d = dependencies({ acquireAdmission: acquireLargeUploadAdmission, releaseAdmission: releaseLargeUploadAdmission,
    claim: jest.fn(async () => { if (throws) throw new Error('database unavailable'); return null; }) });
  if (throws) await expect(drainOneMaterialsUpload(d)).rejects.toThrow('database unavailable');
  else expect(await drainOneMaterialsUpload(d)).toEqual({ status: 'empty' });
  const next = acquireLargeUploadAdmission();
  try { expect(next).not.toBeNull(); } finally { if (next) releaseLargeUploadAdmission(next.token); }
});

test('commits the durable staging receipt before completing the job and passes owned identity to every write', async () => {
  const d = dependencies();
  expect(await drainOneMaterialsUpload(d)).toEqual({ status: 'completed', jobId: JOB.id });
  expect(d.loadFile).toHaveBeenCalledWith({ row: STAGE, leaseToken: JOB.lease_token, backgroundJobId: JOB.id });
  expect(d.finalize).toHaveBeenCalledWith(expect.objectContaining({ backgroundJob: {
    jobId: JOB.id, leaseToken: JOB.lease_token, lockedUntil: JOB.locked_until, scanCheckpoint: null,
  } }), expect.objectContaining({ assertBackgroundJobLease: expect.any(Function), recordBackgroundScan: expect.any(Function) }));
  expect(d.completeStaging).toHaveBeenCalledWith(expect.objectContaining({ backgroundJobId: JOB.id, stagingId: JOB.staging_id, leaseToken: JOB.lease_token }));
  expect(d.completeStaging.mock.invocationCallOrder[0]).toBeLessThan(d.completeJob.mock.invocationCallOrder[0]);
  expect(d.releaseAdmission).toHaveBeenCalledWith('memory-lease');
});

test('consumed receipt recovers after a crash without downloading or rescanning deleted bytes', async () => {
  const receipt = { ok: true, filename: 'previously-saved.pdf' };
  const d = dependencies({ getStage: jest.fn(async () => ({ ...STAGE, status: 'consumed', result_payload: receipt })) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'completed', replayed: true });
  expect(d.completeJob).toHaveBeenCalledWith({ jobId: JOB.id, leaseToken: JOB.lease_token, resultPayload: receipt });
  expect(d.loadFile).not.toHaveBeenCalled();
  expect(d.finalize).not.toHaveBeenCalled();
});

test('natural collection closure after admission does not abandon acknowledged work', async () => {
  const d = dependencies({ getCollection: jest.fn(async () => ({ ...COLLECTION, status: 'closed', closes_at: '2026-10-01T19:30:00Z' })) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'completed' });
  expect(d.finalize).toHaveBeenCalled();
});

test.each([
  { token_digest: 'rotated' },
  { checklist: [{ key: JOB.slot, waived: true }] },
])('binding/slot changes stop processing before loading bytes: %j', async (change) => {
  const d = dependencies({ getCollection: jest.fn(async () => ({ ...COLLECTION, ...change })) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'cancelled' });
  expect(d.loadFile).not.toHaveBeenCalled();
  expect(d.settleJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', clearStageOwner: true }));
});

test('an expired job with no external work fails safely without loading bytes', async () => {
  const d = dependencies({ claim: jest.fn(async () => ({ ...JOB, deadline_at: '2026-10-01T19:59:00Z' })) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'failed', errorCode: 'processing_deadline' });
  expect(d.loadFile).not.toHaveBeenCalled();
  expect(d.settleJob).toHaveBeenCalledWith(expect.objectContaining({ clearStageOwner: true, rejectStage: true }));
});

test.each([
  { scan_checkpoint: CHECKPOINT, candidate_result: null },
  { scan_checkpoint: null, candidate_result: { driveId: 'drive', itemId: 'new-item' } },
])('terminal errors reread newly persisted side effects instead of releasing the slot: %j', async (persisted) => {
  const d = dependencies({ claim: jest.fn(async () => ({ ...JOB, attempt_count: 8 })),
    finalize: jest.fn(async () => { throw new Error('Graph response lost'); }),
    getCurrentSideEffects: jest.fn(async () => persisted) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'needs_attention' });
  expect(d.getCurrentSideEffects).toHaveBeenCalledWith({ jobId: JOB.id, leaseToken: JOB.lease_token });
  expect(d.settleJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_attention' }));
  expect(d.settleJob.mock.calls[0][0].clearStageOwner).not.toBe(true);
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'site_visit_material_upload_needs_attention' }));
});

test('side-effect lookup outage never clears job ownership', async () => {
  const d = dependencies({ claim: jest.fn(async () => ({ ...JOB, attempt_count: 8 })),
    finalize: jest.fn(async () => { throw new Error('unknown provider result'); }),
    getCurrentSideEffects: jest.fn(async () => { throw new Error('database unavailable'); }) });
  await expect(drainOneMaterialsUpload(d)).rejects.toThrow('database unavailable');
  expect(d.settleJob).not.toHaveBeenCalled();
  expect(d.releaseAdmission).toHaveBeenCalledWith('memory-lease');
});

test('transient byte storage failure remains queued and succeeds on a later attempt', async () => {
  const d = dependencies();
  d.loadFile.mockRejectedValueOnce(failure('staging_unavailable'));
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'queued', retryAt: '2026-10-01T20:00:30.000Z' });
  expect(d.settleJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
  expect(d.deleteStagedBlob).not.toHaveBeenCalled();
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'completed' });
});

test('lease loss at publication leaves successor-owned state untouched', async () => {
  const d = dependencies({ assertLease: jest.fn(async () => false) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'lease_lost' });
  expect(d.completeStaging).not.toHaveBeenCalled();
  expect(d.completeJob).not.toHaveBeenCalled();
  expect(d.settleJob).not.toHaveBeenCalled();
});

test('the finalizer fence rechecks current collection authority, not only its original snapshot', async () => {
  const d = dependencies();
  d.getCollection.mockResolvedValueOnce(COLLECTION).mockResolvedValue({ ...COLLECTION, token_digest: 'rotated' });
  d.finalize.mockImplementation(async (_args, finalizerDependencies) => {
    expect(await finalizerDependencies.assertBackgroundJobLease({ jobId: JOB.id, leaseToken: JOB.lease_token })).toBe(false);
    throw failure('background_lease_lost');
  });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'lease_lost' });
  expect(d.completeStaging).not.toHaveBeenCalled();
});

test.each([false, true])('infected bytes are deleted immediately; prior candidate holds attention: %s', async (hasPriorCandidate) => {
  const d = dependencies({ finalize: jest.fn(async () => { throw failure('scan_infected'); }),
    getCurrentSideEffects: jest.fn(async () => ({ scan_checkpoint: null, candidate_result: hasPriorCandidate ? { driveId: 'drive', itemId: 'candidate' } : null })) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: hasPriorCandidate ? 'needs_attention' : 'failed' });
  expect(d.deleteStagedBlob).toHaveBeenCalledWith(STAGE.pathname);
  if (hasPriorCandidate) expect(d.settleJob.mock.calls[0][0].clearStageOwner).not.toBe(true);
});

test('unreadable owned staging records attention without loading or publishing', async () => {
  const d = dependencies({ getStage: jest.fn(async () => null) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'needs_attention' });
  expect(d.loadFile).not.toHaveBeenCalled();
  expect(d.finalize).not.toHaveBeenCalled();
  expect(d.recordEvent).toHaveBeenCalled();
});

test('an infected verdict after lease takeover cannot delete the successor-owned Blob', async () => {
  const d = dependencies({ finalize: jest.fn(async () => { throw failure('scan_infected'); }),
    getCurrentSideEffects: jest.fn(async () => null) });
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'lease_lost' });
  expect(d.settleJob).not.toHaveBeenCalled();
  expect(d.deleteStagedBlob).not.toHaveBeenCalled();
});


test.each(['staging', 'job'])('a %s completion outage after the durable receipt remains recoverable without attention or another upload', async (failurePoint) => {
  const d = dependencies();
  d.completeStaging.mockImplementation(async () => {
    d.getStage.mockResolvedValue({ ...STAGE, status: 'consumed', result_payload: { ok: true, filename: 'canonical.pdf' } });
    d.getCurrentSideEffects.mockResolvedValue({ scan_checkpoint: CHECKPOINT, candidate_result: {}, staging_status: 'consumed' });
    if (failurePoint === 'staging') throw new Error('staging commit response lost');
  });
  if (failurePoint === 'job') d.completeJob.mockRejectedValueOnce(new Error('completion database outage'));
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'completion_recovery_pending' });
  expect(d.settleJob).not.toHaveBeenCalled();
  expect(d.recordEvent).not.toHaveBeenCalled();
  // Once its expired lease is claimed again, the existing consumed replay path
  // finishes the acknowledgement with no second byte load/provider operation.
  expect(await drainOneMaterialsUpload(d)).toMatchObject({ status: 'completed', replayed: true });
  expect(d.loadFile).toHaveBeenCalledTimes(1);
  expect(d.finalize).toHaveBeenCalledTimes(1);
});
