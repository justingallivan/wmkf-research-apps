/** @jest-environment node */
import crypto from 'node:crypto';
jest.mock('../../lib/services/meeting-tracker-recordings/zoom-client', () => ({ getMeetingAttendance: jest.fn(async () => ({ status: 'unavailable', participants: [] })) }));
/** @jest-environment node */
jest.mock('../../lib/services/meeting-tracker-recordings/import-store', () => ({ getZoomImportForJob: jest.fn(async () => null) }));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequest: jest.fn(), findByGenerationKey: jest.fn() }));
jest.mock('../../lib/services/graph-service.js', () => ({ GraphService: { downloadFile: jest.fn(), getFileMetadataById: jest.fn() } }));
jest.mock('../../lib/services/post-presentation-materials/material-service.js', () => ({
  prepareMeetingTranscriptBundlePublication: jest.fn(), publishMeetingTranscriptBundle: jest.fn(),
}));
jest.mock('../../lib/services/post-presentation-materials/slot-lease-store.js', () => ({
  getPresentationSlotLease: jest.fn(), releasePresentationSlotLease: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/binding.js', () => ({
  loadMeetingTranscriptionBinding: jest.fn(), getMeetingTranscriptionCandidates: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({ getMeetingTranscriptionJobContent: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/provider.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => Object.fromEntries([
  'updateMeetingTranscriptCorrectionDraft', 'getMeetingTranscriptPublication', 'claimMeetingTranscriptPublicationForRecovery',
  'renewMeetingPublicationReceiptLease', 'transitionMeetingTranscriptPublication',
  'expireMeetingTranscriptCorrectionDrafts', 'listUnresolvedMeetingTranscriptPublications',
  'markMeetingTranscriptPublicationChecked', 'closeMeetingPublicationAfterQuarantine',
  'getMeetingTranscriptionJob', 'freezeMeetingPublicationFromJob', 'freezeMeetingTranscriptCorrectionDraft',
  'closeMeetingPublicationWithoutWrites', 'closeMeetingPublicationJobLease', 'createMeetingTranscriptCorrectionDraft',
].map(name => [name, jest.fn()])));

import { getZoomImportForJob } from '../../lib/services/meeting-tracker-recordings/import-store';
import * as documents from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import * as publisher from '../../lib/services/post-presentation-materials/material-service.js';
import * as slots from '../../lib/services/post-presentation-materials/slot-lease-store.js';
import { getMeetingTranscriptionJobContent } from '../../lib/services/transcription-pilot/runtime.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { prepareMeetingAttendance, updateMeetingCorrection, createMeetingCorrection, resolveCurrentMeetingTranscriptSource, publishMeetingTranscription, publishMeetingCorrection, closeMeetingTranscriptPublication, reconcileMeetingTranscriptPublication, reconcileMeetingTranscriptPublicationsBatch } from '../../lib/services/meeting-tracker-transcription/service.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const originalActor = '44444444-4444-4444-8444-444444444444';
const currentActor = '55555555-5555-4555-8555-555555555555';
const predecessor = '66666666-6666-4666-8666-666666666666';
const oldEnv = { access: process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS,
  ready: process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY,
  bundle: process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY };
beforeEach(() => {
  jest.resetAllMocks();
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
});
afterAll(() => {
  for (const [key, value] of [['MEETING_TRACKER_TRANSCRIPTION_ACCESS', oldEnv.access],
    ['MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY', oldEnv.ready],
    ['MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY', oldEnv.bundle]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function fixture(sourceRevisionId = null, presentationEnd = null, sourceProvenance = null) {
  const identity = { requestId, siteVisitActivityId: visitId, revisionId: operationId, operationId, sourceRevisionId, presentationEnd, sourceProvenance };
  const generated = buildMeetingTranscriptFiles({ identity,
    content: { text: 'Synthetic words.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic words.' }] },
    speakerNames: { A: 'Synthetic Chair' } });
  const verifiedFiles = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: `tag-${role}`,
    filename: file.filename, contentType: file.contentType, sha256: file.sha256, size: file.bytes.length,
  }]));
  const candidatePaths = Object.fromEntries(Object.entries(verifiedFiles).map(([role, file]) => [role, `request/${file.filename}`]));
  const receipt = { operation_id: operationId, request_id: requestId, site_visit_activity_id: visitId,
    state: 'unknown', version: 4, source_revision_id: sourceRevisionId,
    lease_expires_at: new Date(Date.now() - 60_000), quarantine_until: new Date(Date.now() - 1),
    frozen_source_provenance: sourceProvenance, frozen_input_sha256: generated.inputSha256, formatter_version: generated.formatterVersion,
    published_by_profile_id: 8, published_by_system_id: originalActor, slot_fence_version: 7,
    verified_files: verifiedFiles, candidate_paths: candidatePaths,
    expected_current_artifact_id: null, expected_current_fingerprint: null,
    presentation_end_ms: presentationEnd ? presentationEnd.endMs : null,
    presentation_end_confirmed_by: presentationEnd ? presentationEnd.confirmedBy : null,
    presentation_end_confirmed_at: presentationEnd ? new Date(presentationEnd.confirmedAt) : null };
  binding.loadMeetingTranscriptionBinding.mockResolvedValue({ requestId, siteVisitActivityId: visitId });
  documents.findByRequest.mockResolvedValue({ records: [] });
  documents.findByGenerationKey.mockResolvedValue({ records: [] });
  store.getMeetingTranscriptPublication.mockResolvedValue(receipt);
  store.claimMeetingTranscriptPublicationForRecovery.mockResolvedValue({ publication: receipt, leaseToken: operationId });
  store.renewMeetingPublicationReceiptLease.mockResolvedValue({ operation_id: operationId });
  store.transitionMeetingTranscriptPublication.mockResolvedValue({ ...receipt, state: 'published' });
  GraphService.downloadFile.mockResolvedValue({ buffer: generated.files.source.bytes });
  publisher.prepareMeetingTranscriptBundlePublication.mockResolvedValue({ candidatePaths });
  publisher.publishMeetingTranscriptBundle.mockResolvedValue({ artifactId: predecessor, manifest: { files: verifiedFiles } });
  return receipt;
}

const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
function confirmedDraft(receipt) {
  receipt.presentation_end_ms = receipt.presentation_end_ms ?? 1000;
  receipt.presentation_end_confirmed_by = 12;
  receipt.presentation_end_confirmed_at = '2026-10-09T18:00:00.000Z';
  receipt.discussion_attribution = { version: 1, rows: [], excludedSpeakerIds: [], attendance: { status: 'unavailable', fetchedAt: '2026-10-09T18:00:00.000Z' } };
  receipt.attendance_review = { id: 'review', decision: receipt.discussion_attribution,
    context: crypto.createHash('sha256').update(stable({ operationId: receipt.operation_id,
      sourceRevisionId: receipt.source_revision_id, fingerprint: receipt.expected_current_fingerprint,
      sourceProvenance: receipt.frozen_source_provenance, endMs: receipt.presentation_end_ms,
      speakerNames: receipt.speaker_names })).digest('hex') };
  return receipt;
}

describe.each(['job', 'correction'])('%s publication catch boundary', kind => {
  test.each(['closed', 'unproven', 'proof-error', 'other-slot', 'release-error'])('%s retains the original error and fences release', async outcome => {
    const receipt = fixture();
    const content = { text: 'Synthetic words.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic words.' }] };
    store.getMeetingTranscriptionJob.mockResolvedValue({ id: predecessor, status: 'ready', version: 4,
      expires_at: new Date(Date.now() + 60_000), speaker_names: {} });
    getMeetingTranscriptionJobContent.mockResolvedValue({ content });
    store.freezeMeetingPublicationFromJob.mockResolvedValue({ jobLeaseToken: currentActor, jobVersion: 5 });
    store.freezeMeetingTranscriptCorrectionDraft.mockResolvedValue({ leaseToken: currentActor });
    if (kind === 'correction') {
      const files = receipt.verified_files;
      const manifest = buildMeetingTranscriptManifest({ identity: { requestId, siteVisitActivityId: visitId,
        revisionId: operationId, operationId, sourceRevisionId: null }, files });
      documents.findByRequest.mockResolvedValue({ records: [{
        wmkf_requestdocumentid: predecessor, _wmkf_request_value: requestId,
        wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_producer: 'meeting-tracker-post-presentation', wmkf_inputfingerprint: receipt.frozen_input_sha256,
        wmkf_transcriptbundlejson: JSON.stringify(manifest), wmkf_sharepointsiteid: 'site',
        wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: '1',
        wmkf_sharepointetag: 'tag-txt', wmkf_filename: files.txt.filename,
        wmkf_contenttype: files.txt.contentType, wmkf_contenthash: files.txt.sha256, wmkf_filesize: files.txt.size,
        wmkf_slotversion: 7, createdon: '2026-09-25T12:00:00Z',
      }] });
      store.getMeetingTranscriptPublication.mockResolvedValue(confirmedDraft({ ...receipt, operation_id: originalActor,
        state: 'draft', expires_at: new Date(Date.now() + 60_000), source_artifact_id: predecessor,
        source_revision_id: operationId, expected_current_artifact_id: predecessor,
        expected_current_fingerprint: receipt.frozen_input_sha256, speaker_names: {} }));
      GraphService.getFileMetadataById.mockResolvedValue({ eTag: files.source.eTag, versionId: files.source.versionId });
      binding.getMeetingTranscriptionCandidates.mockResolvedValue({ candidates: [] });
    }
    const failure = Object.assign(new Error('Synthetic publication failed'), { code: 'synthetic_publish_failure' });
    publisher.publishMeetingTranscriptBundle.mockRejectedValue(failure);
    if (outcome === 'proof-error') store.closeMeetingPublicationWithoutWrites.mockRejectedValue(new Error('proof unavailable'));
    else store.closeMeetingPublicationWithoutWrites.mockResolvedValue(outcome === 'unproven' ? null : { state: 'closed' });
    slots.getPresentationSlotLease.mockImplementation(async () => ({
      lease_token: outcome === 'other-slot' ? requestId : publisher.publishMeetingTranscriptBundle.mock.calls[0][0].operationId,
      fence_version: 7,
    }));
    if (outcome === 'release-error') slots.releasePresentationSlotLease.mockRejectedValue(new Error('release failed'));
    const args = { requestId, ownerProfileId: 12, actingUserSystemId: currentActor,
      jobId: predecessor, operationId: originalActor, body: { expectedVersion: 4 } };
    await expect(kind === 'job' ? publishMeetingTranscription(args) : publishMeetingCorrection(args)).rejects.toBe(failure);
    const attemptedId = publisher.publishMeetingTranscriptBundle.mock.calls[0][0].operationId;
    expect(store.closeMeetingPublicationWithoutWrites).toHaveBeenCalledWith(expect.objectContaining({
      operationId: attemptedId, leaseToken: currentActor, actorProfileId: 12,
    }));
    if (['unproven', 'proof-error'].includes(outcome)) {
      expect(store.transitionMeetingTranscriptPublication).toHaveBeenCalledWith(expect.objectContaining({
        operationId: attemptedId, state: 'unknown', leaseToken: currentActor, errorCode: failure.code,
      }));
      expect(slots.getPresentationSlotLease).not.toHaveBeenCalled();
      expect(slots.releasePresentationSlotLease).not.toHaveBeenCalled();
    } else {
      expect(store.transitionMeetingTranscriptPublication).not.toHaveBeenCalled();
      if (outcome === 'other-slot') expect(slots.releasePresentationSlotLease).not.toHaveBeenCalled();
      else {
        expect(slots.releasePresentationSlotLease).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: attemptedId, fenceVersion: 7 }));
        expect(store.closeMeetingPublicationWithoutWrites.mock.invocationCallOrder[0])
          .toBeLessThan(slots.releasePresentationSlotLease.mock.invocationCallOrder[0]);
      }
    }
  });
});

