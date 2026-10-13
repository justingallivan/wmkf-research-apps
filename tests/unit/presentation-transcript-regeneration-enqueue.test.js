/** @jest-environment node */
// Site Visit C1: a correction publish queues the presentation and staff discussion transcripts; the overview GET says
// `updating` only for the CURRENT artifact; a failed enqueue never fails the publish; a first publish never queues.
import crypto from 'node:crypto';
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
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({ getMeetingTranscriptionJobContent: jest.fn(), projectMeetingTranscriptionJob: jest.fn(() => ({})) }));
jest.mock('../../lib/services/meeting-tracker-recordings/import-store', () => ({ getZoomImportForJob: jest.fn(async () => null) }));
jest.mock('../../lib/services/meeting-tracker-transcription/test-deployment-policy.js', () => ({
  ...jest.requireActual('../../lib/services/meeting-tracker-transcription/test-deployment-policy.js'),
  getMeetingTranscriptionSupervisedTestPolicy: jest.fn(() => ({ requested: false })),
}));
jest.mock('../../lib/services/transcription-pilot/provider.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => Object.fromEntries([
  'getMeetingTranscriptPublication', 'freezeMeetingTranscriptCorrectionDraft', 'listMeetingTranscriptPublications',
  'listMeetingTranscriptionJobs', 'transitionMeetingTranscriptPublication', 'closeMeetingPublicationWithoutWrites',
  'renewMeetingPublicationReceiptLease', 'recordMeetingPublicationCandidate', 'recordMeetingPublicationSlotFence',
  'getMeetingTranscriptionJob', 'freezeMeetingPublicationFromJob', 'renewMeetingPublicationJobLease', 'closeMeetingPublicationJobLease',
].map(name => [name, jest.fn()])));
jest.mock('../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-store.js', () => ({
  enqueuePresentationTranscriptRegeneration: jest.fn(), listActivePresentationTranscriptRegenerations: jest.fn(),
}));

import * as documents from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import * as publisher from '../../lib/services/post-presentation-materials/material-service.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import * as runtime from '../../lib/services/transcription-pilot/runtime.js';
import { getMeetingTranscriptionSupervisedTestPolicy } from '../../lib/services/meeting-tracker-transcription/test-deployment-policy.js';
import * as regen from '../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-store.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { publishMeetingCorrection, publishMeetingTranscription, getMeetingTranscriptionOverview } from '../../lib/services/meeting-tracker-transcription/service.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const draftId = '44444444-4444-4444-8444-444444444444';
const artifactId = '55555555-5555-4555-8555-555555555555';
const newArtifactId = '88888888-8888-4888-8888-888888888888';
const actor = '77777777-7777-4777-8777-777777777777';
const current = { endMs: 2000, confirmedBy: 8, confirmedAt: '2026-10-04T09:30:00.000Z' };
const content = { text: 'x', utterances: [
  { speaker: 'A', start: 0, end: 1000, text: 'Welcome.' },
  { speaker: 'B', start: 1000, end: 2000, text: 'Our project.' },
  { speaker: 'A', start: 2000, end: 3000, text: 'Discussion.' },
] };
const speakerNames = { A: 'Foundation Staff', B: 'Applicant Lead' };
const oldEnv = { ...process.env };
let generated; let transcriptRow; let errorSpy;

beforeEach(() => {
  jest.resetAllMocks();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  getMeetingTranscriptionSupervisedTestPolicy.mockReturnValue({ requested: false });
  generated = buildMeetingTranscriptFiles({ content, speakerNames,
    identity: { requestId, siteVisitActivityId: visitId, revisionId, operationId: revisionId, sourceRevisionId: null, presentationEnd: current } });
  const descriptors = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: `tag-${role}`,
    filename: file.filename, contentType: file.contentType, sha256: file.sha256, size: file.bytes.length }]));
  const manifest = buildMeetingTranscriptManifest({ identity: { requestId, siteVisitActivityId: visitId, revisionId,
    operationId: revisionId, sourceRevisionId: null, presentationEnd: current }, files: descriptors });
  transcriptRow = { wmkf_requestdocumentid: artifactId, _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_inputfingerprint: generated.inputSha256, wmkf_transcriptbundlejson: JSON.stringify(manifest),
    wmkf_sharepointsiteid: 'site', wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: '1',
    wmkf_sharepointetag: 'tag-txt', wmkf_filename: descriptors.txt.filename, wmkf_contenttype: descriptors.txt.contentType,
    wmkf_contenthash: descriptors.txt.sha256, wmkf_filesize: descriptors.txt.size, wmkf_slotversion: 3, createdon: '2026-10-04T10:00:00Z' };
  binding.loadMeetingTranscriptionBinding.mockResolvedValue({ requestId, siteVisitActivityId: visitId });
  binding.getMeetingTranscriptionCandidates.mockResolvedValue({ candidates: [], candidateSources: {} });
  documents.findByRequest.mockResolvedValue({ records: [transcriptRow] });
  GraphService.downloadFile.mockResolvedValue({ buffer: generated.files.source.bytes });
  GraphService.getFileMetadataById.mockResolvedValue({ eTag: 'tag-source', versionId: '1' });
  store.listMeetingTranscriptionJobs.mockResolvedValue([]);
  store.listMeetingTranscriptPublications.mockResolvedValue([]);
  regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([]);
});
afterEach(() => errorSpy.mockRestore());
afterAll(() => { process.env = oldEnv; });

