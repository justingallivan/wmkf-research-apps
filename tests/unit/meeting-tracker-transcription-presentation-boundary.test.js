/** @jest-environment node */
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
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({ getMeetingTranscriptionJobContent: jest.fn(), projectMeetingTranscriptionJob: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/provider.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch.js', () => ({}));
jest.mock('../../lib/services/transcription-pilot/store.js', () => Object.fromEntries([
  'getMeetingTranscriptPublication', 'createMeetingTranscriptCorrectionDraft', 'updateMeetingTranscriptCorrectionDraft',
  'freezeMeetingTranscriptCorrectionDraft', 'listMeetingTranscriptPublications', 'listMeetingTranscriptionJobs',
].map(name => [name, jest.fn()])));

import * as documents from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import * as publisher from '../../lib/services/post-presentation-materials/material-service.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import * as store from '../../lib/services/transcription-pilot/store.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { presentationTranscriptGenerationKey, staffDiscussionTranscriptGenerationKey, transcriptSummaryBindingFingerprint,
  staffDiscussionSummaryBindingFingerprint } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { getMeetingCorrectionDraft, createMeetingCorrection, updateMeetingCorrection, publishMeetingCorrection,
  getMeetingTranscriptionOverview } from '../../lib/services/meeting-tracker-transcription/service.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const revisionId = '33333333-3333-4333-8333-333333333333';
const draftId = '44444444-4444-4444-8444-444444444444';
const artifactId = '55555555-5555-4555-8555-555555555555';
const presentationId = '66666666-6666-4666-8666-666666666666';
const actor = '77777777-7777-4777-8777-777777777777';
const current = { endMs: 2000, confirmedBy: 8, confirmedAt: '2026-10-04T09:30:00.000Z' };
const content = { text: 'x', utterances: [
  { speaker: 'A', start: 0, end: 1000, text: 'Welcome.' },
  { speaker: 'B', start: 1000, end: 2000, text: 'Our project.' },
  { speaker: 'A', start: 2000, end: 3000, text: 'Discussion.' },
] };
const speakerNames = { A: 'Foundation Staff', B: 'Applicant Lead' };
const candidates = [
  { id: 'attendee:staff:1', source: 'saved_staff', displayName: 'Foundation Staff' },
  { id: 'pi:abc', source: 'pi', displayName: 'Applicant Lead' },
];
const oldEnv = { ...process.env };
let generated; let manifest; let transcriptRow;

function transcriptRowFor(files, bundle) {
  return { wmkf_requestdocumentid: artifactId, _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation', wmkf_inputfingerprint: generated.inputSha256,
    wmkf_transcriptbundlejson: JSON.stringify(bundle), wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: '1',
    wmkf_sharepointetag: 'tag-txt', wmkf_filename: files.txt.filename, wmkf_contenttype: files.txt.contentType,
    wmkf_contenthash: files.txt.sha256, wmkf_filesize: files.txt.size, wmkf_slotversion: 3,
    createdon: '2026-10-04T10:00:00Z' };
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  generated = buildMeetingTranscriptFiles({ content, speakerNames,
    identity: { requestId, siteVisitActivityId: visitId, revisionId, operationId: revisionId,
      sourceRevisionId: null, presentationEnd: current } });
  const descriptors = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: `tag-${role}`,
    filename: file.filename, contentType: file.contentType, sha256: file.sha256, size: file.bytes.length }]));
  manifest = buildMeetingTranscriptManifest({ identity: { requestId, siteVisitActivityId: visitId, revisionId,
    operationId: revisionId, sourceRevisionId: null, presentationEnd: current }, files: descriptors });
  transcriptRow = transcriptRowFor(descriptors, manifest);
  binding.loadMeetingTranscriptionBinding.mockResolvedValue({ requestId, siteVisitActivityId: visitId });
  binding.getMeetingTranscriptionCandidates.mockResolvedValue({ candidates, candidateSources: {} });
  documents.findByRequest.mockResolvedValue({ records: [transcriptRow] });
  GraphService.downloadFile.mockResolvedValue({ buffer: generated.files.source.bytes });
  GraphService.getFileMetadataById.mockResolvedValue({ eTag: 'tag-source', versionId: '1' });
});
afterAll(() => { process.env = oldEnv; });

