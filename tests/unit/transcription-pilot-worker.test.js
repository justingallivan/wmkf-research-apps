jest.mock('../../lib/services/transcription-pilot/store', () => ({
  beginTranscriptionProviderSubmission: jest.fn(),
  bindVerifiedTranscriptionProviderId: jest.fn(),
  claimNextCleanupTranscriptionJob: jest.fn(),
  claimNextDueTranscriptionJob: jest.fn(),
  claimNextExpiredContentTranscriptionJob: jest.fn(),
  claimNextTranscriptionJob: jest.fn(),
  finishTranscriptionLocalCleanup: jest.fn(),
  getLeasedTranscriptionJob: jest.fn(),
  markExpiredTranscriptionSubmissionsUncertain: jest.fn(),
  markTranscriptionAudioDeleted: jest.fn(),
  markTranscriptionProviderDeletionCompleted: jest.fn(),
  mutateLeasedTranscriptionJob: jest.fn(),
  publishReadyTranscriptionJob: jest.fn(),
  requeueExpiredPreIntentTranscriptionSubmissions: jest.fn(),
  releaseTranscriptionLease: jest.fn(),
  setTranscriptionProviderUploadReference: jest.fn(),
  expireTranscriptionContent: jest.fn(),
  purgeExpiredTranscriptionReceipt: jest.fn(),
}));

jest.mock('../../lib/services/transcription-pilot/runtime', () => ({
  callbackAuth: jest.fn(() => 'b'.repeat(64)),
  deletePrivatePath: jest.fn(),
  encryptedProviderReference: jest.fn(async () => 'encrypted-ref'),
  inspectOwnerInput: jest.fn(async () => ({ buffer: Buffer.from('audio'), blob: { pathname: 'transcription-pilot/9/11111111-1111-4111-8111-111111111111/input/audio.mp3' } })),
  providerReference: jest.fn(async () => 'https://cdn.assemblyai.com/upload/ref'),
  readPrivateContentIfPresent: jest.fn(async () => null),
  writePrivateContent: jest.fn(),
}));

jest.mock('../../lib/services/transcription-pilot/provider', () => ({
  deleteAssemblyAITranscript: jest.fn(),
  getAssemblyAITranscript: jest.fn(),
  submitAssemblyAITranscription: jest.fn(),
  uploadAssemblyAIAudio: jest.fn(async () => 'https://cdn.assemblyai.com/upload/ref'),
}));

import * as store from '../../lib/services/transcription-pilot/store';
import * as runtime from '../../lib/services/transcription-pilot/runtime';
import { submitAssemblyAITranscription } from '../../lib/services/transcription-pilot/provider';
import { uploadAssemblyAIAudio } from '../../lib/services/transcription-pilot/provider';
import { getAssemblyAITranscript, deleteAssemblyAITranscript } from '../../lib/services/transcription-pilot/provider';
import { drainTranscriptionPilot } from '../../lib/services/transcription-pilot/worker';

const queued = {
  id: '11111111-1111-4111-8111-111111111111', owner_profile_id: 9,
  status: 'submitting', version: 1, lease_token: '22222222-2222-4222-8222-222222222222',
  lease_expires_at: new Date(Date.now() + 300_000), provider_region: 'us',
  verified_bytes: 5, audio_pathname: 'transcription-pilot/9/11111111-1111-4111-8111-111111111111/input/audio.mp3',
  audio_sha256: 'a'.repeat(64), audio_etag: 'etag', verified_content_type: 'audio/mpeg',
  requested_model: 'universal-2', cleanup_requested_at: null,
};

