import crypto from 'node:crypto';
import {
  beginTranscriptionProviderSubmission, bindVerifiedTranscriptionProviderId,
  claimNextCleanupTranscriptionJob,
  claimNextDueTranscriptionJob, claimNextTranscriptionJob, claimTranscriptionJob,
  claimTranscriptionCleanup, getTranscriptionJob,
  claimNextExpiredContentTranscriptionJob,
  finishTranscriptionLocalCleanup, getLeasedTranscriptionJob,
  markExpiredTranscriptionSubmissionsUncertain, markTranscriptionAudioDeleted,
  markTranscriptionProviderDeletionCompleted, mutateLeasedTranscriptionJob,
  publishReadyTranscriptionJob, requeueExpiredPreIntentTranscriptionSubmissions,
  releaseTranscriptionLease,
  expireTranscriptionContent, purgeExpiredTranscriptionReceipt,
  setTranscriptionProviderUploadReference,
} from './store';
import {
  callbackAuth, deletePrivatePath, encryptedProviderReference, inspectOwnerInput,
  providerReference, readPrivateContentIfPresent, writePrivateContent,
} from './runtime';
import { deleteAssemblyAITranscript, getAssemblyAITranscript, submitAssemblyAITranscription, uploadAssemblyAIAudio } from './provider';
import { getMeetingTranscriptionControls, isMeetingTranscriptionRequestAllowed } from '../meeting-tracker-transcription/policy';

const MAX_WORKER_JOBS = 8;
const WORKER_BUDGET_MS = 240_000;
const MAX_DAILY_CLEANUP_JOBS = 100;
const MAX_DIAGNOSTIC_CHARS = 200;

function jobSubmissionEnabled(job) {
  if (typeof job?.request_id === 'string' && job.request_id) {
    const controls = getMeetingTranscriptionControls();
    return controls.schemaReady
      && isMeetingTranscriptionRequestAllowed(job.request_id, process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS);
  }
  return process.env.TRANSCRIPTION_PILOT_ENABLED === 'true'
    && process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'true';
}

function meetingClaimControls() {
  const controls = getMeetingTranscriptionControls();
  return {
    allowPilotSubmissions: process.env.TRANSCRIPTION_PILOT_ENABLED === 'true'
      && process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'true',
    meetingMode: controls.schemaReady ? controls.access.mode : 'off',
    meetingTestRequestId: controls.schemaReady ? controls.access.requestId : null,
  };
}

function providerTimeout(deadline, maximumMs = 20_000) {
  const remaining = deadline - Date.now();
  if (remaining < 1_000) throw Object.assign(new Error('worker_deadline_exhausted'), { code: 'provider_request_failed' });
  return Math.min(maximumMs, remaining);
}

function callbackUrl(correlationId) {
  let base = process.env.TRANSCRIPTION_CALLBACK_URL || process.env.NEXTAUTH_URL;
  if (!base && process.env.VERCEL_URL) base = `https://${process.env.VERCEL_URL}`;
  if (!base) throw new Error('callback_url_not_configured');
  const url = new URL('/api/webhooks/assemblyai', base);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('callback_url_invalid');
  url.searchParams.set('attempt', correlationId);
  return url.toString();
}

function normalizeTranscript(result) {
  const text = typeof result.text === 'string' ? result.text : '';
  if (text.length > 12 * 1024 * 1024) throw new Error('provider_output_too_large');
  if (result.utterances != null && !Array.isArray(result.utterances)) throw new Error('provider_invalid_utterances');
  const source = result.utterances || [];
  if (source.length > 200_000) throw new Error('provider_output_too_large');
  const utterances = source.map((item) => {
    if (!item || !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start
      || typeof item.text !== 'string' || item.text.length > 20_000) throw new Error('provider_invalid_utterance');
    if (item.speaker != null && (typeof item.speaker !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(item.speaker))) throw new Error('provider_invalid_speaker_label');
    return { start: Math.round(item.start), end: Math.round(item.end), text: item.text, speaker: item.speaker || null };
  });
  return { text, utterances, outcome: utterances.length || text.trim() ? 'complete' : 'no_speech' };
}