test.each([null, predecessor])('another authorized staff member recovers exact frozen revision; predecessor=%s', async sourceRevisionId => {
  const receipt = fixture(sourceRevisionId);
  const result = await reconcileMeetingTranscriptPublication({ requestId, operationId,
    actorProfileId: 12, actingUserSystemId: currentActor });
  expect(result).toMatchObject({ resumed: true, requiresAttention: false });
  expect(publisher.publishMeetingTranscriptBundle).toHaveBeenCalledWith(expect.objectContaining({
    actorProfileId: 12, actingUserSystemId: currentActor, operationId,
    identity: expect.objectContaining({ revisionId: operationId, sourceRevisionId }),
    frozenInputSha256: receipt.frozen_input_sha256, originalSlotFenceVersion: 7,
    resumeVerifiedFiles: receipt.verified_files,
  }));
  expect(GraphService.downloadFile).toHaveBeenCalledWith('drive', 'source', { maxBytes: 4_000_000 });
  expect(receipt.published_by_system_id).toBe(originalActor);
});

const boundary = { endMs: 1000, confirmedBy: 12, confirmedAt: '2026-10-05T12:00:00.000Z' };

test('recovery rebuilds a current-version bundle from the receipt-frozen presentation end', async () => {
  const receipt = fixture(null, boundary);
  const result = await reconcileMeetingTranscriptPublication({ requestId, operationId,
    actorProfileId: 12, actingUserSystemId: currentActor });
  expect(result).toMatchObject({ resumed: true, requiresAttention: false });
  expect(receipt.formatter_version).toBe('7');
  expect(publisher.publishMeetingTranscriptBundle).toHaveBeenCalledWith(expect.objectContaining({
    frozenInputSha256: receipt.frozen_input_sha256,
    identity: expect.objectContaining({ presentationEnd: boundary }),
  }));
});

