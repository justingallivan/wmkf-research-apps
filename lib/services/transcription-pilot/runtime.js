import crypto from 'node:crypto';
import { del, get, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { createAssemblyAIWebhookAuth, openProviderUploadReference, sealProviderUploadReference } from './crypto';
import { inspectAudioBuffer } from './media-inspector';
import { projectOwnerTranscriptionJob } from './model';
import {
  claimNextTranscriptionJob, createTranscriptionJob, getOwnerTranscriptionJob,
  listOwnerTranscriptionJobs, mutateLeasedTranscriptionJob, queueTranscriptionJob,
  reserveTranscriptionUploadWindow, createMeetingTranscriptionJob,
  getMeetingTranscriptionJob, listMeetingTranscriptionJobs,
  updateMeetingTranscriptionSpeakerNames, queueMeetingTranscriptionJob,
  reserveMeetingTranscriptionUploadWindow, requestMeetingTranscriptionJobCleanup,
} from './store';
import { getMeetingTranscriptionControls, requireMeetingTranscriptionEnabled } from '../meeting-tracker-transcription/policy';
import { applySpeakerReassignments, normalizeSpeakerNames } from './transcript-format';
import { parseZoomVtt } from './zoom-vtt';

import { MAX_TRANSCRIPTION_BYTES } from './limits.js';
export { MAX_TRANSCRIPTION_BYTES };
export const MAX_ZOOM_TRANSCRIPT_BYTES = 4_000_000;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const JOB_CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIME_TYPES = Object.freeze(['audio/mpeg', 'audio/mp4', 'audio/x-m4a']);
const PILOT_MODEL = 'universal-3-5-pro';
const DEFAULT_BLOB_DEADLINE_MS = 90_000;
const UPLOAD_CAPABILITY_TTL_MS = 15 * 60_000;

export class TranscriptionPilotError extends Error {
  constructor(code, status = 400, message = code) { super(message); this.code = code; this.status = status; }
}

export function requirePilotEnabled() {
  if (process.env.TRANSCRIPTION_PILOT_ENABLED !== 'true') throw new TranscriptionPilotError('transcription_pilot_disabled', 503);
}
export function requireSubmissionsEnabled() {
  requirePilotEnabled();
  if (process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED !== 'true') throw new TranscriptionPilotError('transcription_submissions_disabled', 409);
}

export function validateOwnerProfile(profileId) {
  if (!Number.isSafeInteger(profileId) || profileId <= 0) throw new TranscriptionPilotError('profile_required', 401);
}

export function projectMeetingTranscriptionJob(row) {
  const projected = projectReadableOwnerJob(row);
  if (!projected) return null;
  return Object.freeze({
    id: projected.id,
    status: projected.status,
    version: projected.version,
    created_at: projected.created_at,
    updated_at: projected.updated_at,
    original_filename: projected.original_filename,
    declared_content_type: projected.declared_content_type,
    declared_bytes: projected.declared_bytes,
    verified_content_type: projected.verified_content_type,
    verified_bytes: projected.verified_bytes,
    audio_duration_ms: projected.audio_duration_ms,
    ready_at: projected.ready_at,
    expires_at: projected.expires_at,
    speaker_names: projected.speaker_names,
    speaker_alignment: projected.speaker_alignment,
    zoomTranscriptAttached: row.zoom_transcript_cleanup_pathname != null || row.zoom_transcript_pathname != null,
    label: projected.label,
    needsAttention: projected.needsAttention,
    contentAccessAllowed: projected.contentAccessAllowed,
    contentDeletionObserved: projected.contentDeletionObserved,
    lateUploadWatchPending: projected.lateUploadWatchPending,
    cleanupPending: projected.cleanupPending,
  });
}

function hasWebVttHeader(buffer) {
  const prefix = buffer.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '');
  return /^WEBVTT(?:[ \t]|\r?\n|$)/.test(prefix);
}

const MEETING_MIME_TYPES = Object.freeze(['audio/mpeg', 'audio/mp4', 'audio/x-m4a']);