function safeProviderError(error) {
  const code = typeof error?.code === 'string' && /^provider_(?:http_[0-9]{3}|request_failed|invalid_json|response_too_large|output_too_large|not_configured)$/.test(error.code)
    ? error.code : 'provider_request_failed';
  return code.slice(0, MAX_DIAGNOSTIC_CHARS);
}

async function saveCompletedTranscript(job, leaseToken, result, deadline) {
  let current = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken });
  if (!current || current.cleanup_requested_at || current.provider_id_conflict) return 'fenced';
  const outputPath = current.output_pathname || `transcription-pilot/${current.owner_profile_id}/${current.id}/output/transcript.json`;
  if (current.status === 'processing') {
    current = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
      expectedStatuses: ['processing'], fields: { status: 'saving', output_pathname: outputPath, output_cleanup_pathname: outputPath } });
    if (!current) return 'fenced';
  }
  const normalized = normalizeTranscript(result);
  const serialized = Buffer.from(JSON.stringify(normalized));
  const digest = crypto.createHash('sha256').update(serialized).digest('hex');
  // Leave response headroom below the platform's 4.5 MB response limit.
  if (serialized.length > 4_000_000) throw Object.assign(new Error('provider_output_too_large'), { code: 'provider_output_too_large' });
  const existing = await readPrivateContentIfPresent(outputPath, 4_000_000, deadline);
  if (existing && crypto.createHash('sha256').update(existing.buffer).digest('hex') !== digest) throw new Error('output_integrity_mismatch');
  const blob = existing?.blob || await writePrivateContent(outputPath, 'application/json', serialized, deadline);
  if (blob.pathname !== outputPath) throw new Error('output_write_verification_failed');
  const persisted = existing || await readPrivateContentIfPresent(outputPath, 4_000_000, deadline);
  if (!persisted || persisted.buffer.length !== serialized.length
    || crypto.createHash('sha256').update(persisted.buffer).digest('hex') !== digest) throw new Error('output_write_verification_failed');
  current = await getLeasedTranscriptionJob({ jobId: current.id, leaseToken });
  if (!current || current.cleanup_requested_at || current.status !== 'saving' || current.output_pathname !== outputPath) return 'fenced';
  const ready = await publishReadyTranscriptionJob({
    jobId: current.id, leaseToken, expectedVersion: current.version,
    outputPathname: outputPath, outputSha256: digest,
    returnedModel: typeof result.speech_model_used === 'string' ? result.speech_model_used.slice(0, 128) : null,
  });
  if (!ready) return 'fenced';

  // Result durability/publication is independent from remote/input cleanup.
  if (ready.provider_transcript_id) {
    try {
      await deleteAssemblyAITranscript({ region: ready.provider_region, transcriptId: ready.provider_transcript_id, timeoutMs: providerTimeout(deadline) });
      const live = await getLeasedTranscriptionJob({ jobId: ready.id, leaseToken });
      if (live) await markTranscriptionProviderDeletionCompleted({ jobId: ready.id, leaseToken, expectedVersion: live.version });
    } catch (error) { console.warn('[transcription-pilot] provider cleanup pending:', safeProviderError(error)); }
  }
  if (ready.audio_pathname) {
    try {
      await deletePrivatePath(ready.audio_pathname, deadline);
      const live = await getLeasedTranscriptionJob({ jobId: ready.id, leaseToken });
      if (live) await markTranscriptionAudioDeleted({ jobId: ready.id, leaseToken, expectedVersion: live.version, expectedPathname: ready.audio_pathname });
    } catch (error) { console.warn('[transcription-pilot] input cleanup pending:', safeProviderError(error)); }
  }
  return 'ready';
}