test.each([
  ['receipt has no boundary but the source does', receipt => {
    receipt.presentation_end_ms = null; receipt.presentation_end_confirmed_by = null;
    receipt.presentation_end_confirmed_at = null;
  }],
  ['receipt boundary ms differs from the source', receipt => { receipt.presentation_end_ms = 999; }],
  ['receipt confirmer differs from the source', receipt => { receipt.presentation_end_confirmed_by = 13; }],
  ['receipt confirmation instant differs from the source', receipt => {
    receipt.presentation_end_confirmed_at = new Date('2026-10-05T12:00:01.000Z');
  }],
])('recovery fails closed when %s', async (_label, mutate) => {
  const receipt = fixture(null, boundary);
  mutate(receipt);
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor })).rejects.toMatchObject({ code: 'meeting_transcript_source_integrity_failed' });
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
  expect(store.transitionMeetingTranscriptPublication).toHaveBeenCalledWith(expect.objectContaining({
    state: 'unknown', errorCode: 'meeting_transcript_source_integrity_failed',
  }));
});

test('recovery fails closed when the receipt carries a boundary the source lacks', async () => {
  const receipt = fixture(null, null);
  receipt.presentation_end_ms = 1000; receipt.presentation_end_confirmed_by = 12;
  receipt.presentation_end_confirmed_at = new Date(boundary.confirmedAt);
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor })).rejects.toMatchObject({ code: 'meeting_transcript_source_integrity_failed' });
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});