export async function createMeetingTranscriptionUpload({ ownerProfileId, requestId, siteVisitActivityId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  validateOwnerProfile(ownerProfileId);
  const filename = safeFilename(body?.filename);
  const contentType = body?.contentType;
  const bytes = body?.bytes;
  if (!MEETING_MIME_TYPES.includes(contentType) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_TRANSCRIPTION_BYTES) {
    throw new TranscriptionPilotError('invalid_audio_metadata');
  }
  if (typeof body?.idempotencyKey !== 'string') throw new TranscriptionPilotError('invalid_idempotency_key');
  const providerRegion = body.providerRegion === 'eu' ? 'eu' : 'us';
  const requestedModel = body.requestedModel == null ? PILOT_MODEL : body.requestedModel;
  if (requestedModel !== PILOT_MODEL) throw new TranscriptionPilotError('unsupported_model');
  const zoom = body.zoomTranscript;
  let zoomBytes = null;
  if (zoom != null) {
    zoomBytes = zoom.bytes;
    if (typeof zoom !== 'object' || Array.isArray(zoom)
      || Object.keys(zoom).some(key => key !== 'contentType' && key !== 'bytes')
      || zoom.contentType !== 'text/vtt' || !Number.isSafeInteger(zoomBytes)
      || zoomBytes < 1 || zoomBytes > MAX_ZOOM_TRANSCRIPT_BYTES) {
      throw new TranscriptionPilotError('invalid_zoom_transcript_metadata');
    }
  }
  const id = crypto.randomUUID();
  let pathname = `transcription-pilot/${ownerProfileId}/${id}/input/audio${contentType === 'audio/mpeg' ? '.mp3' : '.m4a'}`;
  const zoomPathname = zoomBytes == null ? null : `transcription-pilot/${ownerProfileId}/${id}/input/zoom-transcript.vtt`;
  const now = Date.now();
  const { job, created } = await createMeetingTranscriptionJob({
    id, ownerProfileId, idempotencyKey: body.idempotencyKey, requestId, siteVisitActivityId,
    originalFilename: filename, declaredContentType: contentType, declaredBytes: bytes,
    inputPathname: pathname, zoomTranscriptCleanupPathname: zoomPathname, providerRegion, requestedModel,
    optionsSnapshot: zoomBytes == null ? {} : { zoomTranscript: { bytes: zoomBytes } },
    expiresAt: new Date(now + UPLOAD_TTL_MS), receiptExpiresAt: new Date(now + RECEIPT_TTL_MS),
  });
  pathname = job.input_cleanup_pathname;
  const zoomUploadPathname = job.zoom_transcript_cleanup_pathname || null;
  if (!created && job.status !== 'uploading') return { job: projectMeetingTranscriptionJob(job), upload: null };
  if (job.cleanup_requested_at || isExpired(job)) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const rwToken = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!rwToken) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const validUntil = new Date(Date.now() + UPLOAD_CAPABILITY_TTL_MS);
  if (validUntil.getTime() > new Date(job.expires_at).getTime()) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const reserved = await reserveMeetingTranscriptionUploadWindow({
    jobId: job.id, requestId, siteVisitActivityId, ownerProfileId, validUntil,
  });
  if (!reserved) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const token = await generateClientTokenFromReadWriteToken({
    token: rwToken, pathname, maximumSizeInBytes: bytes,
    allowedContentTypes: [contentType], validUntil: validUntil.getTime(), addRandomSuffix: false,
  });
  const zoomUpload = zoomUploadPathname == null ? null : {
    pathname: zoomUploadPathname,
    token: await generateClientTokenFromReadWriteToken({
      token: rwToken, pathname: zoomUploadPathname, maximumSizeInBytes: zoomBytes,
      allowedContentTypes: ['text/vtt'], validUntil: validUntil.getTime(), addRandomSuffix: false,
    }),
    maximumSizeInBytes: zoomBytes,
    contentType: 'text/vtt',
  };
  return { job: projectMeetingTranscriptionJob(reserved), upload: { pathname, token, access: 'private', contentType, maximumSizeInBytes: bytes, zoomTranscript: zoomUpload } };
}