async function submitQueuedJob(job, deadline) {
  const leaseToken = job.lease_token;
  let current = job;
  try {
    if (!jobSubmissionEnabled(current)) {
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: ['submitting'], fields: { status: 'queued' } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['queued'] });
      return 'submissions_disabled';
    }
    let uploadRef;
    if (current.provider_upload_ref_ciphertext) {
      uploadRef = await providerReference(current.provider_upload_ref_ciphertext);
    } else {
      const { buffer, blob } = await inspectOwnerInput(current, deadline);
      if (buffer.length !== Number(current.verified_bytes) || blob.pathname !== current.audio_pathname) throw Object.assign(new Error('audio_integrity_mismatch'), { code: 'audio_integrity_mismatch' });
      uploadRef = await uploadAssemblyAIAudio({ region: current.provider_region, audio: buffer, contentType: current.verified_content_type,
        timeoutMs: providerTimeout(deadline, 90_000) });
      current = await getLeasedTranscriptionJob({ jobId: current.id, leaseToken });
      if (!current || current.cleanup_requested_at) return 'fenced';
      current = await setTranscriptionProviderUploadReference({ jobId: current.id, leaseToken, expectedVersion: current.version, ciphertext: await encryptedProviderReference(uploadRef) });
      if (!current) return 'fenced';
    }
    if (!jobSubmissionEnabled(current)) {
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: ['submitting'], fields: { status: 'queued' } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['queued'] });
      return 'submissions_disabled';
    }
    current = await beginTranscriptionProviderSubmission({ jobId: current.id, leaseToken, expectedVersion: current.version });
    if (!current) return 'fenced';
    current = await getLeasedTranscriptionJob({ jobId: current.id, leaseToken });
    if (!current || current.cleanup_requested_at) return 'fenced';
    if (!jobSubmissionEnabled(current)) {
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: ['submitting'], fields: { status: 'failed', sanitized_error_code: 'submissions_disabled_before_post' } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['failed'] });
      return 'failed';
    }
    const auth = callbackAuth(current.attempt_correlation_id);
    let response;
    try {
      response = await submitAssemblyAITranscription({
        region: current.provider_region, uploadUrl: uploadRef,
        model: current.requested_model, callbackUrl: callbackUrl(current.attempt_correlation_id), webhookAuth: auth,
        timeoutMs: providerTimeout(deadline),
      });
    } catch (error) {
      // Intent is durable. Any lost/ambiguous POST outcome must not be retried.
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: ['submitting'], fields: { status: 'submission_uncertain', sanitized_error_code: safeProviderError(error) } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['submission_uncertain'] });
      return 'uncertain';
    }
    current = await getLeasedTranscriptionJob({ jobId: current.id, leaseToken });
    if (!current) return 'fenced';
    const bound = await bindVerifiedTranscriptionProviderId({ jobId: current.id, leaseToken, expectedVersion: current.version, providerTranscriptId: response.id });
    if (!bound || bound.conflict || bound.job.cleanup_requested_at) return 'needs_attention';
    return await pollAndSave(bound.job, leaseToken, deadline);
  } catch (error) {
    const live = current?.id ? await getLeasedTranscriptionJob({ jobId: current.id, leaseToken }).catch(() => null) : null;
    if (live && live.submission_intent_at) {
      const changed = await mutateTranscriptionSafely(live, leaseToken, { status: 'submission_uncertain', sanitized_error_code: safeProviderError(error) }, ['submitting']);
      if (changed) await releaseTranscriptionLease({ jobId: live.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['submission_uncertain'] }).catch(() => {});
      return 'uncertain';
    }
    if (live) {
      const changed = await mutateTranscriptionSafely(live, leaseToken, { status: 'failed', cleanup_requested_at: new Date(), sanitized_error_code: safeProviderError(error) }, ['submitting']).catch(() => null);
      if (changed) await releaseTranscriptionLease({ jobId: live.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['failed'] }).catch(() => {});
    }
    throw error;
  }
}

async function mutateTranscriptionSafely(job, leaseToken, fields, expectedStatuses) {
  return mutateLeasedTranscriptionJob({ jobId: job.id, leaseToken, expectedVersion: job.version, expectedStatuses, fields });
}

