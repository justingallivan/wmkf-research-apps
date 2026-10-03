/** Server-only orchestration for the fixed, synthetic speaker rehearsal. */
import rehearsalFixture from './rehearsal-fixture.js';
import crypto from 'node:crypto';
const {
  REHEARSAL_JOB_ID, REHEARSAL_REQUEST_ID, REHEARSAL_SITE_VISIT_ACTIVITY_ID,
} = rehearsalFixture;
import {
  getMeetingTranscriptionJobContent, projectMeetingTranscriptionJob,
  saveMeetingTranscriptionSpeakerNames,
} from '../transcription-pilot/runtime.js';
import { getMeetingTranscriptionJob, getTranscriptionWorkflowDispatch } from '../transcription-pilot/store.js';
import { formatTranscriptText, formatTranscriptVtt } from '../transcription-pilot/transcript-format.js';

function fixedJobId(jobId) {
  if (String(jobId || '').toLowerCase() !== REHEARSAL_JOB_ID) {
    const error = new Error('rehearsal_job_not_found');
    error.code = 'rehearsal_job_not_found';
    error.httpStatus = 404;
    throw error;
  }
}

const REHEARSAL_MARKER = 'meeting-tracker-speaker-rehearsal-v1';
const EXPECTED_OUTPUT_SHA256 = crypto.createHash('sha256')
  .update(Buffer.from(JSON.stringify(rehearsalFixture.REHEARSAL_TRANSCRIPT), 'utf8')).digest('hex');

function fixtureMismatch() {
  const error = new Error('rehearsal_fixture_mismatch');
  error.code = 'rehearsal_fixture_mismatch';
  error.httpStatus = 503;
  return error;
}

/** Validate the raw durable row before any projector or private Blob operation. */
export async function assertMeetingTranscriptionRehearsalFixtureRow(row) {
  const empty = [
    'idempotency_key', 'original_filename', 'declared_content_type', 'declared_bytes',
    'verified_content_type', 'verified_bytes', 'audio_duration_ms', 'audio_sha256', 'audio_etag',
    'audio_pathname', 'input_cleanup_pathname', 'provider_region', 'requested_model', 'returned_model',
    'provider_upload_ref_ciphertext',
    'provider_transcript_id', 'callback_candidate_transcript_id', 'conflicting_transcript_id',
    'attempt_correlation_id', 'submission_intent_at', 'lease_token', 'lease_expires_at',
    'publication_operation_id', 'diagnostic_pathname', 'diagnostic_cleanup_pathname',
    'diagnostic_sha256', 'cleanup_requested_at', 'content_purged_at',
  ];
  if (!row
    || String(row.id).toLowerCase() !== REHEARSAL_JOB_ID
    || row.owner_profile_id !== 1
    || String(row.request_id).toLowerCase() !== REHEARSAL_REQUEST_ID
    || String(row.site_visit_activity_id).toLowerCase() !== REHEARSAL_SITE_VISIT_ACTIVITY_ID
    || row.status !== 'ready'
    || row.output_pathname !== rehearsalFixture.REHEARSAL_OUTPUT_PATH
    || row.output_cleanup_pathname !== rehearsalFixture.REHEARSAL_OUTPUT_PATH
    || row.output_sha256 !== EXPECTED_OUTPUT_SHA256
    || row.options_snapshot?.rehearsal_fixture !== REHEARSAL_MARKER
    || Object.keys(row.options_snapshot || {}).sort().join(',') !== 'rehearsal_fixture'
    || empty.some((field) => row[field] != null)
    || row.provider_id_conflict !== false
    || Number(row.attempts) !== 0) throw fixtureMismatch();

  const dispatch = await getTranscriptionWorkflowDispatch({ jobId: REHEARSAL_JOB_ID });
  if (dispatch) throw fixtureMismatch();
  return row;
}

