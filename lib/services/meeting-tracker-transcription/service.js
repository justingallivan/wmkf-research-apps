/** Request-bound orchestration for the opt-in Meeting Tracker transcription slice. */
import crypto from 'node:crypto';
import { GraphService } from '../graph-service.js';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { POST_PRESENTATION_TRANSCRIPT_MAX_BYTES } from '../../utils/post-presentation-transcript-file.js';
import { projectPostPresentationMaterials } from '../post-presentation-materials/material-model.js';
import {
  bindPresentationTranscript, bindStaffDiscussionTranscript, bindTranscriptSummary, bindStaffDiscussionSummary,
} from '../post-presentation-materials/presentation-transcript-binding.js';
import { proposePresentationEnd } from './presentation-boundary.js';
import { prepareMeetingTranscriptBundlePublication, publishMeetingTranscriptBundle } from '../post-presentation-materials/material-service.js';
import {
  buildMeetingTranscriptFiles, validateMeetingTranscriptManifest,
  parseVerifiedMeetingTranscriptSource,
} from './bundle.js';
import { loadMeetingTranscriptionBinding, getMeetingTranscriptionCandidates } from './binding.js';
import {
  getMeetingTranscriptionControls, isMeetingTranscriptionRequestAllowed, requireMeetingTranscriptionEnabled,
} from './policy.js';
import {
  createMeetingTranscriptionUpload, queueMeetingTranscription, getMeetingTranscriptionJobContent,
  saveMeetingTranscriptionSpeakerNames, deleteMeetingTranscriptionJob, projectMeetingTranscriptionJob,
} from '../transcription-pilot/runtime.js';
import {
  getMeetingTranscriptionJob, listMeetingTranscriptionJobs, listMeetingTranscriptPublications,
  getMeetingTranscriptPublication, freezeMeetingPublicationFromJob,
  closeMeetingPublicationJobLease, closeMeetingPublicationWithoutWrites, closeMeetingPublicationAfterQuarantine,
  transitionMeetingTranscriptPublication,
  renewMeetingPublicationJobLease, renewMeetingPublicationReceiptLease, recordMeetingPublicationCandidate,
  recordMeetingPublicationSlotFence,
  createMeetingTranscriptCorrectionDraft, updateMeetingTranscriptCorrectionDraft,
  freezeMeetingTranscriptCorrectionDraft,
  listUnresolvedMeetingTranscriptPublications,
  expireMeetingTranscriptCorrectionDrafts,
  claimMeetingTranscriptPublicationForRecovery,
  markMeetingTranscriptPublicationChecked,
  claimMeetingUncertainTranscriptionJobForReconcile, reconcileMeetingVerifiedTranscriptionProviderId,
  abandonMeetingUncertainTranscriptionJob, getLeasedTranscriptionJob, releaseTranscriptionLease,
  markTranscriptionProviderDeletionCompleted,
} from '../transcription-pilot/store.js';
import { deleteAssemblyAITranscript, getAssemblyAITranscript } from '../transcription-pilot/provider.js';
import { providerReference } from '../transcription-pilot/runtime.js';
import { dispatchQueuedTranscriptionWorkflow } from '../transcription-pilot/workflow-dispatch.js';
import { ServiceHttpError } from '../service-http-error.js';
import { isMeetingTranscriptBundleSchemaReady } from '../../utils/meeting-transcript-bundle-readiness.js';
import { getPresentationSlotLease, releasePresentationSlotLease } from '../post-presentation-materials/slot-lease-store.js';
import { isGuid } from '../../utils/guid.js';

const TRANSCRIPT = REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT;
const PRESENTATION_TRANSCRIPT = REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT;
const STAFF_DISCUSSION_TRANSCRIPT = REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT;
const TRANSCRIPT_SUMMARY = REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY;
const STAFF_DISCUSSION_SUMMARY = REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY;
const MAX_SOURCE_BYTES = 4_000_000;
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stableJson = value => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);

function fail(code, status = 409, message = code) {
  throw new ServiceHttpError(message, { httpStatus: status, code, body: { error: message, code } });
}
function assertProfile(profileId) {
  if (!Number.isSafeInteger(profileId) || profileId < 1) fail('profile_required', 401);
}
function assertMappedPublisher(actorId) {
  if (!isGuid(actorId || '')) fail('post_presentation_actor_required', 403);
}
function requireTranscriptBundleReady() {
  if (!isMeetingTranscriptBundleSchemaReady()) fail('meeting_transcript_bundle_schema_not_ready', 503);
}
function identityFingerprint(row) { return row?.wmkf_inputfingerprint || row?.wmkf_contenthash || null; }
function primaryFile(row) {
  return {
    siteId: row?.wmkf_sharepointsiteid, driveId: row?.wmkf_sharepointdriveid,
    itemId: row?.wmkf_sharepointitemid, versionId: row?.wmkf_sharepointversionid,
    eTag: row?.wmkf_sharepointetag, filename: row?.wmkf_filename,
    sha256: row?.wmkf_contenthash,
    contentType: row?.wmkf_contenttype, size: Number(row?.wmkf_filesize),
  };
}

/**
 * The bindings need the TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT, TRANSCRIPT_SUMMARY and
 * STAFF_DISCUSSION_SUMMARY winners,
 * and the adapter filters by one artifact type at most, so this reads the request's rows and keeps those types.
 */
async function loadRows(requestId) {
  const result = await requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true });
  return { ...result, records: (result?.records || []).filter(row => [TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT, TRANSCRIPT_SUMMARY,
    STAFF_DISCUSSION_SUMMARY].includes(Number(row?.wmkf_artifacttype))) };
}

const PRESENTATION_TRANSCRIPT_STATE = Object.freeze({
  bound: 'bound', presentation_transcript_missing: 'missing',
  presentation_transcript_stale: 'stale', boundary_not_confirmed: 'not_confirmed',
});
const STAFF_DISCUSSION_TRANSCRIPT_STATE = Object.freeze({
  bound: 'bound', discussion_missing: 'missing', discussion_stale: 'stale', boundary_not_confirmed: 'not_confirmed',
});
const TRANSCRIPT_SUMMARY_STATE = Object.freeze({
  bound: 'bound', summary_missing: 'missing', summary_stale: 'stale', boundary_not_confirmed: 'not_confirmed',
});