const stable = value => value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
function readyCorrection() {
  const decision = { version: 1, rows: [], excludedSpeakerIds: [], attendance: { status: 'unavailable', fetchedAt: '2026-10-05T12:00:00.000Z' } };
  const context = crypto.createHash('sha256').update(stable({ operationId: draftId, sourceRevisionId: revisionId,
    fingerprint: generated.inputSha256, sourceProvenance: null, endMs: 2000, speakerNames })).digest('hex');
  store.getMeetingTranscriptPublication.mockResolvedValue({ operation_id: draftId, request_id: requestId, site_visit_activity_id: visitId,
    state: 'draft', version: 2, expires_at: new Date(Date.now() + 60_000), source_artifact_id: artifactId,
    source_revision_id: revisionId, expected_current_artifact_id: artifactId, expected_current_fingerprint: generated.inputSha256,
    speaker_names: speakerNames, presentation_end_ms: 2000, presentation_end_confirmed_by: 8,
    presentation_end_confirmed_at: new Date(current.confirmedAt), discussion_attribution: decision,
    attendance_review: { id: 'review', decision, context } });
  publisher.prepareMeetingTranscriptBundlePublication.mockResolvedValue({ candidatePaths: { txt: 'a', vtt: 'b', source: 'c' } });
  store.freezeMeetingTranscriptCorrectionDraft.mockResolvedValue({ leaseToken: 'lease' });
  publisher.publishMeetingTranscriptBundle.mockResolvedValue({ artifactId: newArtifactId, fingerprint: 'b'.repeat(64),
    manifest: { files: [] }, bundleEditable: true, slotVersion: 9 });
  store.transitionMeetingTranscriptPublication.mockResolvedValue({ state: 'published' });
}
const publish = () => publishMeetingCorrection({ requestId, ownerProfileId: 12, actingUserSystemId: actor, operationId: draftId, body: { expectedVersion: 2 } });