test('maintenance never resumes a missing registry row using stored publisher identity', async () => {
  fixture();
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, maintenance: true }))
    .resolves.toMatchObject({ requiresAttention: true, reason: 'registry_row_not_found' });
  expect(store.claimMeetingTranscriptPublicationForRecovery).not.toHaveBeenCalled();
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});

test('missing current profile is rejected and missing mapped actor cannot claim recovery', async () => {
  fixture();
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actingUserSystemId: currentActor }))
    .rejects.toMatchObject({ code: 'profile_required' });
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12 }))
    .resolves.toMatchObject({ requiresAttention: true });
  expect(store.claimMeetingTranscriptPublicationForRecovery).not.toHaveBeenCalled();
});

test('an incomplete persisted file set stays retained without trying publication', async () => {
  const receipt = fixture();
  delete receipt.verified_files.vtt;
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor })).resolves.toMatchObject({ requiresAttention: true });
  expect(store.claimMeetingTranscriptPublicationForRecovery).not.toHaveBeenCalled();
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});

test('source-read failure after the recovery claim records unknown and never writes the registry', async () => {
  fixture();
  GraphService.downloadFile.mockRejectedValue(new Error('synthetic network failure'));
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor })).rejects.toThrow('synthetic network failure');
  expect(store.transitionMeetingTranscriptPublication).toHaveBeenCalledWith(expect.objectContaining({
    operationId, expectedState: 'publishing', state: 'unknown', leaseToken: operationId,
  }));
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});

test('an unknown receipt with its original lease still active cannot immediately resume', async () => {
  fixture();
  store.claimMeetingTranscriptPublicationForRecovery.mockResolvedValueOnce(null);
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor })).rejects.toMatchObject({ code: 'meeting_transcript_publication_busy', httpStatus: 409 });
  expect(store.claimMeetingTranscriptPublicationForRecovery).toHaveBeenCalledTimes(1);
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});

test('close is denied before quarantine, refuses ambiguous generation lookup, and closes only after exact zero match', async () => {
  const receipt = fixture();
  receipt.quarantine_until = new Date(Date.now() + 60_000);
  await expect(closeMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    acknowledgeRetainedFiles: true })).rejects.toMatchObject({ code: 'meeting_transcript_publication_quarantine_active' });
  expect(store.closeMeetingPublicationAfterQuarantine).not.toHaveBeenCalled();

  receipt.quarantine_until = new Date(Date.now() - 1);
  documents.findByGenerationKey.mockResolvedValueOnce({ records: [{ id: 'row-a' }, { id: 'row-b' }] });
  documents.findByGenerationKey.mockResolvedValueOnce({ records: [{ id: 'row-a' }, { id: 'row-b' }] });
  await expect(closeMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    acknowledgeRetainedFiles: true })).resolves.toMatchObject({ requiresAttention: true, reason: 'ambiguous_registry_binding' });
  expect(store.closeMeetingPublicationAfterQuarantine).not.toHaveBeenCalled();

  documents.findByGenerationKey.mockResolvedValueOnce({ records: [] });
  store.closeMeetingPublicationAfterQuarantine.mockResolvedValueOnce({ ...receipt, state: 'closed', version: 5 });
  await expect(closeMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    acknowledgeRetainedFiles: true })).resolves.toMatchObject({ closed: true, retainedFiles: true,
    publication: { state: 'closed' } });
  expect(store.closeMeetingPublicationAfterQuarantine).toHaveBeenCalledWith({ operationId, requestId,
    siteVisitActivityId: visitId, expectedVersion: receipt.version, actorProfileId: 12,
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT });
});