function inspectCurrent(rows, binding) {
  const projected = projectPostPresentationMaterials(rows || [], binding.requestId);
  const row = projected.winners.find(item => Number(item.wmkf_artifacttype) === TRANSCRIPT) || null;
  if (!row) return { row: null, dto: null, manifest: null };
  const dto = { id: row.wmkf_requestdocumentid, fingerprint: identityFingerprint(row), bundleEditable: false,
    presentationEnd: null, presentationTranscript: { state: 'not_confirmed', artifactId: null },
    staffDiscussionTranscript: { state: 'not_confirmed', artifactId: null },
    transcriptSummary: { state: 'not_confirmed', artifactId: null, publishedAt: null },
    staffDiscussionSummary: { state: 'not_confirmed', artifactId: null, publishedAt: null } };
  let manifest = null;
  try {
    manifest = validateMeetingTranscriptManifest(JSON.parse(row.wmkf_transcriptbundlejson), {
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
      primaryFile: primaryFile(row),
    });
    dto.bundleEditable = true;
    dto.presentationEnd = manifest.presentationEnd || null;
  } catch { /* legacy or malformed metadata remains a readable primary TXT only */ }
  const bound = bindPresentationTranscript(projected.winners, binding.requestId);
  dto.presentationTranscript = {
    state: PRESENTATION_TRANSCRIPT_STATE[bound.reason] || 'not_confirmed',
    artifactId: bound.reason === 'bound' ? bound.presentationTranscript.wmkf_requestdocumentid : null,
  };
  const discussion = bindStaffDiscussionTranscript(projected.winners, binding.requestId);
  dto.staffDiscussionTranscript = {
    state: STAFF_DISCUSSION_TRANSCRIPT_STATE[discussion.reason] || 'not_confirmed',
    artifactId: discussion.reason === 'bound' ? discussion.staffDiscussionTranscript.wmkf_requestdocumentid : null,
  };
  // A stale summary stays visible to staff (with a note); only outside pages require 'bound'.
  const summary = bindTranscriptSummary(projected.winners, binding.requestId);
  dto.transcriptSummary = {
    state: TRANSCRIPT_SUMMARY_STATE[summary.reason] || 'not_confirmed',
    artifactId: summary.candidate?.wmkf_requestdocumentid || null,
    publishedAt: summary.candidate?.createdon || null,
  };
  // Staff-only (paired summaries plan D8); same states and stale handling as the presentation summary.
  const discussionSummary = bindStaffDiscussionSummary(projected.winners, binding.requestId);
  dto.staffDiscussionSummary = {
    state: TRANSCRIPT_SUMMARY_STATE[discussionSummary.reason] || 'not_confirmed',
    artifactId: discussionSummary.candidate?.wmkf_requestdocumentid || null,
    publishedAt: discussionSummary.candidate?.createdon || null,
  };
  return { row, dto, manifest };
}

/** The receipt's frozen boundary as the bundle identity expects it, or null. */
function receiptPresentationEnd(row) {
  if (row?.presentation_end_ms == null) return null;
  return { endMs: Number(row.presentation_end_ms), confirmedBy: Number(row.presentation_end_confirmed_by),
    confirmedAt: new Date(row.presentation_end_confirmed_at).toISOString() };
}

function samePresentationEnd(left, right) {
  if (!left || !right) return !left && !right;
  return left.endMs === right.endMs && left.confirmedBy === right.confirmedBy
    && Date.parse(left.confirmedAt) === Date.parse(right.confirmedAt);
}

function publicationDto(row) {
  return {
    operationId: row.operation_id, state: row.state, version: row.version,
    inputJobId: row.input_job_id || null,
    sourceArtifactId: row.source_artifact_id || null,
    sourceRevisionId: row.source_revision_id || null,
    expectedCurrentArtifactId: row.expected_current_artifact_id || null,
    createdAt: row.created_at, expiresAt: row.expires_at || null,
    quarantineUntil: row.quarantine_until || null,
    leaseExpiresAt: row.lease_expires_at || null,
    errorCode: row.error_code || null,
    resultingDocumentId: row.resulting_document_id || null,
  };
}

function correctionDto(row) {
  return {
    operationId: row.operation_id, state: row.state, version: row.version,
    sourceArtifactId: row.source_artifact_id, sourceRevisionId: row.source_revision_id,
    expectedCurrentArtifactId: row.expected_current_artifact_id,
    expectedCurrentFingerprint: row.expected_current_fingerprint,
    speakerNames: row.speaker_names || row.frozen_speaker_names || {},
    presentationEndMs: row.presentation_end_ms ?? null,
    createdAt: row.created_at, expiresAt: row.expires_at || null,
    errorCode: row.error_code || null,
  };
}

export async function getMeetingTranscriptionOverview({ requestId, ownerProfileId }) {
  assertProfile(ownerProfileId);
  if (!isMeetingTranscriptionRequestAllowed(requestId, process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS)
    || !getMeetingTranscriptionControls().schemaReady) {
    const unavailable = { status: 'unavailable', reason: 'feature_disabled' };
    return { siteVisitActivityId: null, featureState: 'disabled', candidateSources: {
      pi: unavailable, coPIs: unavailable, savedAttendees: unavailable,
    }, candidates: [], currentArtifact: null, publications: [], correctionDrafts: [], jobs: [] };
  }
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const [suggestions, jobs, publications, rows] = await Promise.all([
    getMeetingTranscriptionCandidates(binding),
    listMeetingTranscriptionJobs({ requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId }),
    listMeetingTranscriptPublications({ requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, limit: 50 }),
    loadRows(binding.requestId),
  ]);
  const current = inspectCurrent(rows?.records || [], binding);
  return {
    siteVisitActivityId: binding.siteVisitActivityId,
    featureState: 'enabled',
    candidateSources: suggestions.candidateSources,
    candidates: suggestions.candidates,
    currentArtifact: current.dto,
    publications: publications.map(publicationDto),
    correctionDrafts: publications.filter(row => row.source_artifact_id && row.state === 'draft').map(correctionDto),
    jobs: jobs.map(projectMeetingTranscriptionJob),
  };
}

