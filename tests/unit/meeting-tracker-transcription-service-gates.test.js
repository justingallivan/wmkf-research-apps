jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequest: jest.fn(), findByGenerationKey: jest.fn() }));
jest.mock('../../lib/services/post-presentation-materials/material-service.js', () => ({
  prepareMeetingTranscriptBundlePublication: jest.fn(), publishMeetingTranscriptBundle: jest.fn(),
}));
jest.mock('../../lib/services/post-presentation-materials/slot-lease-store.js', () => ({
  getPresentationSlotLease: jest.fn(async () => null), releasePresentationSlotLease: jest.fn(async () => null),
}));
jest.mock('../../lib/services/meeting-tracker-transcription/binding.js', () => ({
  loadMeetingTranscriptionBinding: jest.fn(), getMeetingTranscriptionCandidates: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  createMeetingTranscriptionUpload: jest.fn(), queueMeetingTranscription: jest.fn(),
  getMeetingTranscriptionJobContent: jest.fn(), saveMeetingTranscriptionSpeakerNames: jest.fn(),
  deleteMeetingTranscriptionJob: jest.fn(), projectMeetingTranscriptionJob: jest.fn(),
  providerReference: jest.fn(),
}));
jest.mock('../../lib/services/transcription-pilot/provider.js', () => ({ getAssemblyAITranscript: jest.fn(), deleteAssemblyAITranscript: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/workflow-dispatch.js', () => ({ dispatchQueuedTranscriptionWorkflow: jest.fn() }));
jest.mock('../../lib/services/transcription-pilot/store.js', () => Object.fromEntries([
  'getMeetingTranscriptionJob','listMeetingTranscriptionJobs','listMeetingTranscriptPublications',
  'getMeetingTranscriptPublication','freezeMeetingPublicationFromJob','closeMeetingPublicationJobLease',
  'closeMeetingPublicationWithoutWrites','closeMeetingPublicationAfterQuarantine',
  'renewMeetingPublicationJobLease','renewMeetingPublicationReceiptLease','recordMeetingPublicationCandidate','recordMeetingPublicationSlotFence',
  'claimMeetingTranscriptPublicationForRecovery','markMeetingTranscriptPublicationChecked',
  'transitionMeetingTranscriptPublication','createMeetingTranscriptCorrectionDraft',
  'updateMeetingTranscriptCorrectionDraft','freezeMeetingTranscriptCorrectionDraft',
  'claimMeetingUncertainTranscriptionJobForReconcile','reconcileMeetingVerifiedTranscriptionProviderId',
  'abandonMeetingUncertainTranscriptionJob','getLeasedTranscriptionJob','releaseTranscriptionLease',
  'markTranscriptionProviderDeletionCompleted','listUnresolvedMeetingTranscriptPublications',
].map(name => [name, jest.fn()])));

import * as store from '../../lib/services/transcription-pilot/store.js';
import * as binding from '../../lib/services/meeting-tracker-transcription/binding.js';
import { publishMeetingTranscription, publishMeetingCorrection, startMeetingTranscription } from '../../lib/services/meeting-tracker-transcription/service.js';
import { queueMeetingTranscription, projectMeetingTranscriptionJob } from '../../lib/services/transcription-pilot/runtime.js';
import { dispatchQueuedTranscriptionWorkflow } from '../../lib/services/transcription-pilot/workflow-dispatch.js';
import { getMeetingTranscriptionOverview } from '../../lib/services/meeting-tracker-transcription/service.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

test('a populated ready job cannot be read or published while the Meeting Tracker feature is off', async () => {
  const oldAccess = process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS;
  const oldSchema = process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY;
  delete process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS;
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscription({ requestId, ownerProfileId: 8, actingUserSystemId: requestId,
      jobId, body: { expectedVersion: 5, expectedCurrentArtifactId: null, expectedCurrentFingerprint: null } }))
      .rejects.toMatchObject({ code: 'meeting_transcription_disabled', httpStatus: 503 });
    expect(store.getMeetingTranscriptionJob).not.toHaveBeenCalled();
    expect(store.freezeMeetingPublicationFromJob).not.toHaveBeenCalled();
    const overview = await getMeetingTranscriptionOverview({ requestId, ownerProfileId: 8 });
    expect(overview).toMatchObject({ featureState: 'disabled', jobs: [], candidates: [], publications: [] });
    expect(binding.loadMeetingTranscriptionBinding).not.toHaveBeenCalled();
  } finally {
    if (oldAccess === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS;
    else process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = oldAccess;
    if (oldSchema === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = oldSchema;
  }
});

test.each([
  ['job publication rejects a missing mapped actor before freezing', () => publishMeetingTranscription({
    requestId, ownerProfileId: 8, jobId, body: { expectedVersion: 5,
      expectedCurrentArtifactId: null, expectedCurrentFingerprint: null },
  })],
  ['correction publication rejects a missing mapped actor before freezing', () => publishMeetingCorrection({
    requestId, ownerProfileId: 8, operationId: jobId, body: { expectedVersion: 1 },
  })],
])('%s', async (_label, invoke) => {
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  await expect(invoke()).rejects.toMatchObject({ code: 'post_presentation_actor_required', httpStatus: 403 });
  expect(store.freezeMeetingPublicationFromJob).not.toHaveBeenCalled();
  expect(store.freezeMeetingTranscriptCorrectionDraft).not.toHaveBeenCalled();
});

test.each([
  ['job', () => publishMeetingTranscription({ requestId, ownerProfileId: 8,
    actingUserSystemId: '44444444-4444-4444-8444-444444444444', jobId,
    body: { expectedVersion: 5, expectedCurrentArtifactId: null, expectedCurrentFingerprint: null } })],
  ['correction', () => publishMeetingCorrection({ requestId, ownerProfileId: 8,
    actingUserSystemId: '44444444-4444-4444-8444-444444444444', operationId: jobId,
    body: { expectedVersion: 1 } })],
])('%s publication checks the bundle readiness gate before any freeze or binding read', async (_label, invoke) => {
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  await expect(invoke()).rejects.toMatchObject({ code: 'meeting_transcript_bundle_schema_not_ready', httpStatus: 503 });
  expect(binding.loadMeetingTranscriptionBinding).not.toHaveBeenCalled();
  expect(store.freezeMeetingPublicationFromJob).not.toHaveBeenCalled();
  expect(store.freezeMeetingTranscriptCorrectionDraft).not.toHaveBeenCalled();
});

test('Start dispatches queued work immediately and reports a truthful pending state if dispatch fails', async () => {
  const oldAccess = process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS;
  const oldSchema = process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  binding.loadMeetingTranscriptionBinding.mockResolvedValue({ requestId, siteVisitActivityId: '33333333-3333-4333-8333-333333333333' });
  queueMeetingTranscription.mockResolvedValue({ id: jobId, status: 'queued', version: 6 });
  store.getMeetingTranscriptionJob.mockResolvedValue({ id: jobId, status: 'queued', version: 6 });
  projectMeetingTranscriptionJob.mockImplementation(job => ({ id: job.id, status: job.status, version: job.version }));
  try {
    dispatchQueuedTranscriptionWorkflow.mockResolvedValueOnce({ accepted: true });
    const started = await startMeetingTranscription({ requestId, ownerProfileId: 8,
      actingUserSystemId: '44444444-4444-4444-8444-444444444444', jobId,
      body: { expectedVersion: 5, nonSensitiveAcknowledged: true } });
    expect(dispatchQueuedTranscriptionWorkflow).toHaveBeenCalledWith({ jobId });
    expect(started).toEqual({ job: { id: jobId, status: 'queued', version: 6 }, dispatchPending: false });

    dispatchQueuedTranscriptionWorkflow.mockRejectedValueOnce(new Error('outbox unavailable'));
    const retry = await startMeetingTranscription({ requestId, ownerProfileId: 8,
      actingUserSystemId: '44444444-4444-4444-8444-444444444444', jobId,
      body: { expectedVersion: 5, nonSensitiveAcknowledged: true } });
    expect(retry).toMatchObject({ job: { id: jobId, status: 'queued' }, dispatchPending: true });
  } finally {
    if (oldAccess === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS;
    else process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = oldAccess;
    if (oldSchema === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = oldSchema;
  }
});