const draft = (extra = {}) => ({ operation_id: draftId, request_id: requestId, site_visit_activity_id: visitId,
  state: 'draft', version: 2, expires_at: new Date(Date.now() + 60_000), source_artifact_id: artifactId,
  source_revision_id: revisionId, expected_current_artifact_id: artifactId,
  expected_current_fingerprint: generated.inputSha256, speaker_names: speakerNames,
  presentation_end_ms: 2000, presentation_end_confirmed_by: 8,
  presentation_end_confirmed_at: new Date(current.confirmedAt), ...extra });

describe('correction draft presentation end', () => {
  test('GET returns the current, draft, and proposed boundary and the draft ms on the correction', async () => {
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ presentation_end_ms: 3000 }));
    const result = await getMeetingCorrectionDraft({ requestId, operationId: draftId });
    expect(result.correction.presentationEndMs).toBe(3000);
    expect(result.presentationEnd).toEqual({ current, draft: { endMs: 3000 },
      proposed: { endMs: 2000, speakerId: 'B', utteranceIndex: 1, skipped: [] } });
    expect(result).not.toHaveProperty('receipt');
  });

  test('GET reports a null draft and current for an unconfirmed (pre-boundary) bundle', async () => {
    const plain = buildMeetingTranscriptFiles({ content, speakerNames, identity: { requestId,
      siteVisitActivityId: visitId, revisionId, operationId: revisionId, sourceRevisionId: null } });
    GraphService.downloadFile.mockResolvedValue({ buffer: plain.files.source.bytes });
    const descriptors = JSON.parse(transcriptRow.wmkf_transcriptbundlejson).files;
    descriptors.source = { ...descriptors.source, sha256: plain.files.source.sha256, size: plain.files.source.bytes.length };
    const plainManifest = buildMeetingTranscriptManifest({ identity: { requestId, siteVisitActivityId: visitId,
      revisionId, operationId: revisionId, sourceRevisionId: null }, files: descriptors });
    documents.findByRequest.mockResolvedValue({ records: [{ ...transcriptRow, wmkf_inputfingerprint: plain.inputSha256,
      wmkf_transcriptbundlejson: JSON.stringify(plainManifest) }] });
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ presentation_end_ms: null,
      presentation_end_confirmed_by: null, presentation_end_confirmed_at: null, expected_current_fingerprint: plain.inputSha256 }));
    const result = await getMeetingCorrectionDraft({ requestId, operationId: draftId });
    expect(result.presentationEnd).toMatchObject({ current: null, draft: null });
    expect(result.correction.presentationEndMs).toBeNull();
  });

  test('create seeds the draft boundary from the current bundle source', async () => {
    store.createMeetingTranscriptCorrectionDraft.mockResolvedValue({ operation_id: draftId });
    store.getMeetingTranscriptPublication.mockResolvedValue(draft());
    await createMeetingCorrection({ requestId, ownerProfileId: 12, artifactId });
    expect(store.createMeetingTranscriptCorrectionDraft).toHaveBeenCalledWith(expect.objectContaining({
      presentationEnd: current, sourceArtifactId: artifactId }));
  });

  test('PATCH with a valid utterance end sets it for the acting profile; null clears; absent leaves it', async () => {
    store.getMeetingTranscriptPublication.mockResolvedValue(draft());
    store.updateMeetingTranscriptCorrectionDraft.mockResolvedValue(draft({ presentation_end_ms: 3000 }));
    const result = await updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames, presentationEndMs: 3000 } });
    expect(result.correction.presentationEndMs).toBe(3000);
    const set = store.updateMeetingTranscriptCorrectionDraft.mock.calls[0][0].presentationEnd;
    expect(set).toMatchObject({ endMs: 3000, confirmedBy: 12 });
    expect(Number.isNaN(Date.parse(set.confirmedAt))).toBe(false);
    await updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames, presentationEndMs: null } });
    expect(store.updateMeetingTranscriptCorrectionDraft.mock.calls[1][0].presentationEnd).toBeNull();
    await updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames } });
    expect(store.updateMeetingTranscriptCorrectionDraft.mock.calls[2][0].presentationEnd).toBeUndefined();
  });

  test('PATCH with the boundary the draft already holds keeps who confirmed it and when (no re-stamp)', async () => {
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ presentation_end_ms: 3000,
      presentation_end_confirmed_by: 7, presentation_end_confirmed_at: new Date('2026-10-04T09:30:00Z') }));
    store.updateMeetingTranscriptCorrectionDraft.mockResolvedValue(draft({ presentation_end_ms: 3000 }));
    await updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames, presentationEndMs: 3000 } });
    expect(store.updateMeetingTranscriptCorrectionDraft.mock.calls[0][0].presentationEnd).toBeUndefined();
    // Clearing an already-clear boundary is likewise a no-op on the columns.
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ presentation_end_ms: null,
      presentation_end_confirmed_by: null, presentation_end_confirmed_at: null }));
    await updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames, presentationEndMs: null } });
    expect(store.updateMeetingTranscriptCorrectionDraft.mock.calls[1][0].presentationEnd).toBeUndefined();
  });

  test.each([1500, -1, 1.5, '3000', 99_999])('PATCH rejects presentationEndMs %p that is not an utterance end', async value => {
    store.getMeetingTranscriptPublication.mockResolvedValue(draft());
    await expect(updateMeetingCorrection({ requestId, ownerProfileId: 12, operationId: draftId,
      body: { expectedVersion: 2, speakerNames, presentationEndMs: value } }))
      .rejects.toMatchObject({ code: 'transcription_invalid_value', httpStatus: 400 });
    expect(store.updateMeetingTranscriptCorrectionDraft).not.toHaveBeenCalled();
  });

  test('publish freezes the receipt boundary into the bundle identity, as an ISO instant', async () => {
    const decision = { version: 1, rows: [], excludedSpeakerIds: [], attendance: { status: 'unavailable', fetchedAt: '2026-10-05T12:00:00.000Z' } };
    const stable = value => value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
    const context = crypto.createHash('sha256').update(stable({ operationId: draftId, sourceRevisionId: revisionId,
      fingerprint: generated.inputSha256, sourceProvenance: null, endMs: 3000, speakerNames })).digest('hex');
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ presentation_end_ms: 3000,
      presentation_end_confirmed_by: 12, presentation_end_confirmed_at: new Date('2026-10-05T12:00:00.000Z'),
      discussion_attribution: decision, attendance_review: { id: 'review', decision, context } }));
    publisher.prepareMeetingTranscriptBundlePublication.mockResolvedValue({ candidatePaths: { txt: 'a', vtt: 'b', source: 'c' } });
    store.freezeMeetingTranscriptCorrectionDraft.mockResolvedValue(null);
    await expect(publishMeetingCorrection({ requestId, ownerProfileId: 12, actingUserSystemId: actor,
      operationId: draftId, body: { expectedVersion: 2 } })).rejects.toMatchObject({ code: 'meeting_transcript_correction_changed' });
    const frozenInput = store.freezeMeetingTranscriptCorrectionDraft.mock.calls[0][0].frozenInputSha256;
    const expected = buildMeetingTranscriptFiles({ content, speakerNames, identity: { requestId, siteVisitActivityId: visitId,
      revisionId: draftId, operationId: draftId, sourceRevisionId: revisionId, discussionAttribution: decision,
      presentationEnd: { endMs: 3000, confirmedBy: 12, confirmedAt: '2026-10-05T12:00:00.000Z' } } });
    expect(frozenInput).toBe(expected.inputSha256);
  });

  test('publish refuses a draft read at a different version than the caller saw', async () => {
    store.getMeetingTranscriptPublication.mockResolvedValue(draft({ version: 3 }));
    await expect(publishMeetingCorrection({ requestId, ownerProfileId: 12, actingUserSystemId: actor,
      operationId: draftId, body: { expectedVersion: 2 } })).rejects.toMatchObject({ code: 'meeting_transcript_correction_changed', httpStatus: 409 });
    expect(store.freezeMeetingTranscriptCorrectionDraft).not.toHaveBeenCalled();
  });
});

