/** @jest-environment node */
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
  'getMeetingTranscriptPublication', 'claimMeetingTranscriptPublicationForRecovery',
  'renewMeetingPublicationReceiptLease', 'transitionMeetingTranscriptPublication',
  'expireMeetingTranscriptCorrectionDrafts', 'listUnresolvedMeetingTranscriptPublications',
  'markMeetingTranscriptPublicationChecked', 'closeMeetingPublicationAfterQuarantine',
  'getMeetingTranscriptionJob', 'freezeMeetingPublicationFromJob', 'freezeMeetingTranscriptCorrectionDraft',
  'closeMeetingPublicationWithoutWrites',
].map(name => [name, jest.fn()])));

import * as documents from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import * as publisher from '../../lib/services/post-presentation-materials/material-service.js';
import * as slots from '../../lib/services/post-presentation-materials/slot-lease-store.js';
import { getMeetingTranscriptionJobContent } from '../../lib/services/transcription-pilot/runtime.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { publishMeetingTranscription, publishMeetingCorrection, closeMeetingTranscriptPublication, reconcileMeetingTranscriptPublication, reconcileMeetingTranscriptPublicationsBatch } from '../../lib/services/meeting-tracker-transcription/service.js';

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

function fixture(sourceRevisionId = null) {
  const identity = { requestId, siteVisitActivityId: visitId, revisionId: operationId, operationId, sourceRevisionId };
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
    frozen_input_sha256: generated.inputSha256, formatter_version: generated.formatterVersion,
    published_by_profile_id: 8, published_by_system_id: originalActor, slot_fence_version: 7,
    verified_files: verifiedFiles, candidate_paths: candidatePaths,
    expected_current_artifact_id: null, expected_current_fingerprint: null };
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
      store.getMeetingTranscriptPublication.mockResolvedValue({ ...receipt, operation_id: originalActor,
        state: 'draft', expires_at: new Date(Date.now() + 60_000), source_artifact_id: predecessor,
        source_revision_id: operationId, expected_current_artifact_id: predecessor,
        expected_current_fingerprint: receipt.frozen_input_sha256, speaker_names: {} });
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

test('a verified committed receipt superseded by a newer winner becomes terminal without replacing it', async () => {
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