async function pollAndSave(job, leaseToken, deadline) {
  if (!job.provider_transcript_id) return 'waiting';
  const current = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken });
  if (!current) return 'fenced';
  if (current.provider_id_conflict) {
    const changed = await mutateTranscriptionSafely(current, leaseToken,
      { status: 'submission_uncertain' }, ['processing', 'saving']);
    if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['submission_uncertain'] });
    return 'uncertain';
  }
  if (current.cleanup_requested_at || new Date(current.expires_at) <= new Date()) {
    const marked = current.cleanup_requested_at ? current : await expireTranscriptionContent({ jobId: current.id, leaseToken, expectedVersion: current.version });
    return marked ? processCleanup({ job: marked, leaseToken }, deadline) : 'fenced';
  }
  try {
    const result = await getAssemblyAITranscript({ region: current.provider_region, transcriptId: current.provider_transcript_id, timeoutMs: providerTimeout(deadline) });
    if (result.status === 'error') {
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: ['processing', 'saving'], fields: { status: 'failed', cleanup_requested_at: new Date(), sanitized_error_code: 'provider_transcription_failed' } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: ['failed'] });
      return 'failed';
    }
    if (result.status !== 'completed') {
      const activeStatus = current.status === 'saving' ? 'saving' : 'processing';
      const changed = await mutateLeasedTranscriptionJob({ jobId: current.id, leaseToken, expectedVersion: current.version,
        expectedStatuses: [activeStatus], fields: { next_attempt_at: new Date(Date.now() + 15_000) } });
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: [activeStatus] });
      return 'processing';
    }
    return await saveCompletedTranscript(current, leaseToken, result, deadline);
  } catch (error) {
    const live = await getLeasedTranscriptionJob({ jobId: current.id, leaseToken }).catch(() => null);
    if (live) {
      if (['provider_http_404', 'provider_http_410', 'provider_output_too_large'].includes(error.code)) {
        const changed = await mutateTranscriptionSafely(live, leaseToken,
          { status: 'failed', sanitized_error_code: safeProviderError(error), cleanup_requested_at: new Date() }, ['processing', 'saving']);
        if (changed) return processCleanup({ job: changed, leaseToken }, deadline);
      }
      const changed = await mutateLeasedTranscriptionJob({ jobId: live.id, leaseToken, expectedVersion: live.version,
        expectedStatuses: [live.status === 'saving' ? 'saving' : 'processing'], fields: { next_attempt_at: new Date(Date.now() + 30_000), sanitized_error_code: safeProviderError(error) } }).catch(() => null);
      if (changed) await releaseTranscriptionLease({ jobId: changed.id, leaseToken, expectedVersion: changed.version, expectedStatuses: [live.status === 'saving' ? 'saving' : 'processing'] }).catch(() => {});
    }
    return 'retry_scheduled';
  }
}

async function processDueJob({ job, leaseToken }, deadline) {
  if (job.status === 'submission_uncertain') {
    const transcriptId = job.callback_candidate_transcript_id || job.provider_transcript_id;
    if (!transcriptId) return 'uncertain';
    try {
      const result = await getAssemblyAITranscript({ region: job.provider_region, transcriptId, timeoutMs: providerTimeout(deadline) });
      const uploadRef = await providerReference(job.provider_upload_ref_ciphertext);
      if (result.audio_url !== uploadRef) return 'needs_attention';
      const latest = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken });
      if (!latest) return 'fenced';
      const bound = await bindVerifiedTranscriptionProviderId({ jobId: job.id, leaseToken, expectedVersion: latest.version, providerTranscriptId: transcriptId });
      if (!bound || bound.conflict) return 'needs_attention';
      if (bound.job.cleanup_requested_at) return processCleanup({ job: bound.job, leaseToken }, deadline);
      return pollAndSave(bound.job, leaseToken, deadline);
    } catch { return 'uncertain'; }
  }
  return pollAndSave(job, leaseToken, deadline);
}