export async function uploadMeetingTranscription({ requestId, ownerProfileId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  return createMeetingTranscriptionUpload({ ownerProfileId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, body });
}

export async function startMeetingTranscription({ requestId, ownerProfileId, actingUserSystemId, jobId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(ownerProfileId);
  if (!isGuid(actingUserSystemId || '')) fail('post_presentation_actor_required', 403);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const job = await queueMeetingTranscription({ ownerProfileId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, jobId, expectedVersion: body.expectedVersion,
    acknowledged: body.nonSensitiveAcknowledged });
  try {
    await dispatchQueuedTranscriptionWorkflow({ jobId });
  } catch {
    return { job, dispatchPending: true };
  }
  const latest = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId });
  return { job: latest ? projectMeetingTranscriptionJob(latest) : job, dispatchPending: false };
}

export async function readMeetingTranscriptionJob({ requestId, jobId }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  return getMeetingTranscriptionJobContent({ requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, jobId });
}

export async function renameMeetingTranscriptionSpeakers({ requestId, ownerProfileId, jobId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const job = await saveMeetingTranscriptionSpeakerNames({ requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, jobId, actorProfileId: ownerProfileId,
    expectedVersion: body.expectedVersion, speakerNames: body.speakerNames });
  return { job };
}

export async function removeMeetingTranscriptionJob({ requestId, ownerProfileId, jobId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const job = await deleteMeetingTranscriptionJob({ requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, jobId, actorProfileId: ownerProfileId,
    expectedVersion: body.expectedVersion });
  return { job };
}

export async function downloadMeetingTranscriptionJob({ requestId, jobId, format }) {
  requireMeetingTranscriptionEnabled(requestId);
  if (!['txt','vtt'].includes(format)) fail('unsupported_transcript_format', 400);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const [result, row] = await Promise.all([
    getMeetingTranscriptionJobContent({ requestId: binding.requestId,
      siteVisitActivityId: binding.siteVisitActivityId, jobId }),
    getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId }),
  ]);
  const files = buildMeetingTranscriptFiles({ content: result.content, speakerNames: row?.speaker_names || {},
    identity: { requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
      revisionId: jobId, operationId: jobId, sourceRevisionId: null } });
  const file = files.files[format];
  if (!file) fail('meeting_transcript_vtt_unavailable', 409);
  return { bytes: file.bytes, filename: file.filename, contentType: file.contentType };
}

export async function publishMeetingTranscription({ requestId, ownerProfileId, actingUserSystemId, jobId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(ownerProfileId);
  assertMappedPublisher(actingUserSystemId);
  requireTranscriptBundleReady();
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const [jobRow, documentRows] = await Promise.all([
    getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId }),
    loadRows(binding.requestId),
  ]);
  if (!jobRow || jobRow.status !== 'ready' || jobRow.version !== body.expectedVersion) fail('job_changed', 409);
  if (jobRow.expires_at <= new Date() || jobRow.cleanup_requested_at) fail('content_unavailable', 410);
  const current = inspectCurrent(documentRows?.records || [], binding);
  if ((current.dto?.id || null) !== (body.expectedCurrentArtifactId || null)
    || (current.dto?.fingerprint || null) !== (body.expectedCurrentFingerprint || null)) fail('meeting_transcript_current_changed', 409);
  const { content } = await getMeetingTranscriptionJobContent({ requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, jobId });
  const operationId = crypto.randomUUID();
  const identity = { requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
    revisionId: operationId, operationId, sourceRevisionId: null, presentationEnd: null };
  const generated = buildMeetingTranscriptFiles({ content, speakerNames: jobRow.speaker_names || {}, identity });
  if (!generated.publishable) fail('meeting_transcript_timed_vtt_required', 422, 'Timed transcript content is required to publish the TXT and VTT bundle.');
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: binding.requestId, operationId,
    siteVisitActivityId: binding.siteVisitActivityId });
  const candidatePaths = prepared.candidatePaths;
  const frozen = await freezeMeetingPublicationFromJob({ operationId, jobId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, initiatorProfileId: ownerProfileId,
    publishedByProfileId: ownerProfileId, expectedVersion: body.expectedVersion,
    actingUserSystemId,
    expectedCurrentArtifactId: current.dto?.id || null, expectedCurrentFingerprint: current.dto?.fingerprint || null,
    candidatePaths, frozenInputSha256: generated.inputSha256, formatterVersion: generated.formatterVersion });
  if (!frozen) fail('job_changed', 409);
  try {
    let leaseVersion = frozen.jobVersion;
    const callbacks = {
      async renew() {
        const renewed = await renewMeetingPublicationJobLease({ operationId, jobId,
          leaseToken: frozen.jobLeaseToken, expectedVersion: leaseVersion });
        if (!renewed) fail('meeting_transcript_publication_lease_lost', 409);
        leaseVersion = renewed.version;
        return true;
      },
      async recordCandidate(role, candidatePath, descriptor) {
        const recorded = await recordMeetingPublicationCandidate({ operationId, requestId: binding.requestId,
          siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.jobLeaseToken,
          role, candidatePath, descriptor });
        return Boolean(recorded);
      },
      async bindSlotFence(fenceVersion) {
        const recorded = await recordMeetingPublicationSlotFence({ operationId, requestId: binding.requestId,
          siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.jobLeaseToken, fenceVersion });
        return Boolean(recorded);
      },
    };
    const artifact = await publishMeetingTranscriptBundle({ requestId: binding.requestId, operationId,
      actorProfileId: ownerProfileId, actingUserSystemId, identity: { ...identity, formatterVersion: generated.formatterVersion },
      files: generated.files, frozenInputSha256: generated.inputSha256, expectedCurrentArtifactId: current.dto?.id || null,
      expectedCurrentFingerprint: current.dto?.fingerprint || null, prepared, candidatePaths, callbacks });
    const closed = await closeMeetingPublicationJobLease({ operationId, jobId, leaseToken: frozen.jobLeaseToken,
      expectedVersion: leaseVersion, verifiedFiles: artifact.manifest.files });
    if (!closed) fail('meeting_transcript_publication_lease_lost', 409);
    const publication = await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
      siteVisitActivityId: binding.siteVisitActivityId, expectedState: 'publishing', state: 'published',
      leaseToken: frozen.jobLeaseToken, resultingDocumentId: artifact.artifactId,
      verifiedFiles: artifact.manifest.files });
    if (!publication) fail('meeting_transcript_publication_reconcile_required', 503);
    const publishedJob = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    return { publication: { operationId, state: 'published' }, currentArtifact: {
      id: artifact.artifactId, fingerprint: artifact.fingerprint, bundleEditable: true,
    }, ...(publishedJob ? { job: projectMeetingTranscriptionJob(publishedJob) } : {}) };
  } catch (error) {
    let closed = null;
    try {
      closed = await closeMeetingPublicationWithoutWrites({ operationId, requestId: binding.requestId,
        siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.jobLeaseToken,
        actorProfileId: ownerProfileId });
      if (closed) {
        const slot = await getPresentationSlotLease({ requestId: binding.requestId, artifactType: TRANSCRIPT });
        if (slot && sameId(slot.lease_token, operationId) && Number.isInteger(Number(slot.fence_version))) {
          await releasePresentationSlotLease({ requestId: binding.requestId, artifactType: TRANSCRIPT,
            leaseToken: operationId, fenceVersion: Number(slot.fence_version) });
        }
      }
    } catch { /* A failed proof leaves the publication unresolved. */ }
    if (!closed) await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
      siteVisitActivityId: binding.siteVisitActivityId, expectedState: 'publishing', state: 'unknown',
      leaseToken: frozen.jobLeaseToken,
      errorCode: /^[a-z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'publication_uncertain' }).catch(() => null);
    throw error;
  }
}