describe('correction publish enqueues generation', () => {
  test('queues the NEW artifact id and fingerprint with the publisher as the stored actor, and says so in the response', async () => {
    readyCorrection();
    regen.enqueuePresentationTranscriptRegeneration.mockResolvedValue({ id: 'row' });
    const result = await publish();
    expect(regen.enqueuePresentationTranscriptRegeneration).toHaveBeenCalledTimes(1);
    expect(regen.enqueuePresentationTranscriptRegeneration).toHaveBeenCalledWith({ requestId, transcriptArtifactId: newArtifactId,
      transcriptFingerprint: 'b'.repeat(64), transcriptSlotVersion: 9, actorProfileId: 12, actingUserSystemId: actor });
    expect(result).toMatchObject({ publication: { state: 'published' }, currentArtifact: { id: newArtifactId, fingerprint: 'b'.repeat(64) }, regenerationQueued: true });
  });

  test('a delayed enqueue that loses to a newer publish (store returns null) still reports queued, and a RUNNING newer row keeps updating keyed on the current artifact', async () => {
    readyCorrection();
    regen.enqueuePresentationTranscriptRegeneration.mockResolvedValue(null);
    expect((await publish()).regenerationQueued).toBe(true);
    // An older artifact's pending row (inserted behind a running row for the current one) never sets updating.
    regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([{ transcript_artifact_id: newArtifactId }, { transcript_artifact_id: artifactId }]);
    const artifact = (await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact;
    expect(artifact.presentationTranscript.updating).toBe(true);
    regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([{ transcript_artifact_id: newArtifactId }]);
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.presentationTranscript).not.toHaveProperty('updating');
  });

  test('enqueues only after the published transition is durable', async () => {
    readyCorrection();
    const order = [];
    store.transitionMeetingTranscriptPublication.mockImplementation(async () => { order.push('published'); return { state: 'published' }; });
    regen.enqueuePresentationTranscriptRegeneration.mockImplementation(async () => { order.push('enqueue'); return { id: 'row' }; });
    await publish();
    expect(order).toEqual(['published', 'enqueue']);
  });

  test('an enqueue failure is logged by code, swallowed, and the publish still succeeds without promising generation', async () => {
    readyCorrection();
    regen.enqueuePresentationTranscriptRegeneration.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const result = await publish();
    expect(result).toMatchObject({ publication: { state: 'published' }, currentArtifact: { id: newArtifactId }, regenerationQueued: false });
    expect(errorSpy).toHaveBeenCalledWith('[meeting tracker transcript auto-generation] enqueue failed:', 'table_not_ready');
    expect(store.closeMeetingPublicationWithoutWrites).not.toHaveBeenCalled();
    expect(store.transitionMeetingTranscriptPublication).toHaveBeenCalledTimes(1);
  });

  test('an unclassified enqueue failure logs a generic code only', async () => {
    readyCorrection();
    regen.enqueuePresentationTranscriptRegeneration.mockRejectedValue(new Error('secret connection string'));
    const result = await publish();
    expect(result.regenerationQueued).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[meeting tracker transcript auto-generation] enqueue failed:', 'enqueue_failed');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret');
  });

  test('a failed publish never enqueues', async () => {
    readyCorrection();
    publisher.publishMeetingTranscriptBundle.mockRejectedValue(Object.assign(new Error('graph down'), { code: 'graph_down' }));
    store.closeMeetingPublicationWithoutWrites.mockResolvedValue(null);
    store.transitionMeetingTranscriptPublication.mockResolvedValue(null);
    await expect(publish()).rejects.toMatchObject({ code: 'graph_down' });
    expect(regen.enqueuePresentationTranscriptRegeneration).not.toHaveBeenCalled();
  });

  test('a supervised test does not queue (the generator would refuse) and does not promise generation', async () => {
    readyCorrection();
    getMeetingTranscriptionSupervisedTestPolicy.mockReturnValue({ requested: true });
    const result = await publish();
    expect(result).toMatchObject({ publication: { state: 'published' }, regenerationQueued: false });
    expect(regen.enqueuePresentationTranscriptRegeneration).not.toHaveBeenCalled();
  });

  test('the first publish of a transcription job succeeds without enqueueing (it carries no confirmed presentation end)', async () => {
    store.getMeetingTranscriptionJob.mockResolvedValue({ id: draftId, status: 'ready', version: 1, expires_at: new Date(Date.now() + 60_000), speaker_names: speakerNames });
    runtime.getMeetingTranscriptionJobContent.mockResolvedValue({ content });
    publisher.prepareMeetingTranscriptBundlePublication.mockResolvedValue({ candidatePaths: { txt: 'a', vtt: 'b', source: 'c' } });
    store.freezeMeetingPublicationFromJob.mockResolvedValue({ jobVersion: 1, jobLeaseToken: 'lease' });
    publisher.publishMeetingTranscriptBundle.mockResolvedValue({ artifactId: newArtifactId, fingerprint: 'b'.repeat(64), manifest: { files: [] } });
    store.closeMeetingPublicationJobLease.mockResolvedValue({ version: 2 });
    store.transitionMeetingTranscriptPublication.mockResolvedValue({ state: 'published' });
    const result = await publishMeetingTranscription({ requestId, ownerProfileId: 12, actingUserSystemId: actor, jobId: draftId,
      body: { expectedVersion: 1, expectedCurrentArtifactId: artifactId, expectedCurrentFingerprint: generated.inputSha256 } });
    expect(result.publication.state).toBe('published');
    expect(result).not.toHaveProperty('regenerationQueued');
    expect(regen.enqueuePresentationTranscriptRegeneration).not.toHaveBeenCalled();
  });
});

describe('overview reports updating only for the current artifact', () => {
  const overview = async () => (await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact;

  test('a pending or running row for the current artifact sets updating on both halves (case-insensitive id)', async () => {
    regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([{ transcript_artifact_id: artifactId.toUpperCase() }]);
    const artifact = await overview();
    expect(regen.listActivePresentationTranscriptRegenerations).toHaveBeenCalledWith({ requestId });
    expect(artifact.presentationTranscript).toMatchObject({ state: 'missing', updating: true });
    expect(artifact.staffDiscussionTranscript).toMatchObject({ state: 'missing', updating: true });
  });

  test('a row queued for an OLDER artifact does not set updating', async () => {
    regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([{ transcript_artifact_id: newArtifactId }]);
    const artifact = await overview();
    expect(artifact.presentationTranscript).not.toHaveProperty('updating');
    expect(artifact.staffDiscussionTranscript).not.toHaveProperty('updating');
  });

  test('no active row (done, failed and superseded rows are never listed) leaves updating absent', async () => {
    regen.listActivePresentationTranscriptRegenerations.mockResolvedValue([]);
    const artifact = await overview();
    expect(artifact.presentationTranscript).toEqual({ state: 'missing', artifactId: null });
    expect(artifact.staffDiscussionTranscript).toEqual({ state: 'missing', artifactId: null });
  });

  test('a failed status read (table missing or database down) means not updating and never fails the GET', async () => {
    regen.listActivePresentationTranscriptRegenerations.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    expect((await overview()).presentationTranscript).not.toHaveProperty('updating');
    expect(errorSpy).not.toHaveBeenCalled();
    regen.listActivePresentationTranscriptRegenerations.mockRejectedValue(new Error('down'));
    expect((await overview()).presentationTranscript).not.toHaveProperty('updating');
    expect(errorSpy).toHaveBeenCalledWith('[meeting tracker transcript auto-generation] status read failed:', 'read_failed');
  });
});