export async function queueMeetingTranscription({ ownerProfileId, requestId, siteVisitActivityId, jobId, expectedVersion, acknowledged }) {
  requireMeetingTranscriptionEnabled(requestId);
  validateOwnerProfile(ownerProfileId);
  if (acknowledged !== true) throw new TranscriptionPilotError('non_sensitive_acknowledgement_required');
  const row = await getMeetingTranscriptionJob({ jobId, requestId, siteVisitActivityId });
  if (!row) throw new TranscriptionPilotError('job_not_found', 404);
  if (row.status !== 'uploading' || row.version !== expectedVersion || row.cleanup_requested_at || isExpired(row)) {
    throw new TranscriptionPilotError('job_changed', 409);
  }
  const storedAudio = await readPrivateContentIfPresent(row.input_cleanup_pathname, MAX_TRANSCRIPTION_BYTES);
  if (!storedAudio) throw new TranscriptionPilotError('transcription_upload_missing', 410);
  const { buffer, blob } = storedAudio;
  if (!buffer || buffer.length !== Number(row.declared_bytes) || buffer.length < 1
    || blob.pathname !== row.input_cleanup_pathname || blob.contentType !== row.declared_content_type
    || !MEETING_MIME_TYPES.includes(blob.contentType)) throw new TranscriptionPilotError('uploaded_metadata_mismatch', 422);
  let zoomTranscriptSha256 = null;
  let speakerAlignment = null;
  if (row.zoom_transcript_cleanup_pathname) {
    const storedZoom = await readPrivateContentIfPresent(row.zoom_transcript_cleanup_pathname, MAX_ZOOM_TRANSCRIPT_BYTES);
    if (!storedZoom) throw new TranscriptionPilotError('zoom_transcript_missing', 410);
    const declared = row.options_snapshot?.zoomTranscript?.bytes;
    if (storedZoom.buffer.length < 1 || storedZoom.buffer.length !== declared
      || storedZoom.blob.pathname !== row.zoom_transcript_cleanup_pathname
      || storedZoom.blob.contentType !== 'text/vtt') throw new TranscriptionPilotError('zoom_transcript_invalid', 422);
    let parsed;
    try {
      if (!hasWebVttHeader(storedZoom.buffer)) throw new TypeError('invalid_vtt');
      parsed = parseZoomVtt(storedZoom.buffer.toString('utf8'));
    } catch { throw new TranscriptionPilotError('zoom_transcript_invalid', 422); }
    zoomTranscriptSha256 = crypto.createHash('sha256').update(storedZoom.buffer).digest('hex');
    if (parsed.names.length === 0) speakerAlignment = { status: 'no_speakers', attempts: 0 };
  }
  const metadata = await inspectAudioBuffer(buffer);
  const verifiedType = metadata.container === 'MPEG' ? 'audio/mpeg' : 'audio/mp4';
  const queued = await queueMeetingTranscriptionJob({
    jobId, requestId, siteVisitActivityId, actorProfileId: ownerProfileId, expectedVersion,
    acknowledgementAt: new Date(), verifiedContentType: verifiedType, verifiedBytes: buffer.length,
    durationMs: Math.round(metadata.durationSeconds * 1000),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'), etag: blob.etag,
    zoomTranscriptSha256, speakerAlignment,
  });
  if (!queued) throw new TranscriptionPilotError('job_changed', 409);
  return projectMeetingTranscriptionJob(queued);
}

export async function getMeetingTranscriptionJobContent({ requestId, siteVisitActivityId, jobId }) {
  requireMeetingTranscriptionEnabled(requestId);
  const row = await getMeetingTranscriptionJob({ jobId, requestId, siteVisitActivityId });
  if (!row) throw new TranscriptionPilotError('job_not_found', 404);
  if (row.cleanup_requested_at || row.expires_at <= new Date() || row.status !== 'ready' || !row.output_pathname) {
    throw new TranscriptionPilotError('content_unavailable', 410);
  }
  const { buffer } = await readPrivateContentIfPresent(row.output_pathname, 4_000_000);
  if (!buffer || crypto.createHash('sha256').update(buffer).digest('hex') !== row.output_sha256) {
    throw new TranscriptionPilotError('content_integrity_failed', 503);
  }
  const latest = await getMeetingTranscriptionJob({ jobId, requestId, siteVisitActivityId });
  if (!latest || latest.cleanup_requested_at || latest.expires_at <= new Date()
    || latest.status !== 'ready' || latest.output_pathname !== row.output_pathname) {
    throw new TranscriptionPilotError('content_unavailable', 410);
  }
  // Zoom-evidence speaker reassignment is applied here, once, for every
  // consumer (panel, excerpts, publication); the stored Blob keeps the provider's original labels.
  const content = applySpeakerReassignments(JSON.parse(buffer.toString('utf8')), latest.speaker_alignment?.reassigned,
    latest.speaker_alignment?.additionalSpeakerIds);
  return { job: projectMeetingTranscriptionJob(latest), content };
}