async function loadVerifiedBundle({ requestId, siteVisitActivityId, artifactId }) {
  const result = await loadRows(requestId);
  const row = (result?.records || []).find(item => sameId(item.wmkf_requestdocumentid, artifactId));
  if (!row || !sameId(row._wmkf_request_value, requestId) || Number(row.wmkf_artifacttype) !== TRANSCRIPT) fail('transcript_artifact_not_found', 404);
  let manifest;
  try {
    manifest = validateMeetingTranscriptManifest(JSON.parse(row.wmkf_transcriptbundlejson), {
      requestId, siteVisitActivityId, primaryFile: primaryFile(row),
    });
  } catch { fail('meeting_transcript_bundle_unavailable', 409, 'This transcript has no verified editable bundle.'); }
  return { row, manifest };
}

async function loadCorrectionDraft({ requestId, operationId }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const receipt = await getMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId });
  if (!receipt || !receipt.source_artifact_id || receipt.state !== 'draft' || receipt.expires_at <= new Date()) fail('correction_draft_not_found', 404);
  const { row, manifest } = await loadVerifiedBundle({ requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, artifactId: receipt.source_artifact_id });
  if (!sameId(row.wmkf_requestdocumentid, receipt.expected_current_artifact_id)
    || identityFingerprint(row) !== receipt.expected_current_fingerprint
    || manifest.revisionId !== receipt.source_revision_id) fail('meeting_transcript_correction_stale', 409);
  const descriptor = manifest.files.source;
  const downloaded = await GraphService.downloadFile(descriptor.driveId, descriptor.itemId, { maxBytes: MAX_SOURCE_BYTES });
  if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length > MAX_SOURCE_BYTES) fail('meeting_transcript_source_unavailable', 503);
  const latest = await GraphService.getFileMetadataById(descriptor.driveId, descriptor.itemId, { siteId: descriptor.siteId });
  if (downloaded.buffer.length !== descriptor.size || sha256(downloaded.buffer) !== descriptor.sha256
    || !latest || latest.eTag !== descriptor.eTag || latest.versionId !== descriptor.versionId) fail('meeting_transcript_source_integrity_failed', 503);
  const source = parseVerifiedMeetingTranscriptSource(downloaded.buffer, descriptor, {
    requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, revisionId: manifest.revisionId,
  });
  const currentRows = await loadRows(binding.requestId);
  const current = inspectCurrent(currentRows?.records || [], binding);
  const candidates = await getMeetingTranscriptionCandidates(binding);
  const correction = correctionDto(receipt);
  const proposed = proposePresentationEnd({ utterances: source.content.utterances,
    speakerNames: correction.speakerNames, candidates: candidates.candidates });
  return { receipt, correction, content: source.content, candidates: candidates.candidates,
    currentArtifact: current.dto,
    presentationEnd: { current: source.presentationEnd || null,
      draft: correction.presentationEndMs == null ? null : { endMs: correction.presentationEndMs },
      proposed } };
}

export async function getMeetingCorrectionDraft(args) {
  const { receipt: _receipt, ...draft } = await loadCorrectionDraft(args);
  return draft;
}