async function processCleanup(claimed, deadline) {
  let { job } = claimed;
  const { leaseToken } = claimed;
  // A conflicting callback may represent unresolved provider work. Local
  // deletion remains allowed, but automatic remote resolution must not erase
  // that evidence or release its slot without owner reconciliation/abandonment.
  if (job.provider_id_conflict && ['processing', 'saving'].includes(job.status)) {
    job = await mutateLeasedTranscriptionJob({ jobId: job.id, leaseToken, expectedVersion: job.version,
      expectedStatuses: ['processing', 'saving'], fields: { status: 'submission_uncertain' }, allowCleanup: true });
    if (!job) return 'cleanup_fenced';
  }
  if (new Date(job.expires_at) <= new Date() && !job.cleanup_requested_at) {
    job = await expireTranscriptionContent({ jobId: job.id, leaseToken, expectedVersion: job.version });
    if (!job) return 'cleanup_fenced';
  }
  const contentPurging = job.cleanup_requested_at != null || job.expires_at <= new Date() || job.content_purged_at != null;
  const paths = contentPurging
    ? ['input_cleanup_pathname', 'output_cleanup_pathname', 'diagnostic_cleanup_pathname']
    : ['input_cleanup_pathname'];
  const deletedPaths = [];
  for (const field of paths) {
    const pathname = job[field];
    if (!pathname) continue;
    try { await deletePrivatePath(pathname, deadline); deletedPaths.push(field); } catch {}
  }
  // Unknown provider jobs cannot be deleted by guessing; preserve the uncertain
  // slot/reference for operator reconciliation unless the reference was purged.
  let canPurgeReference = job.provider_upload_ref_ciphertext == null
    || job.provider_cleanup_completed_at != null
    || job.reference_purged_at != null
    || job.expires_at <= new Date();
  let providerId = job.provider_transcript_id;
  if (!providerId && job.status === 'submission_uncertain' && job.callback_candidate_transcript_id && job.provider_upload_ref_ciphertext) {
    try {
      const candidate = await getAssemblyAITranscript({ region: job.provider_region, transcriptId: job.callback_candidate_transcript_id, timeoutMs: providerTimeout(deadline) });
      if (candidate.audio_url === await providerReference(job.provider_upload_ref_ciphertext)) {
        const latest = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken });
        if (latest) {
          const bound = await bindVerifiedTranscriptionProviderId({ jobId: job.id, leaseToken, expectedVersion: latest.version, providerTranscriptId: job.callback_candidate_transcript_id });
          providerId = bound?.job?.provider_transcript_id || null;
        }
      }
    } catch {}
  }
  if (providerId && !job.provider_cleanup_completed_at && !job.provider_id_conflict) {
    try {
      await deleteAssemblyAITranscript({ region: job.provider_region, transcriptId: providerId, timeoutMs: providerTimeout(deadline) });
      const live = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken });
      if (live) {
        const deleted = await markTranscriptionProviderDeletionCompleted({ jobId: job.id, leaseToken, expectedVersion: live.version });
        if (deleted) canPurgeReference = true;
      }
    } catch {}
  }
  const latest = await getLeasedTranscriptionJob({ jobId: job.id, leaseToken }).catch(() => null);
  if (!latest) return 'cleanup_fenced';
  if (!deletedPaths.length && !canPurgeReference && !latest.provider_cleanup_completed_at) {
    // Keep the lease as the retry backoff. The daily sweeper will revisit this
    // row after expiry; advancing a Workflow must not spin on a tombstone.
    return 'provider_cleanup_pending';
  }
  let finished = await finishTranscriptionLocalCleanup({ jobId: job.id, leaseToken, expectedVersion: latest.version, deletedPaths, providerReferencePurged: canPurgeReference });
  if (finished && new Date(finished.receipt_expires_at) <= new Date() && !finished.receipt_purged_at && finished.content_purged_at) {
    finished = await purgeExpiredTranscriptionReceipt({ jobId: job.id, leaseToken, expectedVersion: finished.version }) || finished;
  }
  // Leave the seven-minute lease in place as a bounded cleanup retry backoff.
  return finished;
}

/** Bounded once-daily cleanup pass. Store claims rotate by updated_at; expired
 * content is drained first. No object paths or job identifiers leave here. */
export async function drainTranscriptionCleanup({ maxJobs = MAX_DAILY_CLEANUP_JOBS } = {}) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > MAX_DAILY_CLEANUP_JOBS) throw new Error('invalid_cleanup_batch');
  const deadline = Date.now() + WORKER_BUDGET_MS;
  const summary = { expiredContent: 0, cleanup: 0, incomplete: false };
  let pending = false;
  const runClaim = async (claimed, expired = false) => {
    if (!claimed) return false;
    let job = claimed.job;
    if (expired) {
      job = await expireTranscriptionContent({ jobId: job.id, leaseToken: claimed.leaseToken, expectedVersion: job.version });
      if (!job) return true;
      summary.expiredContent++;
    } else {
      summary.cleanup++;
    }
    const outcome = await processCleanup({ job, leaseToken: claimed.leaseToken }, deadline).catch(() => null);
    if (!outcome || outcome === 'provider_cleanup_pending' || outcome === 'cleanup_fenced'
      || (typeof outcome === 'object' && (
        outcome.input_cleanup_pathname || outcome.output_cleanup_pathname || outcome.diagnostic_cleanup_pathname
        || (outcome.provider_transcript_id && !outcome.provider_cleanup_completed_at)
        || (outcome.provider_upload_ref_ciphertext && !outcome.reference_purged_at && !outcome.provider_cleanup_completed_at)
      ))) pending = true;
    return true;
  };

  let processed = 0;
  while (processed < maxJobs && Date.now() < deadline) {
    const claimed = await claimNextExpiredContentTranscriptionJob();
    if (!claimed) break;
    await runClaim(claimed, true);
    processed++;
  }
  while (processed < maxJobs && Date.now() < deadline) {
    const claimed = await claimNextCleanupTranscriptionJob();
    if (!claimed) break;
    await runClaim(claimed);
    processed++;
  }
  summary.incomplete = pending || processed >= maxJobs || Date.now() >= deadline;
  return summary;
}