export async function saveMeetingTranscriptionSpeakerNames({ requestId, siteVisitActivityId, jobId, actorProfileId, expectedVersion, speakerNames }) {
  requireMeetingTranscriptionEnabled(requestId);
  validateOwnerProfile(actorProfileId);
  const current = await getMeetingTranscriptionJob({ jobId, requestId, siteVisitActivityId });
  if (!current || current.status !== 'ready' || current.version !== expectedVersion) throw new TranscriptionPilotError('job_changed', 409);
  if (current.cleanup_requested_at || current.expires_at <= new Date() || !current.output_pathname) throw new TranscriptionPilotError('content_unavailable', 410);
  const { content } = await getMeetingTranscriptionJobContent({ requestId, siteVisitActivityId, jobId });
  const normalized = normalizeSpeakerNames(content, speakerNames);
  const updated = await updateMeetingTranscriptionSpeakerNames({
    jobId, requestId, siteVisitActivityId, expectedVersion, actorProfileId, speakerNames: normalized,
  });
  if (!updated) throw new TranscriptionPilotError('job_changed', 409);
  return projectMeetingTranscriptionJob(updated);
}

export async function deleteMeetingTranscriptionJob({ requestId, siteVisitActivityId, jobId, actorProfileId, expectedVersion }) {
  requireMeetingTranscriptionEnabled(requestId);
  validateOwnerProfile(actorProfileId);
  const deleted = await requestMeetingTranscriptionJobCleanup({
    jobId, requestId, siteVisitActivityId, actorProfileId, expectedVersion,
  });
  if (!deleted) throw new TranscriptionPilotError('job_changed', 409);
  return projectMeetingTranscriptionJob(deleted);
}

export function meetingTranscriptionControls() {
  const controls = getMeetingTranscriptionControls();
  return { schemaReady: controls.schemaReady, mode: controls.access.mode };
}

function createBlobDeadline(deadline = Date.now() + DEFAULT_BLOB_DEADLINE_MS) {
  const remaining = Number(deadline) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('blob_deadline_exhausted')), remaining);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

function isExpired(row, now = Date.now()) {
  return !row?.expires_at || new Date(row.expires_at).getTime() <= now;
}

function safeFilename(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || /[\0-\x1f\x7f]/.test(value)) throw new TranscriptionPilotError('invalid_filename');
  return value.trim().replace(/[\\/]/g, '_');
}

export async function createOwnerUpload({ ownerProfileId, body }) {
  requireSubmissionsEnabled(); validateOwnerProfile(ownerProfileId);
  const filename = safeFilename(body?.filename);
  const contentType = body?.contentType;
  const bytes = body?.bytes;
  if (!MIME_TYPES.includes(contentType) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_TRANSCRIPTION_BYTES) throw new TranscriptionPilotError('invalid_audio_metadata');
  if (typeof body?.idempotencyKey !== 'string') throw new TranscriptionPilotError('invalid_idempotency_key');
  const providerRegion = body.providerRegion === 'eu' ? 'eu' : 'us';
  // Keep the pilot's new-job model server-selected. Existing persisted jobs
  // retain their own requested_model and remain processable by the worker.
  const requestedModel = body.requestedModel == null ? PILOT_MODEL : body.requestedModel;
  if (requestedModel !== PILOT_MODEL) throw new TranscriptionPilotError('unsupported_model');
  const id = crypto.randomUUID();
  let pathname = `transcription-pilot/${ownerProfileId}/${id}/input/audio${contentType === 'audio/mpeg' ? '.mp3' : '.m4a'}`;
  const now = Date.now();
  const { job, created } = await createTranscriptionJob({
    id, ownerProfileId, idempotencyKey: body.idempotencyKey, originalFilename: filename,
    declaredContentType: contentType, declaredBytes: bytes, inputPathname: pathname,
    providerRegion, requestedModel, optionsSnapshot: {},
    expiresAt: new Date(now + UPLOAD_TTL_MS), receiptExpiresAt: new Date(now + RECEIPT_TTL_MS),
  });
  pathname = job.input_cleanup_pathname;
  if (!created && job.status !== 'uploading') return { job: projectOwnerTranscriptionJob(job), upload: null };
  if (job.cleanup_requested_at || isExpired(job)) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const rwToken = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!rwToken) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const validUntil = new Date(Date.now() + UPLOAD_CAPABILITY_TTL_MS);
  if (validUntil.getTime() > new Date(job.expires_at).getTime()) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const reserved = await reserveTranscriptionUploadWindow({ jobId: job.id, ownerProfileId, validUntil });
  if (!reserved) throw new TranscriptionPilotError('job_upload_window_closed', 409);
  const token = await generateClientTokenFromReadWriteToken({
    token: rwToken, pathname, maximumSizeInBytes: bytes,
    allowedContentTypes: [contentType], validUntil: validUntil.getTime(),
    addRandomSuffix: false,
  });
  return { job: projectReadableOwnerJob(reserved), upload: { pathname, token, access: 'private', contentType, maximumSizeInBytes: bytes } };
}