export async function createMeetingCorrection({ requestId, ownerProfileId, artifactId }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(ownerProfileId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const [source, docs] = await Promise.all([
    loadVerifiedBundle({ requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, artifactId }),
    loadRows(binding.requestId),
  ]);
  const current = inspectCurrent(docs?.records || [], binding);
  if (!current.dto?.bundleEditable || !sameId(current.dto.id, artifactId)) fail('meeting_transcript_not_current', 409);
  const operationId = crypto.randomUUID();
  const parsed = await getMeetingCorrectionSource(source.manifest, binding);
  const receipt = await createMeetingTranscriptCorrectionDraft({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, initiatorProfileId: ownerProfileId,
    sourceArtifactId: artifactId, sourceRevisionId: source.manifest.revisionId,
    expectedCurrentArtifactId: current.dto.id, expectedCurrentFingerprint: current.dto.fingerprint,
    speakerNames: parsed.speakerNames, presentationEnd: parsed.presentationEnd || null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return await getMeetingCorrectionDraft({ requestId: binding.requestId, operationId: receipt.operation_id });
}

async function getMeetingCorrectionSource(manifest, binding) {
  const descriptor = manifest.files.source;
  const downloaded = await GraphService.downloadFile(descriptor.driveId, descriptor.itemId, { maxBytes: MAX_SOURCE_BYTES });
  if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length !== descriptor.size
    || downloaded.buffer.length > MAX_SOURCE_BYTES || sha256(downloaded.buffer) !== descriptor.sha256) fail('meeting_transcript_source_integrity_failed', 503);
  return parseVerifiedMeetingTranscriptSource(downloaded.buffer, descriptor, {
    requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, revisionId: manifest.revisionId,
  });
}

export async function updateMeetingCorrection({ requestId, ownerProfileId, operationId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const source = await getMeetingCorrectionDraft({ requestId: binding.requestId, operationId });
  const names = body.speakerNames;
  const allowedSpeakers = new Set(source.content.utterances.map(row => row.speaker).filter(Boolean));
  if (!names || typeof names !== 'object' || Array.isArray(names)
    || Object.keys(names).some(key => !allowedSpeakers.has(key))) fail('transcription_invalid_value', 400);
  let presentationEnd; // undefined leaves the draft's boundary untouched
  if (Object.prototype.hasOwnProperty.call(body, 'presentationEndMs')) {
    const endMs = body.presentationEndMs;
    if (endMs === null) presentationEnd = source.correction.presentationEndMs == null ? undefined : null;
    else if (Number.isSafeInteger(endMs) && endMs >= 0 && source.content.utterances.some(row => row.end === endMs)) {
      // The same value again keeps who confirmed it and when; only a change is a new confirmation.
      presentationEnd = endMs === source.correction.presentationEndMs ? undefined
        : { endMs, confirmedBy: ownerProfileId, confirmedAt: new Date().toISOString() };
    } else fail('transcription_invalid_value', 400);
  }
  const updated = await updateMeetingTranscriptCorrectionDraft({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, actorProfileId: ownerProfileId,
    expectedVersion: body.expectedVersion, speakerNames: names, presentationEnd });
  if (!updated) fail('meeting_transcript_correction_changed', 409);
  return { correction: correctionDto(updated) };
}

export async function publishMeetingCorrection({ requestId, ownerProfileId, actingUserSystemId, operationId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(ownerProfileId);
  assertMappedPublisher(actingUserSystemId);
  requireTranscriptBundleReady();
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const source = await loadCorrectionDraft({ requestId: binding.requestId, operationId });
  const correction = source.correction;
  // The files are built from this read; the freeze below is version-guarded, so requiring the read
  // to be the version the caller saw means a draft edited in between cannot be published unseen.
  if (source.receipt.version !== body.expectedVersion) fail('meeting_transcript_correction_changed', 409);
  const presentationEnd = receiptPresentationEnd(source.receipt);
  if (!source.currentArtifact?.bundleEditable
    || !sameId(source.currentArtifact.id, correction.expectedCurrentArtifactId)
    || source.currentArtifact.fingerprint !== correction.expectedCurrentFingerprint) fail('meeting_transcript_correction_stale', 409);
  const generatedIdentity = { requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
    revisionId: operationId, operationId, sourceRevisionId: correction.sourceRevisionId, presentationEnd };
  const generated = buildMeetingTranscriptFiles({ content: source.content,
    speakerNames: correction.speakerNames, identity: generatedIdentity });
  if (!generated.publishable) fail('meeting_transcript_timed_vtt_required', 422);
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: binding.requestId, operationId,
    siteVisitActivityId: binding.siteVisitActivityId });
  const candidatePaths = prepared.candidatePaths;
  const frozen = await freezeMeetingTranscriptCorrectionDraft({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, actorProfileId: ownerProfileId,
    actingUserSystemId,
    expectedVersion: body.expectedVersion, frozenInputSha256: generated.inputSha256,
    formatterVersion: generated.formatterVersion, candidatePaths });
  if (!frozen) fail('meeting_transcript_correction_changed', 409);
  try {
    const callbacks = {
      async renew() {
        const renewed = await renewMeetingPublicationReceiptLease({ operationId, leaseToken: frozen.leaseToken });
        if (!renewed) fail('meeting_transcript_publication_lease_lost', 409);
        return true;
      },
      async recordCandidate(role, candidatePath, descriptor) {
        const recorded = await recordMeetingPublicationCandidate({ operationId, requestId: binding.requestId,
          siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.leaseToken,
          role, candidatePath, descriptor });
        return Boolean(recorded);
      },
      async bindSlotFence(fenceVersion) {
        const recorded = await recordMeetingPublicationSlotFence({ operationId, requestId: binding.requestId,
          siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.leaseToken, fenceVersion });
        return Boolean(recorded);
      },
    };
    const artifact = await publishMeetingTranscriptBundle({ requestId: binding.requestId, operationId,
      actorProfileId: ownerProfileId, actingUserSystemId,
      identity: { ...generatedIdentity, formatterVersion: generated.formatterVersion }, files: generated.files,
      frozenInputSha256: generated.inputSha256,
      expectedCurrentArtifactId: correction.expectedCurrentArtifactId,
      expectedCurrentFingerprint: correction.expectedCurrentFingerprint, prepared, candidatePaths, callbacks });
    const publication = await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
      siteVisitActivityId: binding.siteVisitActivityId, expectedState: 'publishing', state: 'published',
      leaseToken: frozen.leaseToken, resultingDocumentId: artifact.artifactId,
      verifiedFiles: artifact.manifest.files });
    if (!publication) fail('meeting_transcript_publication_reconcile_required', 503);
    return { publication: { operationId, state: 'published' }, currentArtifact: {
      id: artifact.artifactId, fingerprint: artifact.fingerprint, bundleEditable: true,
    } };
  } catch (error) {
    let closed = null;
    try {
      closed = await closeMeetingPublicationWithoutWrites({ operationId, requestId: binding.requestId,
        siteVisitActivityId: binding.siteVisitActivityId, leaseToken: frozen.leaseToken,
        actorProfileId: ownerProfileId });
      if (closed) {
        const slot = await getPresentationSlotLease({ requestId: binding.requestId, artifactType: TRANSCRIPT });
        if (slot && sameId(slot.lease_token, operationId) && Number.isInteger(Number(slot.fence_version))) {
          await releasePresentationSlotLease({ requestId: binding.requestId, artifactType: TRANSCRIPT,
            leaseToken: operationId, fenceVersion: Number(slot.fence_version) });
        }
      }
    } catch { /* A failed proof leaves the publication unresolved. */ }
    if (!closed) await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
      siteVisitActivityId: binding.siteVisitActivityId, expectedState: 'publishing', state: 'unknown',
      leaseToken: frozen.leaseToken,
      errorCode: /^[a-z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'publication_uncertain' }).catch(() => null);
    throw error;
  }
}

