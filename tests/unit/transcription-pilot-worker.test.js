import crypto from 'node:crypto';

jest.mock('../../lib/services/transcription-pilot/store', () => ({
  beginTranscriptionProviderSubmission: jest.fn(),
  bindVerifiedTranscriptionProviderId: jest.fn(),
  claimNextCleanupTranscriptionJob: jest.fn(),
  claimNextDueTranscriptionJob: jest.fn(),
  claimNextExpiredContentTranscriptionJob: jest.fn(),
  claimNextTranscriptionJob: jest.fn(),
  claimTranscriptionJob: jest.fn(),
  claimTranscriptionCleanup: jest.fn(),
  getTranscriptionJob: jest.fn(),
  finishTranscriptionLocalCleanup: jest.fn(),
  getLeasedTranscriptionJob: jest.fn(),
  markExpiredTranscriptionSubmissionsUncertain: jest.fn(),
  markTranscriptionAudioDeleted: jest.fn(),
  markTranscriptionProviderDeletionCompleted: jest.fn(),
  mutateLeasedTranscriptionJob: jest.fn(),
  publishReadyTranscriptionJob: jest.fn(),
  releaseReadyTranscriptionCleanupLease: jest.fn(),
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
import { advanceTranscriptionPilotJob, drainTranscriptionCleanup, drainTranscriptionPilot } from '../../lib/services/transcription-pilot/worker';

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
    store.releaseReadyTranscriptionCleanupLease.mockResolvedValue({});
    store.claimNextDueTranscriptionJob.mockResolvedValueOnce({ job: { ...queued, status: 'submission_uncertain', provider_transcript_id: null, callback_candidate_transcript_id: null }, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValue(null);
    store.claimTranscriptionJob.mockResolvedValue(null);
    store.claimTranscriptionCleanup.mockResolvedValue(null);
    store.getTranscriptionJob.mockResolvedValue(null);
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
    expect(submitAssemblyAITranscription).toHaveBeenCalledWith(expect.objectContaining({ model: 'universal-2' }));
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
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(processing).mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(saving).mockResolvedValueOnce({ ...processing, status: 'ready', version: 10 })
      .mockResolvedValueOnce({ ...processing, status: 'ready', version: 10 });
    store.mutateLeasedTranscriptionJob.mockResolvedValue(saving);
    const bytes = Buffer.from('{"text":"hello","utterances":[{"start":0,"end":500,"text":"hello","speaker":null}],"outcome":"complete"}');
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({ buffer: bytes, blob: {
      size: 0, pathname: `transcription-pilot/9/${processing.id}/output/transcript.json`,
    } });
    runtime.writePrivateContent.mockResolvedValue({
      pathname: `transcription-pilot/9/${processing.id}/output/transcript.json`,
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
    expect(store.releaseReadyTranscriptionCleanupLease).toHaveBeenCalledWith({
      jobId: processing.id, leaseToken: queued.lease_token, expectedVersion: 10,
    });
  });

  it('saves a completed result whose single utterance exceeds the former 20,000-character cap', async () => {
    // Regression (2026-10-08): a 24,213-character presentation utterance was rejected with an uncoded
    // error, and the job retried in 'saving' indefinitely while holding the global transcription slot.
    const long = 'x'.repeat(24_213);
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const processing = { ...queued, status: 'processing', provider_transcript_id: 'provider-1', version: 7 };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: processing, leaseToken: queued.lease_token }).mockResolvedValue(null);
    const saving = { ...processing, status: 'saving', version: 8,
      output_pathname: `transcription-pilot/9/${processing.id}/output/transcript.json` };
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(processing).mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(saving).mockResolvedValueOnce({ ...processing, status: 'ready', version: 10 })
      .mockResolvedValueOnce({ ...processing, status: 'ready', version: 10 });
    store.mutateLeasedTranscriptionJob.mockResolvedValue(saving);
    const bytes = Buffer.from(JSON.stringify({ text: long, utterances: [{ start: 0, end: 500, text: long, speaker: null }], outcome: 'complete' }));
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({ buffer: bytes, blob: {
      size: 0, pathname: `transcription-pilot/9/${processing.id}/output/transcript.json`,
    } });
    runtime.writePrivateContent.mockResolvedValue({
      pathname: `transcription-pilot/9/${processing.id}/output/transcript.json`,
    });
    store.publishReadyTranscriptionJob.mockResolvedValue({ ...processing, status: 'ready', version: 9,
      provider_transcript_id: null, audio_pathname: null });
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: long,
      utterances: [{ start: 0, end: 500, text: long, speaker: null }], speech_model_used: 'universal-2' });

    const summary = await drainTranscriptionPilot({ maxJobs: 1 });
    expect(runtime.writePrivateContent).toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).toHaveBeenCalled();
    expect(summary.ready).toBe(1);
  });

  it('releases a ready worker lease even when provider or Blob cleanup fails', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const processing = { ...queued, status: 'processing', provider_transcript_id: 'provider-1', version: 7 };
    const saving = { ...processing, status: 'saving', version: 8,
      output_pathname: `transcription-pilot/9/${processing.id}/output/transcript.json` };
    const ready = { ...saving, status: 'ready', version: 9, audio_pathname: 'input/audio.mp3' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: processing, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(processing).mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(saving).mockResolvedValueOnce({ ...ready, version: 10 });
    const bytes = Buffer.from('{"text":"hello","utterances":[],"outcome":"complete"}');
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({ buffer: bytes,
      blob: { pathname: saving.output_pathname } });
    runtime.writePrivateContent.mockResolvedValue({ pathname: saving.output_pathname });
    store.publishReadyTranscriptionJob.mockResolvedValue(ready);
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello', utterances: [] });
    deleteAssemblyAITranscript.mockRejectedValue(new Error('provider cleanup unavailable'));
    runtime.deletePrivatePath.mockRejectedValue(new Error('Blob cleanup unavailable'));

    const summary = await drainTranscriptionPilot({ maxJobs: 1 });

    expect(summary.ready).toBe(1);
    expect(store.publishReadyTranscriptionJob).toHaveBeenCalled();
    expect(store.releaseReadyTranscriptionCleanupLease).toHaveBeenCalledWith({
      jobId: processing.id, leaseToken: queued.lease_token, expectedVersion: 10,
    });
  });

  it('recovers a saving job from an existing readback whose SDK metadata size is zero', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const saving = { ...queued, status: 'saving', provider_transcript_id: 'provider-1', version: 8,
      output_pathname: 'transcription-pilot/9/11111111-1111-4111-8111-111111111111/output/transcript.json' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: saving, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(saving);
    const bytes = Buffer.from('{"text":"hello","utterances":[],"outcome":"complete"}');
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce({ buffer: bytes, blob: { size: 0, pathname: saving.output_pathname } });
    store.publishReadyTranscriptionJob.mockResolvedValue({ ...saving, status: 'ready', version: 9,
      provider_transcript_id: null, audio_pathname: null });
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello', utterances: [] });

    const summary = await drainTranscriptionPilot({ maxJobs: 1 });

    expect(store.publishReadyTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: saving.id }));
    expect(runtime.writePrivateContent).not.toHaveBeenCalled();
    expect(uploadAssemblyAIAudio).not.toHaveBeenCalled();
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
    expect(summary.ready).toBe(1);
  });

  it('reuses an exact pre-timing transcript Blob during a retry without replacing its bytes', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const saving = { ...queued, status: 'saving', provider_transcript_id: 'provider-1', version: 8,
      output_pathname: 'transcription-pilot/9/11111111-1111-4111-8111-111111111111/output/transcript.json' };
    const processing = { ...saving, status: 'processing', output_pathname: null };
    const legacyBytes = Buffer.from(JSON.stringify({ text: 'hello', utterances: [
      { start: 0, end: 1000, text: 'hello', speaker: 'A' },
    ], outcome: 'complete' }));
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: saving, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(saving).mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(saving).mockResolvedValueOnce({ ...saving, status: 'ready', version: 10 });
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce({ buffer: legacyBytes, blob: { pathname: saving.output_pathname } });
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello', utterances: [
      { start: 0, end: 1000, text: 'hello', speaker: 'A', words: [{ start: 0, end: 900, text: 'hello' }] },
    ] });
    store.publishReadyTranscriptionJob.mockResolvedValue({ ...saving, status: 'ready', version: 9,
      provider_transcript_id: null, audio_pathname: null });

    await drainTranscriptionPilot({ maxJobs: 1 });

    expect(runtime.writePrivateContent).not.toHaveBeenCalled();
    expect(store.publishReadyTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
      outputSha256: expect.any(String),
    }));
    expect(store.publishReadyTranscriptionJob.mock.calls[0][0].outputSha256)
      .toBe(crypto.createHash('sha256').update(legacyBytes).digest('hex'));
  });

  it('drops optional provider timings when they alone exceed the saved-output cap', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const processing = { ...queued, status: 'processing', provider_transcript_id: 'provider-1', version: 7 };
    const saving = { ...processing, status: 'saving', version: 8,
      output_pathname: 'transcription-pilot/9/11111111-1111-4111-8111-111111111111/output/transcript.json' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job: processing, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValueOnce(processing).mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(saving).mockResolvedValueOnce({ ...saving, status: 'ready', version: 10 });
    let written;
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
      buffer: written, blob: { pathname: saving.output_pathname },
    }));
    runtime.writePrivateContent.mockImplementation(async (pathname, _type, bytes) => {
      written = Buffer.from(bytes);
      return { pathname };
    });
    store.publishReadyTranscriptionJob.mockResolvedValue({ ...saving, status: 'ready', version: 9,
      provider_transcript_id: null, audio_pathname: null });
    const text = `${'word '.repeat(999)}word`;
    const words = Array.from({ length: 1000 }, (_, index) => ({ start: index * 10, end: index * 10 + 1, text: 'word' }));
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: '', utterances: Array.from({ length: 120 }, () => ({
      start: 0, end: 10_000, text, speaker: 'A', words,
    })) });

    await drainTranscriptionPilot({ maxJobs: 1 });

    const saved = JSON.parse(written.toString());
    expect(written.length).toBeLessThanOrEqual(4_000_000);
    expect(saved.utterances.every(utterance => utterance.words === undefined)).toBe(true);
    expect(saved.utterances[0].text).toBe(text);
    expect(store.publishReadyTranscriptionJob).toHaveBeenCalled();
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

  it('rejects a write result for a different pathname and schedules a saving retry', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'saving', provider_transcript_id: 'known-id', output_pathname: 'transcription-pilot/output.json' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(job);
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello' });
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null).mockResolvedValueOnce({
      buffer: Buffer.from('{"text":"hello","utterances":[],"outcome":"complete"}'),
    });
    runtime.writePrivateContent.mockResolvedValue({ pathname: 'transcription-pilot/output-other.json' });
    store.mutateLeasedTranscriptionJob.mockResolvedValue({ ...job, version: job.version + 1 });

    await drainTranscriptionPilot({ maxJobs: 1 });

    expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
    expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatuses: ['saving'], fields: expect.objectContaining({ next_attempt_at: expect.any(Date) }),
    }));
    expect(store.releaseTranscriptionLease).toHaveBeenCalledWith(expect.objectContaining({ expectedStatuses: ['saving'] }));
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
  });

  it('catches async write failures and releases the saving lease for retry without resubmitting', async () => {
    store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
    const job = { ...queued, status: 'saving', provider_transcript_id: 'known-id', output_pathname: 'transcription-pilot/output.json' };
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(job);
    getAssemblyAITranscript.mockResolvedValue({ status: 'completed', text: 'hello' });
    runtime.readPrivateContentIfPresent.mockResolvedValueOnce(null);
    runtime.writePrivateContent.mockRejectedValue(new Error('storage write failed'));
    store.mutateLeasedTranscriptionJob.mockResolvedValue({ ...job, version: job.version + 1 });

    await drainTranscriptionPilot({ maxJobs: 1 });

    expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatuses: ['saving'], fields: expect.objectContaining({ next_attempt_at: expect.any(Date) }),
    }));
    expect(store.releaseTranscriptionLease).toHaveBeenCalledWith(expect.objectContaining({ expectedStatuses: ['saving'] }));
    expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
    expect(uploadAssemblyAIAudio).not.toHaveBeenCalled();
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
  });

  describe('save validation failures', () => {
    const setup = (providerResult) => {
      store.claimNextTranscriptionJob.mockReset().mockResolvedValue(null);
      const job = { ...queued, status: 'saving', provider_transcript_id: 'known-id', output_pathname: 'transcription-pilot/output.json' };
      store.claimNextDueTranscriptionJob.mockReset().mockResolvedValueOnce({ job, leaseToken: job.lease_token }).mockResolvedValue(null);
      store.getLeasedTranscriptionJob.mockResolvedValue(job);
      if (providerResult instanceof Error) getAssemblyAITranscript.mockRejectedValue(providerResult);
      else getAssemblyAITranscript.mockResolvedValue(providerResult);
      store.mutateLeasedTranscriptionJob.mockResolvedValue({ ...job, version: job.version + 1 });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      return job;
    };
    const utt = (over = {}) => ({ start: 0, end: 5, text: 'hi', speaker: 'A', ...over });
    const rescheduled = () => expect.objectContaining({ fields: expect.objectContaining({ next_attempt_at: expect.any(Date) }) });
    const failedWith = (code) => expect.objectContaining({
      fields: expect.objectContaining({ status: 'failed', sanitized_error_code: code, cleanup_requested_at: expect.any(Date) }),
    });
    it.each([
      ['provider_invalid_utterances', { status: 'completed', text: 'x', utterances: 'bad' }],
      ['provider_invalid_utterance', { status: 'completed', text: 'x', utterances: [utt({ end: -1 })] }],
      ['provider_invalid_speaker_label', { status: 'completed', text: 'x', utterances: [utt({ speaker: 'bad label!' })] }],
      ['provider_output_too_large', { status: 'completed', text: 'x'.repeat(12 * 1024 * 1024 + 1) }],
      ['provider_output_too_large', { status: 'completed', text: 'x', utterances: Array.from({ length: 200_001 }, () => utt()) }],
    ])('fails the job terminally with %s and does not reschedule', async (code, result) => {
      const job = setup(result);
      await drainTranscriptionPilot({ maxJobs: 1 });
      expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(failedWith(code));
      expect(store.mutateLeasedTranscriptionJob).not.toHaveBeenCalledWith(rescheduled());
      expect(console.error).toHaveBeenCalledWith('[transcription-pilot] job failed:', code, job.id);
      expect(store.publishReadyTranscriptionJob).not.toHaveBeenCalled();
    });

    it('fails terminally with output_integrity_mismatch when the stored output differs', async () => {
      setup({ status: 'completed', text: 'hello' });
      runtime.readPrivateContentIfPresent.mockResolvedValue({ buffer: Buffer.from('something else'), blob: { pathname: 'transcription-pilot/output.json' } });
      await drainTranscriptionPilot({ maxJobs: 1 });
      expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(failedWith('output_integrity_mismatch'));
      expect(store.mutateLeasedTranscriptionJob).not.toHaveBeenCalledWith(rescheduled());
    });

    it.each([
      ['a generic network error', new Error('connect ECONNREFUSED 10.0.0.1:443'), 'provider_request_failed', 'Error'],
      ['a provider 5xx', Object.assign(new Error('x'), { code: 'provider_http_503' }), 'provider_http_503', 'provider_http_503'],
    ])('still schedules a retry for %s', async (_label, error, code, logged) => {
      const job = setup(error);
      await drainTranscriptionPilot({ maxJobs: 1 });
      expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
        fields: expect.objectContaining({ next_attempt_at: expect.any(Date), sanitized_error_code: code }),
      }));
      expect(store.mutateLeasedTranscriptionJob).not.toHaveBeenCalledWith(expect.objectContaining({ fields: expect.objectContaining({ status: 'failed' }) }));
      expect(console.warn).toHaveBeenCalledWith('[transcription-pilot] retry scheduled:', logged, job.id);
    });

    it('still schedules a retry for output_write_verification_failed', async () => {
      setup({ status: 'completed', text: 'hello' });
      runtime.readPrivateContentIfPresent.mockResolvedValue(null);
      runtime.writePrivateContent.mockResolvedValue({ pathname: 'transcription-pilot/other.json' });
      await drainTranscriptionPilot({ maxJobs: 1 });
      expect(store.mutateLeasedTranscriptionJob).toHaveBeenCalledWith(expect.objectContaining({
        fields: expect.objectContaining({ next_attempt_at: expect.any(Date), sanitized_error_code: 'provider_request_failed' }),
      }));
      expect(console.warn).toHaveBeenCalledWith('[transcription-pilot] retry scheduled:', 'output_write_verification_failed', expect.any(String));
      expect(store.mutateLeasedTranscriptionJob).not.toHaveBeenCalledWith(expect.objectContaining({ fields: expect.objectContaining({ status: 'failed' }) }));
    });
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

  it('pauses a queued job before any claim or provider call when either switch is off', async () => {
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'true';
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'false';
    store.getTranscriptionJob.mockResolvedValue({ ...queued, status: 'queued' });
    await expect(advanceTranscriptionPilotJob(queued.id)).resolves.toEqual({ state: 'paused' });
    expect(store.claimTranscriptionJob).not.toHaveBeenCalled();
    expect(uploadAssemblyAIAudio).not.toHaveBeenCalled();
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
  });

  it('waits exactly until the persisted next-attempt time instead of polling early', async () => {
    const next = Date.now() + 120_000;
    store.getTranscriptionJob.mockResolvedValue({ ...queued, status: 'processing', next_attempt_at: new Date(next),
      lease_expires_at: null, provider_transcript_id: 'provider-1' });
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValue(null);
    const result = await advanceTranscriptionPilotJob(queued.id);
    expect(result).toEqual({ state: 'wait', waitUntil: next });
    expect(store.claimNextDueTranscriptionJob).toHaveBeenCalledWith({ jobId: queued.id });
    expect(getAssemblyAITranscript).not.toHaveBeenCalled();
  });

  it('waits for a current lease and exits on an unresolved post-intent outcome without resubmitting', async () => {
    const leaseUntil = Date.now() + 120_000;
    store.getTranscriptionJob.mockResolvedValueOnce({ ...queued, status: 'processing', provider_transcript_id: 'provider-1', lease_expires_at: new Date(leaseUntil) });
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValue(null);
    const waiting = await advanceTranscriptionPilotJob(queued.id);
    expect(waiting.state).toBe('wait');
    expect(waiting.waitUntil).toBeGreaterThanOrEqual(leaseUntil - 5);

    store.getTranscriptionJob.mockResolvedValueOnce({ ...queued, status: 'submission_uncertain', submission_intent_at: new Date(), provider_transcript_id: null, callback_candidate_transcript_id: null });
    await expect(advanceTranscriptionPilotJob(queued.id)).resolves.toEqual({ state: 'attention' });
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
    expect(uploadAssemblyAIAudio).not.toHaveBeenCalled();
  });

  it('continues reconciliation for a callback candidate found during expired-intent recovery', async () => {
    const candidate = { ...queued, status: 'submission_uncertain', lease_expires_at: new Date(Date.now() - 1),
      submission_intent_at: new Date(Date.now() - 60_000), callback_candidate_transcript_id: 'candidate-1', provider_transcript_id: null };
    store.getTranscriptionJob.mockResolvedValueOnce({ ...candidate, status: 'submitting' }).mockResolvedValueOnce(candidate);
    store.claimNextDueTranscriptionJob.mockReset().mockResolvedValue(null);
    const result = await advanceTranscriptionPilotJob(queued.id);
    expect(result.state).toBe('wait');
    expect(store.requeueExpiredPreIntentTranscriptionSubmissions).toHaveBeenCalledWith({ jobId: queued.id, limit: 1 });
    expect(store.markExpiredTranscriptionSubmissionsUncertain).toHaveBeenCalledWith({ jobId: queued.id, limit: 1 });
    expect(store.claimNextDueTranscriptionJob).toHaveBeenCalledWith({ jobId: queued.id });
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
  });

  it('returns complete for a ready row and never sleeps until its retention deadline', async () => {
    store.getTranscriptionJob.mockResolvedValue({ ...queued, status: 'ready', expires_at: new Date(Date.now() + 86_400_000) });
    await expect(advanceTranscriptionPilotJob(queued.id)).resolves.toEqual({ state: 'complete' });
    expect(store.claimTranscriptionCleanup).not.toHaveBeenCalled();
  });

  it('runs bounded daily cleanup with expired content first and reports pending work', async () => {
    const expired = { ...queued, status: 'expired', cleanup_requested_at: new Date(), expires_at: new Date(Date.now() - 1),
      provider_upload_ref_ciphertext: null, input_cleanup_pathname: null, output_cleanup_pathname: null,
      diagnostic_cleanup_pathname: null, local_cleanup_completed_at: new Date(), provider_cleanup_completed_at: new Date() };
    const pending = { ...expired, status: 'failed', expires_at: new Date(Date.now() + 86_400_000),
      provider_upload_ref_ciphertext: 'encrypted-ref', content_purged_at: null, local_cleanup_completed_at: null,
      provider_cleanup_completed_at: null };
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValueOnce({ job: expired, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: pending, leaseToken: queued.lease_token }).mockResolvedValue(null);
    store.expireTranscriptionContent.mockResolvedValue(expired);
    store.getLeasedTranscriptionJob.mockResolvedValue(pending);
    store.finishTranscriptionLocalCleanup.mockResolvedValue(expired);
    process.env.TRANSCRIPTION_PILOT_ENABLED = 'false';
    process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED = 'false';

    const result = await drainTranscriptionCleanup({ maxJobs: 2 });
    expect(result).toEqual({ expiredContent: 1, cleanup: 1, incomplete: true });
    expect(store.claimNextExpiredContentTranscriptionJob).toHaveBeenCalledTimes(2);
    expect(store.claimNextCleanupTranscriptionJob).toHaveBeenCalledTimes(1);
    expect(store.claimNextExpiredContentTranscriptionJob.mock.invocationCallOrder[0])
      .toBeLessThan(store.claimNextCleanupTranscriptionJob.mock.invocationCallOrder[0]);
    expect(store.claimNextCleanupTranscriptionJob).toHaveBeenCalledWith({
      excludeJobIds: [expired.id],
    });
    expect(uploadAssemblyAIAudio).not.toHaveBeenCalled();
    expect(submitAssemblyAITranscription).not.toHaveBeenCalled();
  });

  it('releases an ordinary ready input-cleanup lease and excludes that job from same-pass reclaims', async () => {
    const ready = { ...queued, status: 'ready', version: 8, cleanup_requested_at: null,
      expires_at: new Date(Date.now() + 86_400_000), input_cleanup_pathname: 'transcription-pilot/ready/input.m4a',
      output_cleanup_pathname: 'transcription-pilot/ready/output.json', audio_pathname: null,
      provider_transcript_id: null, provider_upload_ref_ciphertext: null };
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: ready, leaseToken: ready.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue({ ...ready, version: 9 });
    runtime.deletePrivatePath.mockResolvedValue(true);
    store.finishTranscriptionLocalCleanup.mockResolvedValue({ ...ready, version: 10,
      input_cleanup_pathname: null, local_cleanup_completed_at: null });

    await drainTranscriptionCleanup({ maxJobs: 2 });

    expect(runtime.deletePrivatePath).toHaveBeenCalledWith(ready.input_cleanup_pathname, expect.any(Number));
    expect(store.finishTranscriptionLocalCleanup).toHaveBeenCalledWith(expect.objectContaining({ deletedPaths: ['input_cleanup_pathname'] }));
    expect(store.releaseReadyTranscriptionCleanupLease).toHaveBeenCalledWith({
      jobId: ready.id, leaseToken: ready.lease_token, expectedVersion: 9,
    });
  });

  it('does not release a ready cleanup lease after the live-token read is lost', async () => {
    const ready = { ...queued, status: 'ready', version: 8, cleanup_requested_at: null,
      expires_at: new Date(Date.now() + 86_400_000), input_cleanup_pathname: 'transcription-pilot/ready/input.m4a',
      output_cleanup_pathname: 'transcription-pilot/ready/output.json', audio_pathname: null,
      provider_transcript_id: null, provider_upload_ref_ciphertext: null };
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: ready, leaseToken: ready.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue(null);
    runtime.deletePrivatePath.mockResolvedValue(true);
    store.finishTranscriptionLocalCleanup.mockResolvedValue({ ...ready, version: 10,
      input_cleanup_pathname: null, local_cleanup_completed_at: null });

    await drainTranscriptionCleanup({ maxJobs: 1 });

    expect(store.releaseReadyTranscriptionCleanupLease).not.toHaveBeenCalled();
  });

  const zoomPath = 'transcription-pilot/ready/zoom-transcript.vtt';
  function zoomReadyJob(overrides = {}) {
    return { ...queued, status: 'ready', version: 8, cleanup_requested_at: null,
      expires_at: new Date(Date.now() + 86_400_000), input_cleanup_pathname: 'transcription-pilot/ready/input.m4a',
      output_cleanup_pathname: 'transcription-pilot/ready/output.json', zoom_transcript_cleanup_pathname: zoomPath,
      audio_pathname: null, provider_transcript_id: null, provider_upload_ref_ciphertext: null, ...overrides };
  }

  it('purge cleanup deletes and acknowledges the Zoom transcript path', async () => {
    const purging = zoomReadyJob({ cleanup_requested_at: new Date() });
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: purging, leaseToken: purging.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue({ ...purging, version: 9 });
    runtime.deletePrivatePath.mockResolvedValue(true);
    store.finishTranscriptionLocalCleanup.mockResolvedValue({ ...purging, version: 10, input_cleanup_pathname: null,
      output_cleanup_pathname: null, zoom_transcript_cleanup_pathname: null, local_cleanup_completed_at: new Date() });

    await drainTranscriptionCleanup({ maxJobs: 1 });

    expect(runtime.deletePrivatePath).toHaveBeenCalledWith(zoomPath, expect.any(Number));
    expect(store.finishTranscriptionLocalCleanup).toHaveBeenCalledWith(expect.objectContaining({
      deletedPaths: expect.arrayContaining(['zoom_transcript_cleanup_pathname']) }));
  });

  it('keeps cleanup pending while the Zoom transcript path remains after a purge pass', async () => {
    const purging = zoomReadyJob({ cleanup_requested_at: new Date() });
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: purging, leaseToken: purging.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue({ ...purging, version: 9 });
    runtime.deletePrivatePath.mockResolvedValue(true);
    store.finishTranscriptionLocalCleanup.mockResolvedValue({ ...purging, version: 10, input_cleanup_pathname: null,
      output_cleanup_pathname: null, zoom_transcript_cleanup_pathname: zoomPath });

    const result = await drainTranscriptionCleanup({ maxJobs: 3 });

    expect(result.incomplete).toBe(true);
  });

  it('ready-time (non-purge) cleanup leaves the Zoom transcript path alone', async () => {
    const ready = zoomReadyJob();
    store.claimNextExpiredContentTranscriptionJob.mockResolvedValue(null);
    store.claimNextCleanupTranscriptionJob.mockResolvedValueOnce({ job: ready, leaseToken: ready.lease_token }).mockResolvedValue(null);
    store.getLeasedTranscriptionJob.mockResolvedValue({ ...ready, version: 9 });
    runtime.deletePrivatePath.mockResolvedValue(true);
    store.finishTranscriptionLocalCleanup.mockResolvedValue({ ...ready, version: 10, input_cleanup_pathname: null });

    await drainTranscriptionCleanup({ maxJobs: 1 });

    expect(runtime.deletePrivatePath).not.toHaveBeenCalledWith(zoomPath, expect.anything());
    expect(store.finishTranscriptionLocalCleanup).toHaveBeenCalledWith(expect.objectContaining({ deletedPaths: ['input_cleanup_pathname'] }));
  });
});