test.each([false, true])('registered receipt checks source decision before supersession (mismatch=%s)', async mismatch => {
  const receipt = fixture();
  const generated = buildMeetingTranscriptFiles({ identity: { requestId, siteVisitActivityId: visitId,
    revisionId: operationId, operationId, sourceRevisionId: null },
  content: { text: 'Synthetic words.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic words.' }] },
  speakerNames: { A: 'Synthetic Chair' } });
  const identity = { requestId, siteVisitActivityId: visitId, revisionId: operationId, operationId, sourceRevisionId: null };
  const files = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: `version-${role}`, eTag: `etag-${role}`,
    sha256: file.sha256, size: file.bytes.length, filename: file.filename, contentType: file.contentType,
  }]));
  receipt.verified_files = files;
  if (mismatch) {
    identity.presentationEnd = { endMs: 1000, confirmedBy: 12, confirmedAt: '2026-10-09T18:00:00Z' };
    identity.discussionAttribution = { version: 1, rows: [], excludedSpeakerIds: [], attendance: { status: 'complete', fetchedAt: '2026-10-09T18:00:00Z' } };
    receipt.frozen_discussion_attribution = identity.discussionAttribution;
  }
  const manifest = buildMeetingTranscriptManifest({ identity, files });
  const committed = { wmkf_requestdocumentid: predecessor, _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation', wmkf_inputfingerprint: receipt.frozen_input_sha256,
    wmkf_transcriptbundlejson: JSON.stringify(manifest), wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: 'version-txt',
    wmkf_sharepointetag: 'etag-txt', wmkf_sharepointfolderpath: 'request', wmkf_filename: files.txt.filename,
    wmkf_contenttype: files.txt.contentType, wmkf_contenthash: files.txt.sha256, wmkf_filesize: files.txt.size,
    wmkf_slotversion: 7, createdon: '2026-09-25T12:00:00Z' };
  const newerWinner = { ...committed, wmkf_requestdocumentid: '77777777-7777-4777-8777-777777777777',
    wmkf_filename: 'newer.txt', wmkf_sharepointitemid: 'newer', wmkf_contenthash: 'b'.repeat(64), wmkf_slotversion: 8 };
  documents.findByGenerationKey.mockResolvedValueOnce({ records: [committed] });
  documents.findByRequest.mockResolvedValueOnce({ records: [newerWinner] });
  GraphService.getFileMetadataById.mockImplementation(async (_drive, id) => ({
    name: files[id].filename, size: files[id].size, eTag: files[id].eTag, versionId: files[id].versionId,
  }));
  GraphService.downloadFile.mockImplementation(async (_drive, id) => ({ buffer: generated.files[id].bytes }));
  store.transitionMeetingTranscriptPublication.mockResolvedValueOnce({ ...receipt, state: 'published', error_code: 'publication_superseded' });
  const result = await reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12,
    actingUserSystemId: currentActor });
  if (mismatch) {
    expect(result).toMatchObject({ requiresAttention: true, reason: 'source_identity_mismatch' });
    expect(store.transitionMeetingTranscriptPublication).not.toHaveBeenCalled();
    return;
  }
  expect(result).toMatchObject({ publication: { state: 'published', errorCode: 'publication_superseded' },
    currentArtifact: { id: newerWinner.wmkf_requestdocumentid }, superseded: true, requiresAttention: false });
  expect(store.transitionMeetingTranscriptPublication).toHaveBeenCalledWith(expect.objectContaining({
    expectedState: 'unknown', state: 'published', errorCode: 'publication_superseded',
  }));
});

test('daily reconciliation skips before touching publication tables when schema is unavailable', async () => {
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'off';
  await expect(reconcileMeetingTranscriptPublicationsBatch({ limit: 20 })).resolves.toEqual({
    skipped: 'schema_not_ready', checked: 0, reconciled: 0, attention: 0,
  });
  expect(store.expireMeetingTranscriptCorrectionDrafts).not.toHaveBeenCalled();
  expect(store.listUnresolvedMeetingTranscriptPublications).not.toHaveBeenCalled();
});