export async function downloadMeetingTranscript({ requestId, artifactId, format }) {
  requireMeetingTranscriptionEnabled(requestId);
  if (!['txt','vtt'].includes(format)) fail('unsupported_transcript_format', 400);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const result = await loadRows(binding.requestId);
  const row = (result?.records || []).find(item => sameId(item.wmkf_requestdocumentid, artifactId));
  if (!row || !sameId(row._wmkf_request_value, binding.requestId)
    || Number(row.wmkf_artifacttype) !== TRANSCRIPT) fail('transcript_artifact_not_found', 404);
  const current = inspectCurrent(result?.records || [], binding);
  if (!sameId(current.row?.wmkf_requestdocumentid, artifactId)) fail('meeting_transcript_not_current', 409);
  let descriptor;
  try {
    const manifest = validateMeetingTranscriptManifest(JSON.parse(row.wmkf_transcriptbundlejson), {
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, primaryFile: primaryFile(row),
    });
    descriptor = manifest.files[format];
  } catch {
    if (format !== 'txt' || !row.wmkf_sharepointdriveid || !row.wmkf_sharepointitemid
      || !/^[0-9a-f]{64}$/i.test(row.wmkf_contenthash || '') || !Number.isSafeInteger(Number(row.wmkf_filesize))) {
      fail('meeting_transcript_bundle_unavailable', 409, 'This transcript format is unavailable for the current artifact.');
    }
    descriptor = { driveId: row.wmkf_sharepointdriveid, itemId: row.wmkf_sharepointitemid,
      siteId: row.wmkf_sharepointsiteid || null, sha256: row.wmkf_contenthash.toLowerCase(),
      size: Number(row.wmkf_filesize), filename: row.wmkf_filename || 'transcript.txt',
      contentType: row.wmkf_contenttype || 'text/plain; charset=utf-8' };
  }
  const downloaded = await GraphService.downloadFile(descriptor.driveId, descriptor.itemId,
    { maxBytes: POST_PRESENTATION_TRANSCRIPT_MAX_BYTES });
  if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length !== descriptor.size
    || downloaded.buffer.length > POST_PRESENTATION_TRANSCRIPT_MAX_BYTES || sha256(downloaded.buffer) !== descriptor.sha256) fail('meeting_transcript_file_integrity_failed', 503);
  if (descriptor.eTag && descriptor.versionId) {
    const latest = await GraphService.getFileMetadataById(descriptor.driveId, descriptor.itemId, { siteId: descriptor.siteId });
    if (!latest || latest.eTag !== descriptor.eTag || latest.versionId !== descriptor.versionId) fail('meeting_transcript_file_integrity_failed', 503);
  }
  return { bytes: downloaded.buffer, filename: descriptor.filename, contentType: descriptor.contentType };
}

