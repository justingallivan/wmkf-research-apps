/** Durable state vocabulary and owner-safe projection for the transcription pilot. */

export const TRANSCRIPTION_JOB_STATUS = Object.freeze({
  UPLOADING: 'uploading',
  QUEUED: 'queued',
  SUBMITTING: 'submitting',
  PROCESSING: 'processing',
  SAVING: 'saving',
  READY: 'ready',
  FAILED: 'failed',
  SUBMISSION_UNCERTAIN: 'submission_uncertain',
  EXPIRED: 'expired',
});

export const TRANSCRIPTION_JOB_STATUSES = Object.freeze(Object.values(TRANSCRIPTION_JOB_STATUS));
export const TRANSCRIPTION_ACTIVE_SLOT_STATUSES = Object.freeze([
  TRANSCRIPTION_JOB_STATUS.SUBMITTING,
  TRANSCRIPTION_JOB_STATUS.PROCESSING,
  TRANSCRIPTION_JOB_STATUS.SAVING,
  TRANSCRIPTION_JOB_STATUS.SUBMISSION_UNCERTAIN,
]);

// Every persisted state has one stable UI label. Unknown values fail closed.
export const TRANSCRIPTION_JOB_LABELS = Object.freeze({
  uploading: 'Uploading',
  queued: 'Queued',
  submitting: 'Transcribing',
  processing: 'Transcribing',
  saving: 'Saving transcript',
  ready: 'Ready',
  failed: 'Failed',
  submission_uncertain: 'Needs attention',
  expired: 'Expired',
});

const OWNER_FIELDS = Object.freeze([
  'id', 'status', 'version', 'created_at', 'updated_at', 'original_filename',
  'declared_content_type', 'declared_bytes', 'verified_content_type', 'verified_bytes',
  'audio_duration_ms', 'requested_model', 'returned_model', 'ready_at', 'expires_at',
  'receipt_expires_at', 'word_accuracy_score', 'speaker_accuracy_score', 'correction_notes',
  'speaker_names',
  'sanitized_error_code', 'content_purged_at', 'reference_purged_at',
  'abandonment_acknowledged', 'abandoned_at', 'cleanup_requested_at',
  'provider_cleanup_completed_at', 'local_cleanup_completed_at', 'provider_id_conflict',
]);

/** Excludes owner IDs, paths, upload references, provider IDs and raw diagnostics. */
export function projectOwnerTranscriptionJob(row) {
  if (!row) return null;
  const projected = {};
  for (const field of OWNER_FIELDS) projected[field] = row[field] ?? null;
  const contentBlocked = row.cleanup_requested_at != null || row.content_purged_at != null
    || (row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now());
  if (contentBlocked) {
    projected.original_filename = null;
    projected.correction_notes = null;
    projected.speaker_names = null;
  }
  if (row.receipt_expires_at && new Date(row.receipt_expires_at).getTime() <= Date.now()) {
    for (const field of ['original_filename', 'declared_content_type', 'declared_bytes',
      'verified_content_type', 'verified_bytes', 'audio_duration_ms', 'requested_model',
      'returned_model', 'word_accuracy_score', 'speaker_accuracy_score', 'correction_notes']) projected[field] = null;
    projected.speaker_names = null;
  }
  projected.label = TRANSCRIPTION_JOB_LABELS[row.status] || null;
  projected.needsAttention = row.status === TRANSCRIPTION_JOB_STATUS.SUBMISSION_UNCERTAIN
    || row.provider_id_conflict === true;
  projected.contentAccessAllowed = row.status === 'ready' && !contentBlocked && row.output_pathname != null;
  projected.failedContentDeleted = row.status === TRANSCRIPTION_JOB_STATUS.FAILED
    && row.content_purged_at != null && row.local_cleanup_completed_at != null;
  projected.processing_duration_ms = row.ready_at && row.submission_intent_at
    && (!row.receipt_expires_at || new Date(row.receipt_expires_at).getTime() > Date.now())
    ? Math.max(0, new Date(row.ready_at).getTime() - new Date(row.submission_intent_at).getTime()) : null;
  projected.verificationReferenceExpired = row.status === TRANSCRIPTION_JOB_STATUS.SUBMISSION_UNCERTAIN
    && row.reference_purged_at != null;
  projected.cleanupPending = row.cleanup_requested_at != null
    && row.local_cleanup_completed_at == null;
  projected.providerCleanupPending = row.cleanup_requested_at != null
    && row.provider_cleanup_completed_at == null;
  return projected;
}