test('daily checks rotate twenty persistent-attention receipts so the twenty-first is not starved', async () => {
  const base = fixture();
  const receipts = Array.from({ length: 21 }, (_, index) => ({ ...base, order: index,
    operation_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}` }));
  let nextOrder = 21;
  store.expireMeetingTranscriptCorrectionDrafts.mockResolvedValue([]);
  store.listUnresolvedMeetingTranscriptPublications.mockImplementation(async ({ limit }) =>
    [...receipts].sort((a, b) => a.order - b.order).slice(0, limit));
  store.getMeetingTranscriptPublication.mockImplementation(async ({ operationId: id }) =>
    receipts.find(row => row.operation_id === id));
  store.markMeetingTranscriptPublicationChecked.mockImplementation(async ({ operationId: id, state, expectedVersion }) => {
    const row = receipts.find(item => item.operation_id === id);
    expect(state).toBe(row.state);
    expect(expectedVersion).toBe(row.version);
    row.order = nextOrder++;
    return row;
  });
  await expect(reconcileMeetingTranscriptPublicationsBatch({ limit: 20 })).resolves.toMatchObject({ checked: 20, attention: 20 });
  expect(store.getMeetingTranscriptPublication).not.toHaveBeenCalledWith(expect.objectContaining({ operationId: receipts[20].operation_id }));
  await expect(reconcileMeetingTranscriptPublicationsBatch({ limit: 20 })).resolves.toMatchObject({ checked: 20, attention: 20 });
  expect(store.getMeetingTranscriptPublication).toHaveBeenCalledWith(expect.objectContaining({ operationId: receipts[20].operation_id }));
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});


const uploadProvenance = { version: 1, sourceId: predecessor, kind: 'upload', audioSha256: 'a'.repeat(64),
  audioBytes: 100, audioDurationMs: 1000, zoom: null };

test('recovery retains provenance without needing the expired original job', async () => {
  fixture(predecessor, boundary, uploadProvenance);
  await reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12, actingUserSystemId: currentActor });
  expect(publisher.publishMeetingTranscriptBundle).toHaveBeenCalledWith(expect.objectContaining({
    identity: expect.objectContaining({ sourceProvenance: uploadProvenance }),
  }));
  expect(store.getMeetingTranscriptionJob).not.toHaveBeenCalled();
});

test('recovery rejects a source/receipt provenance mismatch before registration', async () => {
  const receipt = fixture(predecessor, boundary, uploadProvenance);
  receipt.frozen_source_provenance = { ...uploadProvenance, audioSha256: 'b'.repeat(64) };
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId,
    actorProfileId: 12, actingUserSystemId: currentActor })).rejects.toThrow('invalid_transcript_bundle');
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});


function bindCurrentFixture(sourceProvenance) {
  const receipt = fixture(null, boundary, sourceProvenance);
  receipt.state = 'published';
  receipt.resulting_document_id = predecessor;
  const files = receipt.verified_files;
  const manifest = buildMeetingTranscriptManifest({ identity: { requestId, siteVisitActivityId: visitId,
    revisionId: operationId, operationId, presentationEnd: boundary, sourceProvenance }, files });
  const row = { wmkf_requestdocumentid: predecessor, _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation', wmkf_inputfingerprint: receipt.frozen_input_sha256,
    wmkf_transcriptbundlejson: JSON.stringify(manifest), wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: '1',
    wmkf_sharepointetag: 'tag-txt', wmkf_filename: files.txt.filename,
    wmkf_contenttype: files.txt.contentType, wmkf_contenthash: files.txt.sha256, wmkf_filesize: files.txt.size,
    wmkf_slotversion: 7, createdon: '2026-09-25T12:00:00Z' };
  documents.findByRequest.mockResolvedValue({ records: [row] });
  return row;
}

test('Stage 4 resolver returns verified current source and boundary, never a newest-import guess', async () => {
  bindCurrentFixture(uploadProvenance);
  await expect(resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId: 12 })).resolves.toMatchObject({
    status: 'upload', provenance: uploadProvenance, revisionId: operationId, presentationEnd: boundary,
  });
});

test('Stage 4 resolver rejects a current revision change during source read', async () => {
  const row = bindCurrentFixture(uploadProvenance);
  documents.findByRequest.mockResolvedValueOnce({ records: [row] }).mockResolvedValueOnce({ records: [row] })
    .mockResolvedValue({ records: [{ ...row, wmkf_inputfingerprint: 'f'.repeat(64) }] });
  await expect(resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId: 12 })).rejects.toMatchObject({ code: 'meeting_transcript_current_changed' });
});

test('Stage 4 resolver distinguishes a malformed manifest from missing legacy provenance', async () => {
  const row = bindCurrentFixture(null);
  await expect(resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId: 12 })).resolves.toMatchObject({ status: 'legacy_unknown' });
  documents.findByRequest.mockResolvedValue({ records: [{ ...row, wmkf_transcriptbundlejson: '{invalid' }] });
  await expect(resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId: 12 })).resolves.toMatchObject({ status: 'invalid' });
});


test('Zoom provenance survives real service publish, names correction and recovery with string BIGINT rows', async () => {
  const baseRow = bindCurrentFixture(null);
  let current = null;
  const receipts = new Map();
  const blobs = new Map();
  const descriptors = new Map();
  let lastPublication;
  const zoomJob = { id: predecessor, status: 'ready', version: 4, expires_at: new Date(Date.now() + 60000),
    speaker_names: { A: 'Original name' }, verified_bytes: '5', audio_duration_ms: '1000', audio_sha256: 'a'.repeat(64) };
  getZoomImportForJob.mockResolvedValue({ id: originalActor, zoom_meeting_uuid: 'exact-occurrence==', zoom_host_id: 'host',
    selected_recording_files: { version: 1, audioOnlyFileCount: 1, transcriptFile: null,
      audioFile: { fileId: 'exact-audio', recordingType: 'audio_only', bytes: 5, sha256: 'a'.repeat(64),
        recordingStart: '2026-10-09T00:00:00Z', recordingEnd: '2026-10-09T00:00:01Z' } } });
  store.getMeetingTranscriptionJob.mockResolvedValueOnce(zoomJob).mockResolvedValue(null);
  getMeetingTranscriptionJobContent.mockResolvedValue({ content: { text: 'Synthetic.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic.' }] } });
  documents.findByRequest.mockImplementation(async () => ({ records: current ? [current] : [] }));
  GraphService.downloadFile.mockImplementation(async (_drive, item) => ({ buffer: blobs.get(item) }));
  GraphService.getFileMetadataById.mockImplementation(async (_drive, item) => descriptors.get(item));
  binding.getMeetingTranscriptionCandidates.mockResolvedValue({ candidates: [] });
  store.getMeetingTranscriptPublication.mockImplementation(async ({ operationId: op }) => receipts.get(op));
  store.freezeMeetingPublicationFromJob.mockImplementation(async args => {
    receipts.set(args.operationId, { operation_id: args.operationId, state: 'publishing', version: 1,
      frozen_source_provenance: args.sourceProvenance, frozen_input_sha256: args.frozenInputSha256,
      formatter_version: args.formatterVersion });
    return { jobLeaseToken: args.operationId, jobVersion: 5 };
  });
  store.closeMeetingPublicationJobLease.mockResolvedValue({ version: 6 });
  store.transitionMeetingTranscriptPublication.mockImplementation(async args => {
    const receipt = receipts.get(args.operationId);
    Object.assign(receipt, { state: args.state, resulting_document_id: args.resultingDocumentId, verified_files: args.verifiedFiles });
    return receipt;
  });
  publisher.publishMeetingTranscriptBundle.mockImplementation(async args => {
    lastPublication = args;
    if (args.resumeVerifiedFiles) return { artifactId: args.operationId, fingerprint: args.frozenInputSha256, manifest: { files: args.resumeVerifiedFiles } };
    const files = Object.fromEntries(Object.entries(args.files).map(([role, file]) => {
      const itemId = `${args.operationId}-${role}`;
      const d = { siteId: 'site', driveId: 'drive', itemId, versionId: '1', eTag: itemId,
        filename: file.filename, contentType: file.contentType, size: file.bytes.length, sha256: file.sha256 };
      blobs.set(itemId, file.bytes); descriptors.set(itemId, { ...d, name: d.filename }); return [role, d];
    }));
    const manifest = buildMeetingTranscriptManifest({ identity: args.identity, files });
    current = { ...baseRow, wmkf_requestdocumentid: args.operationId, wmkf_inputfingerprint: args.frozenInputSha256,
      wmkf_transcriptbundlejson: JSON.stringify(manifest), wmkf_sharepointitemid: files.txt.itemId,
      wmkf_sharepointetag: files.txt.eTag, wmkf_filename: files.txt.filename, wmkf_filesize: files.txt.size,
      wmkf_contenthash: files.txt.sha256 };
    const receipt = receipts.get(args.operationId);
    Object.assign(receipt, { verified_files: files, slot_fence_version: 7,
      candidate_paths: Object.fromEntries(Object.entries(files).map(([role, d]) => [role, `request/${d.filename}`])) });
    return { artifactId: current.wmkf_requestdocumentid, fingerprint: args.frozenInputSha256, manifest };
  });
  const first = await publishMeetingTranscription({ requestId, ownerProfileId: 12, actingUserSystemId: currentActor,
    jobId: predecessor, body: { expectedVersion: 4 } });
  const firstProvenance = receipts.get(first.publication.operationId).frozen_source_provenance;
  expect(firstProvenance).toMatchObject({ kind: 'zoom', audioBytes: 5, audioDurationMs: 1000, zoom: { meetingUuid: 'exact-occurrence==' } });
  store.createMeetingTranscriptCorrectionDraft.mockImplementation(async args => {
    const receipt = { operation_id: args.operationId, state: 'draft', version: 1, expires_at: args.expiresAt,
      source_artifact_id: args.sourceArtifactId, source_revision_id: args.sourceRevisionId,
      expected_current_artifact_id: args.expectedCurrentArtifactId, expected_current_fingerprint: args.expectedCurrentFingerprint,
      speaker_names: args.speakerNames, frozen_source_provenance: args.sourceProvenance };
    receipts.set(args.operationId, receipt); return receipt;
  });
  const draft = await createMeetingCorrection({ requestId, ownerProfileId: 12, artifactId: first.currentArtifact.id });
  const correction = receipts.get(draft.correction.operationId);
  correction.speaker_names = { A: 'Corrected name' };
  confirmedDraft(correction);
  store.freezeMeetingTranscriptCorrectionDraft.mockImplementation(async args => {
    Object.assign(correction, { frozen_discussion_attribution: correction.discussion_attribution, state: 'publishing', formatter_version: args.formatterVersion, frozen_input_sha256: args.frozenInputSha256 });
    return { leaseToken: args.operationId, publication: correction };
  });
  await publishMeetingCorrection({ requestId, ownerProfileId: 12, actingUserSystemId: currentActor,
    operationId: correction.operation_id, body: { expectedVersion: 1 } });
  expect(lastPublication.identity.sourceProvenance).toEqual(firstProvenance);
  expect(lastPublication.identity.revisionId).not.toBe(first.publication.operationId);
  expect(lastPublication.files.txt.bytes.toString()).toContain('Corrected name');
  // Simulate registry loss after all files were recorded; recovery must use this revision's frozen evidence.
  correction.state = 'unknown'; correction.lease_expires_at = null;
  store.claimMeetingTranscriptPublicationForRecovery.mockResolvedValue({ publication: correction, leaseToken: correction.operation_id });
  const result = await reconcileMeetingTranscriptPublication({ requestId, operationId: correction.operation_id,
    actorProfileId: 12, actingUserSystemId: currentActor });
  expect(result).toMatchObject({ resumed: true, requiresAttention: false });
  expect(lastPublication.identity.sourceProvenance).toEqual(firstProvenance);
  expect(blobs.get(correction.verified_files.txt.itemId).toString()).toContain('Corrected name');
  expect(getZoomImportForJob).toHaveBeenCalledTimes(1);
});


test('Stage 4 resolver requires an authenticated actor and a matching published receipt', async () => {
  bindCurrentFixture(uploadProvenance);
  await expect(resolveCurrentMeetingTranscriptSource({ requestId })).rejects.toThrow();
  store.getMeetingTranscriptPublication.mockResolvedValue({ state: 'published', frozen_source_provenance: uploadProvenance });
  await expect(resolveCurrentMeetingTranscriptSource({ requestId, actorProfileId: 12 })).resolves.toMatchObject({ status: 'invalid', reason: 'publication_receipt_mismatch' });
});


function editableAttendanceFixture() {
  const row = bindCurrentFixture(null);
  const receipt = confirmedDraft({ operation_id: originalActor, request_id: requestId, site_visit_activity_id: visitId,
    state: 'draft', version: 4, expires_at: new Date(Date.now() + 60000), source_artifact_id: predecessor,
    source_revision_id: operationId, expected_current_artifact_id: predecessor,
    expected_current_fingerprint: row.wmkf_inputfingerprint, speaker_names: { A: 'Synthetic Chair' }, frozen_source_provenance: null });
  receipt.attendance_review = null; receipt.discussion_attribution = null;
  store.getMeetingTranscriptPublication.mockResolvedValue(receipt);
  const manifest = JSON.parse(row.wmkf_transcriptbundlejson);
  GraphService.getFileMetadataById.mockResolvedValue(manifest.files.source);
  binding.getMeetingTranscriptionCandidates.mockResolvedValue({ candidates: [] });
  store.updateMeetingTranscriptCorrectionDraft.mockImplementation(async args => {
    if (args.expectedVersion !== receipt.version) return null;
    if (args.attendanceReview !== undefined) { receipt.attendance_review = args.attendanceReview; receipt.discussion_attribution = null; }
    if (args.discussionAttribution !== undefined) receipt.discussion_attribution = args.discussionAttribution;
    receipt.version += 1;
    return { ...receipt };
  });
  return receipt;
}

test('attendance uses a version-fenced snapshot; stale version and replayed review IDs cannot confirm', async () => {
  const receipt = editableAttendanceFixture();
  const args = { requestId, operationId: originalActor, ownerProfileId: 12 };
  await expect(prepareMeetingAttendance({ ...args, expectedVersion: 3 })).rejects.toMatchObject({ code: 'meeting_transcript_correction_changed' });
  const prepared = await prepareMeetingAttendance({ ...args, expectedVersion: 4 });
  expect(prepared.correction.attendanceReview.decision.attendance.status).toBe('unavailable');
  const confirmation = { reviewId: receipt.attendance_review.id, kept: [] };
  await expect(updateMeetingCorrection({ ...args, body: { expectedVersion: 4, speakerNames: receipt.speaker_names, attendanceConfirmation: confirmation } })).rejects.toMatchObject({ code: 'meeting_transcript_correction_changed' });
  await expect(updateMeetingCorrection({ ...args, body: { expectedVersion: 5, speakerNames: receipt.speaker_names, attendanceConfirmation: { ...confirmation, reviewId: 'old' } } })).rejects.toMatchObject({ code: 'meeting_attendance_confirmation_stale' });
  await updateMeetingCorrection({ ...args, body: { expectedVersion: 5, speakerNames: receipt.speaker_names, attendanceConfirmation: confirmation } });
  expect(receipt.discussion_attribution).toEqual(receipt.attendance_review.decision);
  await expect(updateMeetingCorrection({ ...args, body: { expectedVersion: 5, speakerNames: receipt.speaker_names, attendanceConfirmation: confirmation } })).rejects.toMatchObject({ code: 'meeting_transcript_correction_changed' });
});

test('a rename or boundary change cannot carry a prior confirmation; publish requires current context', async () => {
  const receipt = editableAttendanceFixture();
  const args = { requestId, operationId: originalActor, ownerProfileId: 12 };
  await prepareMeetingAttendance({ ...args, expectedVersion: 4 });
  const attendanceConfirmation = { reviewId: receipt.attendance_review.id, kept: [] };
  await expect(updateMeetingCorrection({ ...args, body: { expectedVersion: 5, speakerNames: { A: 'New name' }, attendanceConfirmation } })).rejects.toMatchObject({ code: 'meeting_attendance_confirmation_stale' });
  await expect(updateMeetingCorrection({ ...args, body: { expectedVersion: 5, speakerNames: receipt.speaker_names, presentationEndMs: null, attendanceConfirmation } })).rejects.toMatchObject({ code: 'meeting_attendance_confirmation_stale' });
  receipt.discussion_attribution = receipt.attendance_review.decision;
  receipt.speaker_names = { A: 'New name' };
  await expect(publishMeetingCorrection({ ...args, actingUserSystemId: currentActor, body: { expectedVersion: 5 } })).rejects.toMatchObject({ code: 'meeting_attendance_confirmation_required' });
  expect(publisher.prepareMeetingTranscriptBundlePublication).not.toHaveBeenCalled();
});

test('recovery rejects a receipt policy mismatch before publication', async () => {
  const receipt = fixture(predecessor, boundary);
  receipt.frozen_discussion_attribution = { version: 1, rows: [], excludedSpeakerIds: [], attendance: { status: 'complete', fetchedAt: '2026-10-09T18:00:00.000Z' } };
  await expect(reconcileMeetingTranscriptPublication({ requestId, operationId, actorProfileId: 12, actingUserSystemId: currentActor })).rejects.toThrow('invalid_transcript_bundle');
  expect(publisher.publishMeetingTranscriptBundle).not.toHaveBeenCalled();
});