export async function reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId = null, actingUserSystemId = null, maintenance = false }) {
  if (maintenance) {
    if (!getMeetingTranscriptionControls().schemaReady) fail('meeting_transcription_schema_not_ready', 503);
  } else {
    requireMeetingTranscriptionEnabled(requestId);
    assertProfile(actorProfileId);
  }
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const receipt = await getMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId });
  if (!receipt || !['publishing','retryable','unknown','published_reconcile'].includes(receipt.state)) fail('meeting_transcript_publication_not_reconcilable', 409);
  if (receipt.state === 'publishing' && receipt.lease_expires_at && new Date(receipt.lease_expires_at) > new Date()) fail('meeting_transcript_publication_busy', 409);
  const currentRows = await loadRows(binding.requestId);
  const generationKey = sha256(`meeting-tracker-post-presentation:${binding.requestId.toLowerCase()}:${TRANSCRIPT}:${operationId.toLowerCase()}:${receipt.frozen_input_sha256}`);
  const found = await requestDocumentAdapter.findByGenerationKey(generationKey, { includeMeetingTranscriptBundle: true });
  const rows = found?.records || [];
  if (rows.length !== 1) {
    if (rows.length) return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
      requiresAttention: true, reason: 'ambiguous_registry_binding' };
    const current = inspectCurrent(currentRows?.records || [], binding);
    const eligible = !maintenance && isGuid(actingUserSystemId || '')
      && receipt.slot_fence_version && receipt.verified_files
      && Object.keys(receipt.verified_files).sort().join(',') === 'source,txt,vtt'
      && receipt.candidate_paths && Object.keys(receipt.candidate_paths).sort().join(',') === 'source,txt,vtt';
    if (!eligible) return { publication: publicationDto(receipt), currentArtifact: current.dto,
      requiresAttention: true, reason: 'registry_row_not_found' };
    const lease = await claimMeetingTranscriptPublicationForRecovery({ operationId,
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    if (!lease) fail('meeting_transcript_publication_busy', 409);
    const recovering = lease.publication;
    try {
    const sourceDescriptor = recovering.verified_files.source;
    const sourceBytes = await GraphService.downloadFile(sourceDescriptor.driveId, sourceDescriptor.itemId,
      { maxBytes: MAX_SOURCE_BYTES });
    if (!Buffer.isBuffer(sourceBytes?.buffer) || sourceBytes.buffer.length !== sourceDescriptor.size
      || sha256(sourceBytes.buffer) !== sourceDescriptor.sha256) fail('meeting_transcript_source_integrity_failed', 503);
    const source = parseVerifiedMeetingTranscriptSource(sourceBytes.buffer, sourceDescriptor, {
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId, revisionId: operationId,
    });
    if (source.formatterVersion !== recovering.formatter_version) fail('meeting_transcript_source_integrity_failed', 503);
    // The receipt froze the boundary before any upload; the uploaded source must carry exactly it.
    const presentationEnd = receiptPresentationEnd(recovering);
    if (!samePresentationEnd(source.presentationEnd || null, presentationEnd)) fail('meeting_transcript_source_integrity_failed', 503);
    const sourceRevisionId = recovering.source_revision_id || null;
    const frozen = buildMeetingTranscriptFiles({ content: source.content, speakerNames: source.speakerNames,
      identity: { requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
        revisionId: operationId, operationId, sourceRevisionId, formatterVersion: recovering.formatter_version, presentationEnd } });
    if (!frozen.publishable || frozen.inputSha256 !== recovering.frozen_input_sha256
      || frozen.formatterVersion !== recovering.formatter_version) fail('meeting_transcript_source_integrity_failed', 503);
    const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: binding.requestId,
      operationId, siteVisitActivityId: binding.siteVisitActivityId });
    const callbacks = {
      async renew() {
        const renewed = await renewMeetingPublicationReceiptLease({ operationId, leaseToken: lease.leaseToken });
        if (!renewed) fail('meeting_transcript_publication_lease_lost', 409);
        return true;
      },
    };
      const artifact = await publishMeetingTranscriptBundle({ requestId: binding.requestId, operationId,
        // The receipt keeps the original Publish intent; this new action is
        // attributed to the currently authorized staff member, not that user.
        actorProfileId, actingUserSystemId,
        identity: { requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
          revisionId: operationId, operationId, sourceRevisionId, formatterVersion: recovering.formatter_version, presentationEnd },
        frozenInputSha256: recovering.frozen_input_sha256,
        expectedCurrentArtifactId: recovering.expected_current_artifact_id,
        expectedCurrentFingerprint: recovering.expected_current_fingerprint,
        prepared, candidatePaths: recovering.candidate_paths, callbacks,
        resumeVerifiedFiles: recovering.verified_files, originalSlotFenceVersion: recovering.slot_fence_version });
      const publication = await transitionMeetingTranscriptPublication({ operationId,
        requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
        expectedState: 'publishing', state: 'published', leaseToken: lease.leaseToken,
        resultingDocumentId: artifact.artifactId, verifiedFiles: artifact.manifest.files });
      if (!publication) fail('meeting_transcript_publication_changed', 409);
      const after = await loadRows(binding.requestId);
      return { publication: publicationDto(publication), currentArtifact: inspectCurrent(after?.records || [], binding).dto,
        requiresAttention: false, resumed: true };
    } catch (error) {
      await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
        siteVisitActivityId: binding.siteVisitActivityId, expectedState: 'publishing', state: 'unknown',
        leaseToken: lease.leaseToken,
        errorCode: /^[a-z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'publication_uncertain' }).catch(() => null);
      throw error;
    }
  }
  const row = rows[0];
  let manifest = null;
  try {
    manifest = validateMeetingTranscriptManifest(JSON.parse(row.wmkf_transcriptbundlejson), {
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
      primaryFile: primaryFile(row),
    });
  } catch { /* below return is deliberately attention-only */ }
  if (!sameId(row._wmkf_request_value, binding.requestId) || Number(row.wmkf_artifacttype) !== TRANSCRIPT
    || row.wmkf_producer !== 'meeting-tracker-post-presentation'
    || row.wmkf_inputfingerprint !== receipt.frozen_input_sha256
    || !manifest || manifest.operationId !== operationId
    || manifest.siteVisitActivityId !== binding.siteVisitActivityId) {
    return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
      requiresAttention: true, reason: 'registry_identity_mismatch' };
  }
  const receiptPaths = receipt.candidate_paths || {};
  if (!['source','txt','vtt'].every(role => {
    const descriptor = manifest.files[role];
    return receiptPaths[role] === `${row.wmkf_sharepointfolderpath}/${descriptor.filename}`;
  })) return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
    requiresAttention: true, reason: 'receipt_path_identity_mismatch' };
  const verified = {};
  for (const role of ['source','txt','vtt']) {
    const descriptor = manifest.files[role];
    const metadata = await GraphService.getFileMetadataById(descriptor.driveId, descriptor.itemId, { siteId: descriptor.siteId });
    if (!metadata || metadata.name !== descriptor.filename || Number(metadata.size) !== descriptor.size
      || metadata.eTag !== descriptor.eTag || metadata.versionId !== descriptor.versionId) {
      return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
        requiresAttention: true, reason: 'sharepoint_identity_mismatch' };
    }
    const content = await GraphService.downloadFile(descriptor.driveId, descriptor.itemId, { maxBytes: 4_000_000 });
    if (!Buffer.isBuffer(content?.buffer) || content.buffer.length !== descriptor.size
      || content.buffer.length > 4_000_000 || sha256(content.buffer) !== descriptor.sha256) {
      return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
        requiresAttention: true, reason: 'sharepoint_content_mismatch' };
    }
    const stable = await GraphService.getFileMetadataById(descriptor.driveId, descriptor.itemId, { siteId: descriptor.siteId });
    if (!stable || stable.eTag !== descriptor.eTag || stable.versionId !== descriptor.versionId) {
      return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
        requiresAttention: true, reason: 'sharepoint_changed_during_verification' };
    }
    verified[role] = descriptor;
  }
  if (receipt.verified_files && stableJson(receipt.verified_files) !== stableJson(verified)) {
    return { publication: publicationDto(receipt), currentArtifact: inspectCurrent(currentRows?.records || [], binding).dto,
      requiresAttention: true, reason: 'receipt_file_identity_mismatch' };
  }
  const current = inspectCurrent(currentRows?.records || [], binding);
  const superseded = !sameId(current.row?.wmkf_requestdocumentid, row.wmkf_requestdocumentid);
  const updated = await transitionMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, expectedState: receipt.state, state: 'published',
    errorCode: superseded ? 'publication_superseded' : null,
    resultingDocumentId: row.wmkf_requestdocumentid, verifiedFiles: verified });
  if (!updated) fail('meeting_transcript_publication_changed', 409);
  return { publication: publicationDto(updated), currentArtifact: current.dto,
    superseded, requiresAttention: false };
}

export async function closeMeetingTranscriptPublication({ requestId, operationId, actorProfileId, acknowledgeRetainedFiles }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(actorProfileId);
  if (acknowledgeRetainedFiles !== true) fail('meeting_transcript_close_acknowledgement_required', 400);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const receipt = await getMeetingTranscriptPublication({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId });
  if (!receipt || !['publishing','retryable','unknown','published_reconcile'].includes(receipt.state)) {
    fail('meeting_transcript_publication_not_closable', 409);
  }
  const now = Date.now();
  if (receipt.lease_expires_at && new Date(receipt.lease_expires_at).getTime() > now) {
    fail('meeting_transcript_publication_busy', 409);
  }
  if (!receipt.quarantine_until || new Date(receipt.quarantine_until).getTime() > now) {
    fail('meeting_transcript_publication_quarantine_active', 409);
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.frozen_input_sha256 || '')) fail('meeting_transcript_close_identity_unavailable', 503);
  const generationKey = sha256(`meeting-tracker-post-presentation:${binding.requestId.toLowerCase()}:${TRANSCRIPT}:${operationId.toLowerCase()}:${receipt.frozen_input_sha256}`);
  const found = await requestDocumentAdapter.findByGenerationKey(generationKey, { includeMeetingTranscriptBundle: true });
  const matches = found?.records;
  if (!Array.isArray(matches)) fail('meeting_transcript_close_identity_unavailable', 503);
  if (matches.length > 0) {
    return reconcileMeetingTranscriptPublication({ requestId: binding.requestId, operationId,
      actorProfileId, actingUserSystemId: null });
  }
  const closed = await closeMeetingPublicationAfterQuarantine({ operationId, requestId: binding.requestId,
    siteVisitActivityId: binding.siteVisitActivityId, expectedVersion: receipt.version,
    actorProfileId, artifactType: TRANSCRIPT });
  if (!closed) fail('meeting_transcript_publication_close_changed', 409);
  const rows = await loadRows(binding.requestId);
  return { publication: publicationDto(closed), currentArtifact: inspectCurrent(rows?.records || [], binding).dto,
    closed: true, retainedFiles: true };
}