async function getFixtureRow() {
  const row = await getMeetingTranscriptionJob({
    jobId: REHEARSAL_JOB_ID,
    requestId: REHEARSAL_REQUEST_ID,
    siteVisitActivityId: REHEARSAL_SITE_VISIT_ACTIVITY_ID,
  });
  return assertMeetingTranscriptionRehearsalFixtureRow(row);
}

export async function getMeetingTranscriptionRehearsalCollection() {
  const row = await getFixtureRow();
  const projected = projectMeetingTranscriptionJob(row);
  const jobs = projected ? [projected] : [];
  return {
    jobs,
    candidates: rehearsalFixture.REHEARSAL_CANDIDATES,
    candidateSources: rehearsalFixture.REHEARSAL_CANDIDATE_SOURCES,
    publications: [],
    correctionDrafts: [],
    currentArtifact: null,
    featureState: 'enabled',
  };
}

export async function getMeetingTranscriptionRehearsalJob(jobId) {
  fixedJobId(jobId);
  await getFixtureRow();
  const result = await getMeetingTranscriptionJobContent({
    requestId: REHEARSAL_REQUEST_ID,
    siteVisitActivityId: REHEARSAL_SITE_VISIT_ACTIVITY_ID,
    jobId: REHEARSAL_JOB_ID,
  });
  if (result.job?.id?.toLowerCase() !== REHEARSAL_JOB_ID) {
    const error = new Error('rehearsal_job_not_found');
    error.code = 'rehearsal_job_not_found';
    error.httpStatus = 404;
    throw error;
  }
  const contentHash = crypto.createHash('sha256')
    .update(Buffer.from(JSON.stringify(result.content), 'utf8')).digest('hex');
  if (contentHash !== EXPECTED_OUTPUT_SHA256) throw fixtureMismatch();
  return result;
}

export async function saveMeetingTranscriptionRehearsalSpeakers({
  jobId, actorProfileId, expectedVersion, speakerNames,
}) {
  fixedJobId(jobId);
  if (actorProfileId !== 1) {
    const error = new Error('rehearsal_identity_denied');
    error.code = 'rehearsal_identity_denied';
    error.httpStatus = 403;
    throw error;
  }
  await getFixtureRow();
  const job = await saveMeetingTranscriptionSpeakerNames({
    requestId: REHEARSAL_REQUEST_ID,
    siteVisitActivityId: REHEARSAL_SITE_VISIT_ACTIVITY_ID,
    jobId: REHEARSAL_JOB_ID,
    actorProfileId,
    expectedVersion,
    speakerNames,
  });
  if (job?.id?.toLowerCase() !== REHEARSAL_JOB_ID) {
    const error = new Error('rehearsal_job_changed');
    error.code = 'rehearsal_job_changed';
    error.httpStatus = 409;
    throw error;
  }
  await getFixtureRow();
  return { job };
}

export async function downloadMeetingTranscriptionRehearsal({ jobId, format }) {
  fixedJobId(jobId);
  if (!['txt', 'vtt'].includes(format)) {
    const error = new Error('unsupported_transcript_format');
    error.code = 'unsupported_transcript_format';
    error.httpStatus = 400;
    throw error;
  }
  const { content, job } = await getMeetingTranscriptionRehearsalJob(jobId);
  const bytes = format === 'txt'
    ? Buffer.from(formatTranscriptText(content, job.speaker_names || {}), 'utf8')
    : Buffer.from(formatTranscriptVtt(content, job.speaker_names || {}), 'utf8');
  return {
    bytes,
    filename: `synthetic-meeting-transcript.${format}`,
    contentType: format === 'txt' ? 'text/plain; charset=utf-8' : 'text/vtt; charset=utf-8',
  };
}

export const REHEARSAL_COLLECTION_KEYS = Object.freeze([
  'jobs', 'candidates', 'candidateSources', 'publications', 'correctionDrafts', 'currentArtifact', 'featureState',
]);