export async function drainTranscriptionPilot({ maxJobs = MAX_WORKER_JOBS } = {}) {
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > MAX_WORKER_JOBS) throw new Error('invalid_worker_batch');
  const deadline = Date.now() + WORKER_BUDGET_MS;
  const claimControls = meetingClaimControls();
  const submissionsEnabled = claimControls.allowPilotSubmissions || claimControls.meetingMode !== 'off';
  const summary = { submitted: 0, processed: 0, ready: 0, uncertain: 0, failed: 0, cleanup: 0, skipped: 0 };
  await requeueExpiredPreIntentTranscriptionSubmissions({ limit: maxJobs });
  await markExpiredTranscriptionSubmissionsUncertain({ limit: maxJobs });
  for (let i = 0; submissionsEnabled && i < maxJobs && Date.now() + 150_000 < deadline; i++) {
    const job = await claimNextTranscriptionJob(claimControls);
    if (!job) break;
    const outcome = await submitQueuedJob(job, deadline).catch(() => 'failed');
    if (outcome === 'ready') summary.ready++;
    else if (outcome === 'uncertain') summary.uncertain++;
    else if (outcome === 'failed') summary.failed++;
    else summary.submitted++;
  }
  for (let i = 0; i < maxJobs; i++) {
    if (Date.now() >= deadline) break;
    const claimed = await claimNextDueTranscriptionJob();
    if (!claimed) break;
    const outcome = await processDueJob(claimed, deadline).catch(() => 'retry_scheduled');
    if (outcome === 'ready') summary.ready++;
    else summary.processed++;
  }
  for (let i = 0; i < maxJobs; i++) {
    if (Date.now() >= deadline) break;
    const expired = await claimNextExpiredContentTranscriptionJob();
    if (!expired) break;
    const marked = await expireTranscriptionContent({ jobId: expired.job.id, leaseToken: expired.leaseToken, expectedVersion: expired.job.version });
    if (marked) await processCleanup({ job: marked, leaseToken: expired.leaseToken }, deadline);
    summary.cleanup++;
  }
  for (let i = 0; i < maxJobs; i++) {
    if (Date.now() >= deadline) break;
    const claimed = await claimNextCleanupTranscriptionJob();
    if (!claimed) break;
    await processCleanup(claimed, deadline);
    summary.cleanup++;
  }
  return summary;
}

/** One bounded state advance for a durable job-scoped workflow. Only opaque IDs
 * and scheduling metadata leave this service; provider/audio payloads stay here. */