describe('transcription worker submission safety', () => {
  const prior = {};
  beforeEach(() => {
    for (const key of ['TRANSCRIPTION_PILOT_ENABLED', 'TRANSCRIPTION_SUBMISSIONS_ENABLED', 'NEXTAUTH_URL']) prior[key] = process.env[key];
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'true';
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'true';
    process.env.NEXTAUTH_URL = 'https://admin.example.test';
    jest.resetAllMocks();
    runtime.inspectOwnerInput.mockResolvedValue({ buffer: Buffer.from('audio'), blob: { pathname: queued.audio_pathname } });
    runtime.encryptedProviderReference.mockResolvedValue('encrypted-ref');
    runtime.providerReference.mockResolvedValue('https://cdn.assemblyai.com/upload/ref');
    runtime.callbackAuth.mockReturnValue('b'.repeat(64));
    uploadAssemblyAIAudio.mockResolvedValue('https://cdn.assemblyai.com/upload/ref');
    store.requeueExpiredPreIntentTranscriptionSubmissions.mockResolvedValue([]);
    store.markExpiredTranscriptionSubmissionsUncertain.mockResolvedValue([]);
    store.claimNextTranscriptionJob.mockResolvedValueOnce(queued).mockResolvedValue(null);
    store.setTranscriptionProviderUploadReference.mockImplementation(async () => ({ ...queued, version: 2, provider_upload_ref_ciphertext: 'encrypted-ref' }));
    store.beginTranscriptionProviderSubmission.mockImplementation(async () => ({
      ...queued, version: 3, provider_upload_ref_ciphertext: 'encrypted-ref',
      submission_intent_at: new Date(), attempt_correlation_id: '33333333-3333-4333-8333-333333333333',
    }));
    store.getLeasedTranscriptionJob.mockImplementation(async () => ({
      ...queued, version: 3, provider_upload_ref_ciphertext: 'encrypted-ref',
      submission_intent_at: new Date(), attempt_correlation_id: '33333333-3333-4333-8333-333333333333',
    }));
    store.mutateLeasedTranscriptionJob.mockResolvedValue({ ...queued, version: 4, status: 'submission_uncertain' });
    store.releaseTranscriptionLease.mockResolvedValue({});
    store.claimNextDueTranscriptionJob.mockResolvedValueOnce({ job: { ...queued, status: 'submission_uncertain', provider_transcript_id: null, callback_candidate_transcript_id: null }, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValue(null);
    submitAssemblyAITranscription.mockRejectedValue(new Error('network response lost after request write'));
  });
  afterEach(() => {
    for (const key of Object.keys(prior)) {
      if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
    }
  });

  it('records uncertain acceptance after an ambiguous POST and never automatically resubmits it', async () => {
    await drainTranscriptionPilot({ maxJobs: 2 });
    await drainTranscriptionPilot({ maxJobs: 2 });
    expect(store.claimNextTranscriptionJob).toHaveBeenCalled();
    expect(runtime.inspectOwnerInput).toHaveBeenCalled();
    expect(uploadAssemblyAIAudio).toHaveBeenCalled();
    expect(submitAssemblyAITranscription).toHaveBeenCalledTimes(1);
    expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.objectContaining({ status: 'submission_uncertain' }), expectedStatuses: ['submitting'],
    }));
  });

  it('keeps recovery/cleanup worker entry active but does not claim queued work when switches are off', async () => {
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'false';
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'false';
    await drainTranscriptionPilot({ maxJobs: 1 });
    expect(store.requeueExpiredPreIntentTranscriptionSubmissions).toHaveBeenCalled();
    expect(store.markExpiredTranscriptionSubmissionsUncertain).toHaveBeenCalled();
    expect(store.claimNextTranscriptionJob).not.toHaveBeenCalled();
  });

  it('saves a completed result and publishes a ready job', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const processing = { ...queued, status: 'processing', provider_transcript_id: 'provider-1', version: 7 };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: processing, leaseToken: queued.lease_token }).mockResolvedValue(null);
    const saving = { ...processing, status: 'saving', version: 8,
      output_pathname: `transcription-pilot/9/${processing.id}/output/transcript.json` };
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(processing).mockResolvedValueOnce(processing).mockResolvedValueOnce(saving);
    store.mutateLeasedTranscriptionJob.mockResolvedValue(saving);
    const bytes = Buffer.from('{"text":"hello","utterances":[{"start":0,"end":500,"text":"hello","speaker":null}],"outcome":"complete"}');
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({ buffer: bytes });
    runtime.writePrivateContent.mockResolvedValue({
      pathname: `transcription-pilot/9/${processing.id}/output/transcript.json`, size: Buffer.byteLength('{"text":"hello","utterances":[{"start":0,"end":500,"text":"hello","speaker":null}],"outcome":"complete"}'),
    });
    store.publishReadyTranscriptionJob.mockResolvedValue({ ...processing, status: 'ready', version: 9,
      provider_transcript_id: null, audio_pathname: null });
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello',
      utterances: [{ start: 0, end: 500, text: 'hello', speaker: null }], speech_model_used: 'universal-2' });

    const summary = await drainTranscriptionPilot({ maxJobs: 1 });
    expect(runtime.readPrivateContentIfPresent).toHaveBeenCalled();
    expect(runtime.writePrivateContent).toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: processing.id, outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/), returnedModel: 'universal-2',
    }));
    expect(summary.ready).toBe(1);
  });

  it('moves a late bound-ID conflict to operator-recoverable uncertain state', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'processing', provider_transcript_id: 'known-id', provider_id_conflict: true };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(job);
    await drainTranscriptionPilot({ maxJobs: 1 });
    expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({ fields: { status: 'submission_uncertain' }, expectedStatuses: ['processing', 'saving'] }));
    expect(getAssemblyAITranscript).not.toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
  });

  it('continues exact remote deletion when receipt expired and local cleanup already completed', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'failed', audio_pathname: null, provider_transcript_id: 'pending-id',
      cleanup_requested_at: new Date(), local_cleanup_completed_at: new Date(), content_purged_at: new Date(),
      receipt_expires_at: new Date(Date.now() - 1), expires_at: new Date(Date.now() - 1) };
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(job);
    deleteAssemblyAITranscript.mockResolvedValue(true);
    store.markTranscriptionProviderDeletionCompleted.mockResolvedValue({ ...job, provider_cleanup_completed_at: new Date() });
    store.finishTranscriptionLocalCleanup.mockResolvedValue(job);
    store.purgeExpiredTranscriptionReceipt.mockResolvedValue({ ...job, receipt_purged_at: new Date() });
    await drainTranscriptionPilot({ maxJobs: 1 });
    expect(deleteAssemblyAITranscript).toHaveBeenCalledWith(expect.objectContaining({ transcriptId: 'pending-id', region: 'us' }));
    expect(store.purgeExpiredTranscriptionReceipt).toHaveBeenCalled();
    expect(deleteAssemblyAITranscript.mock.invocationCallOrder[0]).toBeLessThan(store.purgeExpiredTranscriptionReceipt.mock.invocationCallOrder[0]);
  });

  it('never publishes when Blob readback differs from the result bytes', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'saving', provider_transcript_id: 'known-id', output_pathname: 'transcription-pilot/output.json' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(job);
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello' });
    const bytes = Buffer.from('{"text":"hello","utterances":[],"outcome":"complete"}');
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({ buffer: Buffer.from('corrupt') });
    runtime.writePrivateContent.mockResolvedValue({ pathname: job.output_pathname, size: bytes.length });
    await drainTranscriptionPilot({ maxJobs: 1 });
    expect(runtime.writePrivateContent).toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
  });

  it('retains uncertainty and conflict evidence when DELETE follows a bound-ID conflict', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'processing', provider_transcript_id: 'known-id', provider_id_conflict: true,
      conflicting_transcript_id: 'other-id', cleanup_requested_at: new Date(),
      provider_upload_ref_ciphertext: 'encrypted-ref', expires_at: new Date(Date.now() + 60000) };
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
    const uncertain = { ...job, status: 'submission_uncertain', version: 2 };
    store.mutateLeasedTranscriptionJob.mockResolvedValue(uncertain);
    store.getLeasedTranscriptionJob.mockResolvedValue(uncertain);
    await drainTranscriptionPilot({ maxJobs: 1 });
    expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({ fields: { status: 'submission_uncertain' } }));
    expect(deleteAssemblyAITranscript).not.toHaveBeenCalled();
    expect(store.markTranscriptionProviderDeletionCompleted).not.toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
  });
});