describe('overview currentArtifact', () => {
  beforeEach(() => {
    store.listMeetingTranscriptPublications.mockResolvedValue([]);
    store.listMeetingTranscriptionJobs.mockResolvedValue([]);
  });
  const presentationRow = key => ({ wmkf_requestdocumentid: presentationId, _wmkf_request_value: requestId,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_generationkey: key, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'pres', wmkf_slotversion: 4, createdon: '2026-10-05T10:00:00Z' });

  test('missing: a confirmed boundary with no Presentation Transcript row', async () => {
    const overview = await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 });
    expect(overview.currentArtifact).toMatchObject({ id: artifactId, presentationEnd: current,
      presentationTranscript: { state: 'missing', artifactId: null } });
  });

  test('bound and stale follow the generation key from the current revision and boundary', async () => {
    const key = presentationTranscriptGenerationKey({ requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, presentationRow(key)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.presentationTranscript)
      .toEqual({ state: 'bound', artifactId: presentationId });
    const stale = presentationTranscriptGenerationKey({ requestId, sourceRevisionId: revisionId, presentationEndMs: 1000 });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, presentationRow(stale)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.presentationTranscript)
      .toEqual({ state: 'stale', artifactId: null });
  });

  test('the staff discussion state is reported alongside, bound only by its own key', async () => {
    const discussionKey = staffDiscussionTranscriptGenerationKey({ requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 });
    const discussionRow = (key) => ({ ...presentationRow(key), wmkf_requestdocumentid: '99999999-9999-4999-8999-999999999990',
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, discussionRow(discussionKey)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.staffDiscussionTranscript)
      .toEqual({ state: 'bound', artifactId: '99999999-9999-4999-8999-999999999990' });
    // The presentation key never satisfies the discussion binding.
    const presentationKey = presentationTranscriptGenerationKey({ requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, discussionRow(presentationKey)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.staffDiscussionTranscript)
      .toEqual({ state: 'stale', artifactId: null });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.staffDiscussionTranscript)
      .toEqual({ state: 'missing', artifactId: null });
  });

  test('the staff discussion summary is reported separately and binds only by its own fingerprint (paired summaries plan D8)', async () => {
    const discussionSummaryId = '99999999-9999-4999-8999-999999999992';
    const identity = { requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 };
    const discussionSummaryRow = (fingerprint) => ({ ...presentationRow(`discussion-summary-key-${fingerprint}`),
      wmkf_requestdocumentid: discussionSummaryId, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_SUMMARY,
      wmkf_inputfingerprint: fingerprint });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, discussionSummaryRow(staffDiscussionSummaryBindingFingerprint(identity))] });
    const bound = (await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact;
    expect(bound.staffDiscussionSummary).toMatchObject({ state: 'bound', artifactId: discussionSummaryId });
    expect(bound.transcriptSummary).toMatchObject({ state: 'missing', artifactId: null });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, discussionSummaryRow(transcriptSummaryBindingFingerprint(identity))] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.staffDiscussionSummary)
      .toMatchObject({ state: 'stale', artifactId: discussionSummaryId });
  });

  test('the summary is bound by its input fingerprint; a stale one stays visible to staff with its id', async () => {
    const summaryId = '99999999-9999-4999-8999-999999999991';
    const summaryRow = (fingerprint) => ({ ...presentationRow(`summary-key-${fingerprint}`), wmkf_requestdocumentid: summaryId,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, wmkf_inputfingerprint: fingerprint });
    const bound = transcriptSummaryBindingFingerprint({ requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, summaryRow(bound)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.transcriptSummary)
      .toEqual({ state: 'bound', artifactId: summaryId, publishedAt: '2026-10-05T10:00:00Z' });
    // The presentation transcript's key never satisfies the summary binding.
    const wrong = presentationTranscriptGenerationKey({ requestId, sourceRevisionId: revisionId, presentationEndMs: 2000 });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow, summaryRow(wrong)] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.transcriptSummary)
      .toEqual({ state: 'stale', artifactId: summaryId, publishedAt: '2026-10-05T10:00:00Z' });
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow] });
    expect((await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 })).currentArtifact.transcriptSummary)
      .toEqual({ state: 'missing', artifactId: null, publishedAt: null });
  });

  test('not_confirmed: a bundle without a boundary', async () => {
    const plainManifest = { ...JSON.parse(transcriptRow.wmkf_transcriptbundlejson), presentationEnd: null };
    documents.findByRequest.mockResolvedValue({ records: [{ ...transcriptRow,
      wmkf_transcriptbundlejson: JSON.stringify(plainManifest) }] });
    const overview = await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 });
    expect(overview.currentArtifact).toMatchObject({ presentationEnd: null,
      presentationTranscript: { state: 'not_confirmed', artifactId: null } });
  });

  test('loads the request rows with the bundle metadata and ignores other artifact types', async () => {
    documents.findByRequest.mockResolvedValue({ records: [transcriptRow,
      { ...transcriptRow, wmkf_requestdocumentid: presentationId, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING }] });
    const overview = await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 12 });
    expect(documents.findByRequest).toHaveBeenCalledWith(requestId, { includeMeetingTranscriptBundle: true });
    expect(overview.currentArtifact.id).toBe(artifactId);
  });
});