export function projectReadableOwnerJob(row) {
  const projected = projectOwnerTranscriptionJob(row);
  if (!projected) return projected;
  const contentUnavailable = row.cleanup_requested_at != null || row.expires_at <= new Date() || row.content_purged_at != null;
  if (contentUnavailable) {
    projected.original_filename = null;
    projected.correction_notes = null;
  }
  return projected;
}

async function readPrivateBlob(pathname, maxBytes = MAX_TRANSCRIPTION_BYTES, deadline) {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const bounded = createBlobDeadline(deadline);
  try {
    const result = await get(pathname, { access: 'private', token, useCache: false, abortSignal: bounded.signal });
    if (!result || result.statusCode === 404) throw new TranscriptionPilotError('audio_not_found', 409);
    if (result.statusCode !== 200 || !result.stream) throw new TranscriptionPilotError('blob_read_failed', 503);
    const chunks = []; let length = 0;
    for await (const chunk of result.stream) {
      if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
      const buffer = Buffer.from(chunk); length += buffer.length;
      if (length > maxBytes) throw new TranscriptionPilotError('audio_too_large', 413);
      chunks.push(buffer);
    }
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    return { buffer: Buffer.concat(chunks, length), blob: result.blob };
  } catch (error) {
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    throw error;
  } finally {
    bounded.dispose();
  }
}

export async function readPrivateContentIfPresent(pathname, maxBytes = 32 * 1024 * 1024, deadline) {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const bounded = createBlobDeadline(deadline);
  try {
    const result = await get(pathname, { access: 'private', token, useCache: false, abortSignal: bounded.signal });
    if (!result || result.statusCode === 404) return null;
    if (result.statusCode !== 200 || !result.stream) throw new TranscriptionPilotError('blob_read_failed', 503);
    const chunks = []; let length = 0;
    for await (const chunk of result.stream) {
      if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
      const buffer = Buffer.from(chunk); length += buffer.length;
      if (length > maxBytes) throw new TranscriptionPilotError('content_too_large', 413);
      chunks.push(buffer);
    }
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    return { buffer: Buffer.concat(chunks, length), blob: result.blob };
  } catch (error) {
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    throw error;
  } finally {
    bounded.dispose();
  }
}

export async function validateAndQueueOwnerJob({ ownerProfileId, jobId, expectedVersion, acknowledged }) {
  requireSubmissionsEnabled(); validateOwnerProfile(ownerProfileId);
  if (acknowledged !== true) throw new TranscriptionPilotError('non_sensitive_acknowledgement_required');
  const row = await getOwnerTranscriptionJob({ jobId, ownerProfileId });
  if (!row) throw new TranscriptionPilotError('job_not_found', 404);
  if (row.status !== 'uploading' || row.version !== expectedVersion || row.cleanup_requested_at || isExpired(row)) throw new TranscriptionPilotError('job_changed', 409);
  const { buffer, blob } = await readPrivateBlob(row.input_cleanup_pathname);
  if (buffer.length !== Number(row.declared_bytes) || buffer.length < 1 || buffer.length > MAX_TRANSCRIPTION_BYTES) throw new TranscriptionPilotError('uploaded_size_mismatch', 422);
  if (blob.pathname !== row.input_cleanup_pathname || !MIME_TYPES.includes(blob.contentType)) throw new TranscriptionPilotError('uploaded_metadata_mismatch', 422);
  if (row.audio_etag && blob.etag !== row.audio_etag) throw new TranscriptionPilotError('uploaded_blob_changed', 409);
  const metadata = await inspectAudioBuffer(buffer);
  const verifiedType = metadata.container === 'MPEG' ? 'audio/mpeg' : 'audio/mp4';
  const queued = await queueTranscriptionJob({
    jobId, ownerProfileId, expectedVersion, acknowledgementAt: new Date(),
    verifiedContentType: verifiedType, verifiedBytes: buffer.length,
    durationMs: Math.round(metadata.durationSeconds * 1000), sha256: crypto.createHash('sha256').update(buffer).digest('hex'), etag: blob.etag,
  });
  if (!queued) throw new TranscriptionPilotError('job_changed', 409);
  return projectReadableOwnerJob(queued);
}