export async function advanceTranscriptionPilotJob(jobId) {
  const deadline = Date.now() + WORKER_BUDGET_MS;
  let job = await getTranscriptionJob(jobId);
  if (!job) return { state: 'complete' };

  if (job.provider_id_conflict) return { state: 'attention' };
  if (job.status === 'submission_uncertain' && !job.provider_transcript_id && !job.callback_candidate_transcript_id) {
    return { state: 'attention' };
  }

  if (job.status === 'submitting' && job.lease_expires_at && new Date(job.lease_expires_at) <= new Date()) {
    await requeueExpiredPreIntentTranscriptionSubmissions({ jobId, limit: 1 });
    await markExpiredTranscriptionSubmissionsUncertain({ jobId, limit: 1 });
    job = await getTranscriptionJob(jobId);
    if (!job) return { state: 'complete' };
    if (job.status === 'submission_uncertain' && !job.provider_transcript_id && !job.callback_candidate_transcript_id) {
      return { state: 'attention' };
    }
  }

  if (job.cleanup_requested_at || (job.expires_at && new Date(job.expires_at) <= new Date()
    && !['submitting'].includes(job.status))) {
    let claimed = await claimTranscriptionCleanup({ jobId });
    if (!claimed && job.expires_at && new Date(job.expires_at) <= new Date()) {
      claimed = await claimNextExpiredContentTranscriptionJob({ jobId });
      if (claimed) {
        const expired = await expireTranscriptionContent({ jobId, leaseToken: claimed.leaseToken, expectedVersion: claimed.job.version });
        if (expired) await processCleanup({ job: expired, leaseToken: claimed.leaseToken }, deadline).catch(() => null);
      }
    } else if (claimed) {
      await processCleanup(claimed, deadline).catch(() => null);
    }
    job = await getTranscriptionJob(jobId);
    if (!job) return { state: 'complete' };
    if (job.provider_id_conflict || (job.status === 'submission_uncertain' && !job.provider_transcript_id && !job.callback_candidate_transcript_id)) {
      return { state: 'attention' };
    }
    // One cleanup pass per workflow invocation. The daily sweeper owns any
    // pending remote deletion or retained upload tombstone after this point.
    if (!claimed && job.lease_expires_at && new Date(job.lease_expires_at) > new Date()) {
      return { state: 'wait', waitUntil: new Date(job.lease_expires_at).getTime() };
    }
    return { state: 'complete' };
  }

  if (job.status === 'ready') return { state: 'complete' };
  if (job.status === 'queued') {
    if (!jobSubmissionEnabled(job)) {
      return { state: 'paused' };
    }
    const claimed = await claimTranscriptionJob({ jobId });
    if (!claimed) return { state: 'wait', waitUntil: job.lease_expires_at && new Date(job.lease_expires_at) > new Date()
      ? new Date(job.lease_expires_at).getTime() : Date.now() + 60_000 };
    await submitQueuedJob(claimed, deadline).catch(() => 'failed');
    job = await getTranscriptionJob(jobId);
  } else if (['processing', 'saving', 'submission_uncertain'].includes(job.status)) {
    const claimed = await claimNextDueTranscriptionJob({ jobId });
    if (!claimed) {
      const leaseUntil = job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : 0;
      const retryAt = job.next_attempt_at ? new Date(job.next_attempt_at).getTime() : 0;
      const waitUntil = Math.max(leaseUntil > Date.now() ? leaseUntil : 0, retryAt > Date.now() ? retryAt : 0);
      return { state: 'wait', waitUntil: waitUntil || Date.now() + 60_000 };
    }
    await processDueJob(claimed, deadline).catch(() => 'retry_scheduled');
    job = await getTranscriptionJob(jobId);
  } else if (job.status === 'submitting') {
    return { state: 'wait', waitUntil: job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : Date.now() + 60_000 };
  } else if (job.status === 'failed' || job.status === 'expired') {
    const claimed = await claimTranscriptionCleanup({ jobId });
    if (!claimed && job.lease_expires_at && new Date(job.lease_expires_at) > new Date()) {
      return { state: 'wait', waitUntil: new Date(job.lease_expires_at).getTime() };
    }
    if (claimed) await processCleanup(claimed, deadline).catch(() => null);
    return { state: 'complete' };
  } else {
    return { state: 'complete' };
  }

  if (!job) return { state: 'complete' };
  if (job.status === 'ready' || job.status === 'failed' || job.status === 'expired') return { state: 'complete' };
  if (job.provider_id_conflict) return { state: 'attention' };
  if (job.status === 'submission_uncertain' && !job.provider_transcript_id && !job.callback_candidate_transcript_id) return { state: 'attention' };
  if (job.cleanup_requested_at) return { state: 'complete' };
  const retryAt = job.next_attempt_at ? new Date(job.next_attempt_at).getTime() : 0;
  const leaseUntil = job.lease_expires_at ? new Date(job.lease_expires_at).getTime() : 0;
  const waitUntil = Math.max(retryAt > Date.now() ? retryAt : 0, leaseUntil > Date.now() ? leaseUntil : 0);
  return { state: 'wait', waitUntil: waitUntil || Date.now() + 60_000 };
}
