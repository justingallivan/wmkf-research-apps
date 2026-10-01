import {
  TRANSCRIPTION_JOB_LABELS, TRANSCRIPTION_JOB_STATUSES, TRANSCRIPTION_JOB_STATUS,
  projectOwnerTranscriptionJob,
} from '../../lib/services/transcription-pilot/model.js';
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

function fakeDatabase() {
  return {
    query: jest.fn(async () => ({ rows: [] })),
    transaction: jest.fn(async fn => fn({ query: jest.fn(async () => ({ rows: [] })) })),
  };
}

describe('transcription pilot persistence contract', () => {
  it('has an explicit label for every persisted state', () => {
    expect(Object.keys(TRANSCRIPTION_JOB_LABELS).sort()).toEqual([...TRANSCRIPTION_JOB_STATUSES].sort());
    expect(TRANSCRIPTION_JOB_LABELS.submission_uncertain).toBe('Needs attention');
    expect(TRANSCRIPTION_JOB_LABELS.submitting).toBe('Transcribing');
  });

  it('redacts content immediately on DELETE or expiry and never returns paths/provider IDs', () => {
    const row = {
      id: 'job', status: TRANSCRIPTION_JOB_STATUS.READY, version: 4,
      original_filename: 'private-name.m4a', correction_notes: 'sensitive correction',
      output_pathname: 'transcription-pilot/job/output.json',
      input_cleanup_pathname: 'transcription-pilot/job/input.m4a',
      provider_transcript_id: 'provider-secret-id', provider_upload_ref_ciphertext: 'ciphertext',
      lease_token: 'lease', cleanup_requested_at: new Date(), expires_at: new Date(Date.now() + 60000),
      local_cleanup_completed_at: null, provider_cleanup_completed_at: null,
    };
    const projected = projectOwnerTranscriptionJob(row);
    expect(projected.original_filename).toBeNull();
    expect(projected.correction_notes).toBeNull();
    expect(projected.contentAccessAllowed).toBe(false);
    expect(projected.cleanupPending).toBe(true);
    expect(projected.providerCleanupPending).toBe(true);
    for (const secret of ['output_pathname', 'input_cleanup_pathname', 'provider_transcript_id', 'provider_upload_ref_ciphertext', 'lease_token']) {
      expect(projected).not.toHaveProperty(secret);
    }

    const expired = projectOwnerTranscriptionJob({ ...row, cleanup_requested_at: null, expires_at: new Date(Date.now() - 1) });
    expect(expired.original_filename).toBeNull();
    expect(expired.correction_notes).toBeNull();
  });

  it('rejects lease-field injection before it reaches SQL', async () => {
    const db = fakeDatabase();
    const store = createTranscriptionPilotStore(db);
    await expect(store.mutateLeasedJob({
      jobId: '00000000-0000-4000-8000-000000000001',
      leaseToken: '00000000-0000-4000-8000-000000000002',
      expectedVersion: 1,
      expectedStatuses: ['queued'],
      fields: { lease_token: '00000000-0000-4000-8000-000000000003' },
    })).rejects.toMatchObject({ code: 'transcription_immutable_field', httpStatus: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('suppresses populated evaluation metadata after receipt expiry without waiting for cron', () => {
    const row = { status: 'failed', receipt_expires_at: new Date(Date.now() - 1),
      original_filename: 'meeting.mp3', declared_bytes: 500, verified_bytes: 500,
      audio_duration_ms: 60000, requested_model: 'universal-2', returned_model: 'universal-2',
      word_accuracy_score: 5, speaker_accuracy_score: 4, correction_notes: 'notes',
      cleanup_requested_at: new Date(), local_cleanup_completed_at: null };
    const dto = projectOwnerTranscriptionJob(row);
    for (const key of ['original_filename', 'declared_bytes', 'verified_bytes', 'audio_duration_ms',
      'requested_model', 'returned_model', 'word_accuracy_score', 'speaker_accuracy_score', 'correction_notes']) expect(dto[key]).toBeNull();
    expect(dto.cleanupPending).toBe(true);
  });
});