export async function getOwnerJobContent({ ownerProfileId, jobId }) {
  requirePilotEnabled(); validateOwnerProfile(ownerProfileId);
  const row = await getOwnerTranscriptionJob({ jobId, ownerProfileId });
  if (!row) throw new TranscriptionPilotError('job_not_found', 404);
  if (row.cleanup_requested_at || row.expires_at <= new Date() || row.status !== 'ready' || !row.output_pathname) throw new TranscriptionPilotError('content_unavailable', 410);
  const { buffer } = await readPrivateBlob(row.output_pathname, 32 * 1024 * 1024);
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== row.output_sha256) throw new TranscriptionPilotError('content_integrity_failed', 503);
  const latest = await getOwnerTranscriptionJob({ jobId, ownerProfileId });
  if (!latest || latest.cleanup_requested_at || latest.expires_at <= new Date() || latest.status !== 'ready' || latest.output_pathname !== row.output_pathname) throw new TranscriptionPilotError('content_unavailable', 410);
  return { job: projectReadableOwnerJob(latest), content: JSON.parse(buffer.toString('utf8')) };
}

export async function writePrivateContent(pathname, contentType, body, deadline) {
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const bounded = createBlobDeadline(deadline);
  try {
    return await put(pathname, body, { access: 'private', token, contentType, addRandomSuffix: false, allowOverwrite: false, abortSignal: bounded.signal });
  } catch (error) {
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    throw error;
  } finally { bounded.dispose(); }
}

export async function inspectOwnerInput(job, deadline) {
  const { buffer, blob } = await readPrivateBlob(job.audio_pathname, MAX_TRANSCRIPTION_BYTES, deadline);
  if (buffer.length !== Number(job.verified_bytes) || (job.audio_etag && blob.etag !== job.audio_etag)
    || crypto.createHash('sha256').update(buffer).digest('hex') !== job.audio_sha256) {
    throw new TranscriptionPilotError('audio_integrity_mismatch', 409);
  }
  const timeoutMs = deadline == null ? 10_000 : Math.min(10_000, Math.floor(deadline - Date.now()));
  if (timeoutMs <= 0) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
  return { buffer, blob, metadata: await inspectAudioBuffer(buffer, { timeoutMs }) };
}

export async function deletePrivatePath(pathname, deadline) {
  if (typeof pathname !== 'string' || !pathname.startsWith('transcription-pilot/')) throw new TranscriptionPilotError('invalid_cleanup_path', 400);
  const token = process.env.UPLOADS_BLOB_RW_TOKEN;
  if (!token) throw new TranscriptionPilotError('private_uploads_not_configured', 503);
  const bounded = createBlobDeadline(deadline);
  try { await del(pathname, { token, abortSignal: bounded.signal }); }
  catch (error) {
    if (bounded.signal.aborted) throw new TranscriptionPilotError('blob_deadline_exhausted', 504);
    throw error;
  } finally { bounded.dispose(); }
  return true;
}

export async function providerReference(ciphertext) {
  return openProviderUploadReference(ciphertext);
}
export async function encryptedProviderReference(url) {
  return sealProviderUploadReference(url);
}
export function callbackAuth(correlationId) {
  return createAssemblyAIWebhookAuth(correlationId);
}

export async function getOwnerJob({ ownerProfileId, jobId }) {
  requirePilotEnabled(); validateOwnerProfile(ownerProfileId);
  const row = await getOwnerTranscriptionJob({ jobId, ownerProfileId });
  if (!row) throw new TranscriptionPilotError('job_not_found', 404);
  return projectReadableOwnerJob(row);
}
export async function listOwnerJobs({ ownerProfileId, limit = 50 }) {
  requirePilotEnabled(); validateOwnerProfile(ownerProfileId);
  return (await listOwnerTranscriptionJobs({ ownerProfileId, limit })).map(projectReadableOwnerJob);
}

export const __private = { readPrivateBlob };
