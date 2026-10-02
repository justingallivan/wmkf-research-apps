/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequest: jest.fn(), findByGenerationKey: jest.fn() }));
jest.mock('../../lib/services/graph-service.js', () => ({ GraphService: { downloadFile: jest.fn() } }));
jest.mock('../../lib/services/post-presentation-materials/material-service.js', () => ({
  prepareMeetingTranscriptBundlePublication: jest.fn(), publishMeetingTranscriptBundle: jest.fn(),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/binding.js', () => ({
  loadMeetingTranscriptionBinding: jest.fn(), getMeetingTranscriptionCandidates: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/provider.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => Object.fromEntries([
  'getMeetingTranscriptPublication', 'claimMeetingTranscriptPublicationForRecovery',
  'renewMeetingPublicationReceiptLease', 'transitionMeetingTranscriptPublication',
  'expireMeetingTranscriptCorrectionDrafts', 'listUnresolvedMeetingTranscriptPublications',
  'markMeetingTranscriptPublicationChecked',
].map(name => [name, jest.fn()])));

import * as documents from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import * as publisher from '../../lib/services/post-presentation-materials/material-service.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import { buildMeetingTranscriptFiles } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { reconcileMeetingTranscriptPublication, reconcileMeetingTranscriptPublicationsBatch } from '../../lib/services/meeting-tracker-transcription/service.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const originalActor = '44444444-4444-4444-8444-444444444444';
const currentActor = '55555555-5555-4555-8555-555555555555';
const predecessor = '66666666-6666-4666-8666-666666666666';
const oldEnv = { access: process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS,
  ready: process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY };
beforeEach(() => {
  jest.resetAllMocks();
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
});
afterAll(() => {
  for (const [key, value] of [['MEETING_TRACKER_TRANSCRIPTION_ACCESS', oldEnv.access],
    ['MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY', oldEnv.ready]]) {
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