export async function reconcileMeetingTranscriptPublicationsBatch({ limit = 20 } = {}) {
  if (!getMeetingTranscriptionControls().schemaReady) return { skipped: 'schema_not_ready', checked: 0, reconciled: 0, attention: 0 };
  const expiredDrafts = await expireMeetingTranscriptCorrectionDrafts({ limit: 100 });
  const receipts = await listUnresolvedMeetingTranscriptPublications({ limit });
  let reconciled = 0;
  let attention = 0;
  for (const receipt of receipts) {
    try {
      const result = await reconcileMeetingTranscriptPublication({ requestId: receipt.request_id,
        operationId: receipt.operation_id, maintenance: true });
      if (result.requiresAttention) attention++;
      else reconciled++;
    } catch {
      attention++;
    } finally {
      await markMeetingTranscriptPublicationChecked({ operationId: receipt.operation_id,
        state: receipt.state, expectedVersion: receipt.version }).catch(() => null);
    }
  }
  return { checked: receipts.length, reconciled, attention, expiredDrafts: expiredDrafts.length,
    incomplete: receipts.length >= limit || expiredDrafts.length >= 100 || attention > 0 };
}

export async function reconcileMeetingUncertainJob({ requestId, jobId, actorProfileId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(actorProfileId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const mode = body.mode || 'publish';
  if (!['publish','cleanup'].includes(mode)) fail('invalid_reconciliation_mode', 400);
  let lease = null;
  try {
    const existing = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    if (!existing) fail('job_not_found', 404);
    if (existing.version !== body.expectedVersion || existing.status !== 'submission_uncertain') fail('job_changed', 409);
    if (mode === 'publish' && existing.cleanup_requested_at) fail('cleanup_only_reconciliation_required', 409);
    if (mode === 'cleanup' && (!existing.cleanup_requested_at || !existing.provider_upload_ref_ciphertext)) fail('cleanup_verification_unavailable', 409);
    lease = await claimMeetingUncertainTranscriptionJobForReconcile({ jobId,
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    if (!lease) fail('job_changed_or_busy', 409);
    const transcript = await getAssemblyAITranscript({ region: lease.job.provider_region, transcriptId: body.providerTranscriptId });
    const expectedUpload = await providerReference(lease.job.provider_upload_ref_ciphertext);
    if (transcript.audio_url !== expectedUpload) fail('provider_job_audio_mismatch', 409);
    const current = await getLeasedTranscriptionJob({ jobId, leaseToken: lease.leaseToken });
    if (!current) fail('job_lease_lost', 409);
    const reconciled = await reconcileMeetingVerifiedTranscriptionProviderId({ jobId,
      requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
      leaseToken: lease.leaseToken, expectedVersion: current.version, providerTranscriptId: body.providerTranscriptId });
    if (!reconciled) fail('job_changed', 409);
    if (mode === 'cleanup') {
      await deleteAssemblyAITranscript({ region: lease.job.provider_region, transcriptId: body.providerTranscriptId });
      const latest = await getLeasedTranscriptionJob({ jobId, leaseToken: lease.leaseToken });
      if (!latest) fail('job_lease_lost', 409);
      const deleted = await markTranscriptionProviderDeletionCompleted({ jobId, leaseToken: lease.leaseToken,
        expectedVersion: latest.version });
      if (!deleted) fail('job_changed', 409);
      await releaseTranscriptionLease({ jobId, leaseToken: lease.leaseToken, expectedVersion: deleted.version,
        expectedStatuses: ['failed','submission_uncertain'] });
      lease = null;
      const final = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
      return { job: projectMeetingTranscriptionJob(final), cleanupOnly: true, providerDeleted: true };
    }
    await releaseTranscriptionLease({ jobId, leaseToken: lease.leaseToken, expectedVersion: reconciled.version,
      expectedStatuses: ['processing','submission_uncertain'] });
    lease = null;
    try { await dispatchQueuedTranscriptionWorkflow({ jobId }); }
    catch {
      const pending = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
      return { job: projectMeetingTranscriptionJob(pending), dispatchPending: true };
    }
    const final = await getMeetingTranscriptionJob({ jobId, requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId });
    return { job: projectMeetingTranscriptionJob(final) };
  } finally {
    if (lease) {
      const latest = await getLeasedTranscriptionJob({ jobId, leaseToken: lease.leaseToken }).catch(() => null);
      if (latest) await releaseTranscriptionLease({ jobId, leaseToken: lease.leaseToken,
        expectedVersion: latest.version, expectedStatuses: ['submission_uncertain','processing'] }).catch(() => {});
    }
  }
}

export async function abandonMeetingUncertainJob({ requestId, jobId, actorProfileId, body }) {
  requireMeetingTranscriptionEnabled(requestId);
  assertProfile(actorProfileId);
  const binding = await loadMeetingTranscriptionBinding(requestId);
  const row = await abandonMeetingUncertainTranscriptionJob({ jobId,
    requestId: binding.requestId, siteVisitActivityId: binding.siteVisitActivityId,
    actorProfileId, expectedVersion: body.expectedVersion, acknowledged: body.acknowledgePotentialDuplicateCharge });
  if (!row) fail('job_changed_or_busy', 409);
  return { job: projectMeetingTranscriptionJob(row) };
}

export const meetingTranscriptionRouteControls = () => getMeetingTranscriptionControls();
