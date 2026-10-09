jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: (_name, fn) => fn() }));
jest.mock('../../lib/services/transcription-pilot/runtime.js', () => ({
  TranscriptionPilotError: class TranscriptionPilotError extends Error {},
}));
jest.mock('../../lib/services/meeting-tracker-transcription/service.js', () => ({
  getMeetingTranscriptionOverview: jest.fn(async () => ({ featureState: 'enabled' })),
  uploadMeetingTranscription: jest.fn(async () => ({ job: { id: 'j' }, upload: { token: 't' } })),
  renameMeetingTranscriptionSpeakers: jest.fn(async () => ({ job: { id: 'j' } })),
  publishMeetingTranscription: jest.fn(async () => ({ publication: { state: 'published' } })),
  closeMeetingTranscriptPublication: jest.fn(async () => ({ closed: true, retainedFiles: true })),
  getMeetingCorrectionDraft: jest.fn(async () => ({ correction: {} })),
  updateMeetingCorrection: jest.fn(async () => ({ correction: { presentationEndMs: null } })),
}));
jest.mock('../../lib/utils/actor-ref.js', () => ({ actorRefFromSession: jest.fn(() => '77777777-7777-4777-8777-777777777777') }));
jest.mock('../../lib/services/post-presentation-materials/transcript-summary-service.js', () => ({
  createSummaryDraft: jest.fn(async () => ({ draft: { id: 'd' } })),
  getSummaryDraft: jest.fn(async () => ({ draft: null })),
  updateSummaryDraft: jest.fn(async () => ({ draft: { id: 'd' } })),
  discardSummaryDraft: jest.fn(async () => ({ draft: null })),
  publishSummaryDraft: jest.fn(async () => ({ transcriptSummary: { state: 'bound' } })),
}));
jest.mock('../../lib/services/post-presentation-materials/presentation-transcript-service.js', () => ({
  generatePresentationTranscript: jest.fn(async () => ({ presentationTranscript: { artifactId: 'a', state: 'bound' } })),
}));

import { requireAppAccess } from '../../lib/utils/auth.js';
import { getMeetingTranscriptionOverview, uploadMeetingTranscription, renameMeetingTranscriptionSpeakers,
  publishMeetingTranscription, closeMeetingTranscriptPublication, updateMeetingCorrection } from '../../lib/services/meeting-tracker-transcription/service.js';
import { generatePresentationTranscript } from '../../lib/services/post-presentation-materials/presentation-transcript-service.js';
import correction from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/corrections/[operationId].js';
import presentationTranscript from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/presentation-transcript.js';
import collection from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions.js';
import summaryDraft from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft.js';
import summaryPublish from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/summary-draft/publish.js';
import {
  createSummaryDraft, getSummaryDraft, updateSummaryDraft, discardSummaryDraft,
  publishSummaryDraft,
} from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import speakers from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/speakers.js';
import publish from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/[jobId]/publish.js';
import closePublication from '../../pages/api/meeting-tracker/visits/[requestId]/transcriptions/publications/[operationId]/close.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
function response() {
  return { status: jest.fn(function status(value) { this.statusCode = value; return this; }),
    json: jest.fn(function json(value) { this.body = value; return this; }),
    send: jest.fn(function send(value) { this.body = value; return this; }), setHeader: jest.fn() };
}

beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 9, session: { user: {} } }); });

test('collection GET checks the app grant and uses the request-scoped service', async () => {
  const res = response();
  await collection({ method: 'GET', query: { requestId } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
  expect(getMeetingTranscriptionOverview).toHaveBeenCalledWith({ requestId, ownerProfileId: 9 });
  expect(res.statusCode).toBe(200);
});

test('collection GET returns the explicit disabled DTO rather than a retryable failure', async () => {
  getMeetingTranscriptionOverview.mockResolvedValueOnce({ featureState: 'disabled', jobs: [], candidates: [] });
  const res = response();
  await collection({ method: 'GET', query: { requestId } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ featureState: 'disabled', jobs: [], candidates: [] });
});

test('collection POST rejects identity injection before service dispatch', async () => {
  const res = response();
  await collection({ method: 'POST', query: { requestId }, body: {
    filename: 'meeting.m4a', contentType: 'audio/mp4', bytes: 1000,
    idempotencyKey: 'valid-key-0001', providerRegion: 'us', profileId: 77,
  } }, res);
  expect(res.statusCode).toBe(400);
  expect(uploadMeetingTranscription).not.toHaveBeenCalled();
});

const createBody = { filename: 'meeting.m4a', contentType: 'audio/mp4', bytes: 1000, idempotencyKey: 'valid-key-0001', providerRegion: 'us' };

test('collection POST accepts the optional zoomTranscript key', async () => {
  const res = response();
  const body = { ...createBody, zoomTranscript: { contentType: 'text/vtt', bytes: 500 } };
  await collection({ method: 'POST', query: { requestId }, body }, res);
  expect(res.statusCode).toBe(201);
  expect(uploadMeetingTranscription).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, body });
});

test('collection POST still works without zoomTranscript', async () => {
  const res = response();
  await collection({ method: 'POST', query: { requestId }, body: createBody }, res);
  expect(res.statusCode).toBe(201);
});

test.each([
  ['an unknown top-level key', { ...createBody, zoomFilename: 'x.vtt' }],
  ['a missing required key', { filename: 'a.m4a', contentType: 'audio/mp4', bytes: 1, idempotencyKey: 'valid-key-0001', zoomTranscript: { contentType: 'text/vtt', bytes: 5 } }],
])('collection POST rejects %s before service dispatch', async (_label, body) => {
  const res = response();
  await collection({ method: 'POST', query: { requestId }, body }, res);
  expect(res.statusCode).toBe(400);
  expect(uploadMeetingTranscription).not.toHaveBeenCalled();
});

test('auth-bypass profile absence is rejected on the actual route', async () => {
  requireAppAccess.mockResolvedValue({ profileId: null, session: { user: {}, authBypassed: true } });
  const res = response();
  await collection({ method: 'GET', query: { requestId } }, res);
  expect(res.statusCode).toBe(401);
  expect(getMeetingTranscriptionOverview).not.toHaveBeenCalled();
});

test('speaker PATCH exposes only optimistic version and labels at the route boundary', async () => {
  const res = response();
  await speakers({ method: 'PATCH', query: { requestId, jobId }, body: {
    expectedVersion: 4, speakerNames: { A: 'Chair' }, profileId: 77,
  } }, res);
  expect(res.statusCode).toBe(400);
  expect(renameMeetingTranscriptionSpeakers).not.toHaveBeenCalled();
  const accepted = response();
  await speakers({ method: 'PATCH', query: { requestId, jobId }, body: {
    expectedVersion: 4, speakerNames: { A: 'Chair' },
  } }, accepted);
  expect(renameMeetingTranscriptionSpeakers).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, jobId,
    body: { expectedVersion: 4, speakerNames: { A: 'Chair' } } });
  expect(accepted.statusCode).toBe(200);
});

test('job publish route reports the service httpStatus for unmapped actor failures', async () => {
  const error = Object.assign(new Error('mapped actor required'), { code: 'post_presentation_actor_required', httpStatus: 403 });
  publishMeetingTranscription.mockRejectedValueOnce(error);
  const res = response();
  await publish({ method: 'POST', query: { requestId, jobId }, body: {
    expectedVersion: 2, expectedCurrentArtifactId: null, expectedCurrentFingerprint: null,
  } }, res);
  expect(res.statusCode).toBe(403);
});

test('close route requires exact retained-file acknowledgement and supplies the authenticated profile', async () => {
  const invalid = response();
  await closePublication({ method: 'POST', query: { requestId, operationId: jobId }, body: {
    acknowledgeRetainedFiles: true, operationId: 'attacker-choice',
  } }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(closeMeetingTranscriptPublication).not.toHaveBeenCalled();
  const accepted = response();
  await closePublication({ method: 'POST', query: { requestId, operationId: jobId }, body: {
    acknowledgeRetainedFiles: true,
  } }, accepted);
  expect(closeMeetingTranscriptPublication).toHaveBeenCalledWith({ requestId, operationId: jobId,
    actorProfileId: 9, acknowledgeRetainedFiles: true });
  expect(accepted.statusCode).toBe(200);
});

describe('correction PATCH body shapes', () => {
  const query = { requestId, operationId: jobId };
  test.each([
    ['the two-key shape leaves the presentation end untouched', { expectedVersion: 2, speakerNames: { A: 'Chair' } }],
    ['the three-key shape sets the presentation end', { expectedVersion: 2, speakerNames: { A: 'Chair' }, presentationEndMs: 61000 }],
    ['the three-key shape clears it with null', { expectedVersion: 2, speakerNames: { A: 'Chair' }, presentationEndMs: null }],
  ])('%s', async (_label, body) => {
    const res = response();
    await correction({ method: 'PATCH', query, body }, res);
    expect(res.statusCode).toBe(200);
    expect(updateMeetingCorrection).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, operationId: jobId, body });
  });

  test.each([
    ['an extra key', { expectedVersion: 2, speakerNames: {}, presentationEndMs: 1, profileId: 77 }],
    ['presentationEndMs without speakerNames', { expectedVersion: 2, presentationEndMs: 1 }],
    ['a non-integer version', { expectedVersion: '2', speakerNames: {} }],
  ])('rejects %s before service dispatch', async (_label, body) => {
    const res = response();
    await correction({ method: 'PATCH', query, body }, res);
    expect(res.statusCode).toBe(400);
    expect(updateMeetingCorrection).not.toHaveBeenCalled();
  });

  test('an invalid presentationEndMs is reported by the service as 400 transcription_invalid_value', async () => {
    updateMeetingCorrection.mockRejectedValueOnce(Object.assign(new Error('transcription_invalid_value'),
      { code: 'transcription_invalid_value', httpStatus: 400 }));
    const res = response();
    await correction({ method: 'PATCH', query, body: { expectedVersion: 2, speakerNames: {}, presentationEndMs: 1234 } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'transcription_invalid_value' });
  });
});

describe('presentation-transcript route', () => {
  const artifact = '44444444-4444-4444-8444-444444444444';
  const goodBody = { expectedCurrentArtifactId: artifact, expectedCurrentFingerprint: 'a'.repeat(64) };

  test('supplies the authenticated profile and mapped actor, never client identity', async () => {
    const res = response();
    await presentationTranscript({ method: 'POST', query: { requestId }, body: goodBody }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'meeting-tracker');
    expect(generatePresentationTranscript).toHaveBeenCalledWith({ requestId, ownerProfileId: 9,
      actingUserSystemId: '77777777-7777-4777-8777-777777777777', body: goodBody });
    expect(res.statusCode).toBe(200);
  });

  test.each([
    ['an extra key', { ...goodBody, profileId: 77 }],
    ['a missing key', { expectedCurrentArtifactId: artifact }],
    ['a non-GUID artifact id', { ...goodBody, expectedCurrentArtifactId: 'not-a-guid' }],
    ['an uppercase fingerprint', { ...goodBody, expectedCurrentFingerprint: 'A'.repeat(64) }],
    ['a short fingerprint', { ...goodBody, expectedCurrentFingerprint: 'a'.repeat(63) }],
    ['a null artifact id', { ...goodBody, expectedCurrentArtifactId: null }],
    ['an array body', [goodBody]],
  ])('rejects %s before service dispatch', async (_label, body) => {
    const res = response();
    await presentationTranscript({ method: 'POST', query: { requestId }, body }, res);
    expect(res.statusCode).toBe(400);
    expect(generatePresentationTranscript).not.toHaveBeenCalled();
  });

  test('rejects non-POST methods, a bad request id, and a missing profile', async () => {
    const get = response();
    await presentationTranscript({ method: 'GET', query: { requestId }, body: goodBody }, get);
    expect(get.statusCode).toBe(405);
    const badId = response();
    await presentationTranscript({ method: 'POST', query: { requestId: 'nope' }, body: goodBody }, badId);
    expect(badId.statusCode).toBe(400);
    requireAppAccess.mockResolvedValue({ profileId: null, session: { user: {} } });
    const noProfile = response();
    await presentationTranscript({ method: 'POST', query: { requestId }, body: goodBody }, noProfile);
    expect(noProfile.statusCode).toBe(401);
    expect(generatePresentationTranscript).not.toHaveBeenCalled();
  });

  test('reports service statuses and codes, including the two documented 409s', async () => {
    for (const code of ['meeting_transcript_current_changed', 'presentation_end_not_confirmed']) {
      generatePresentationTranscript.mockRejectedValueOnce(Object.assign(new Error(code), { code, httpStatus: 409 }));
      const res = response();
      await presentationTranscript({ method: 'POST', query: { requestId }, body: goodBody }, res);
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({ code });
    }
  });
});

describe('summary-draft routes', () => {
  const draftId = '55555555-5555-4555-8555-555555555555';
  const createBody = { acknowledgmentVersion: 'presentation-summary-2026-10-05',
    expectedCurrentArtifactId: '44444444-4444-4444-8444-444444444444', expectedCurrentFingerprint: 'a'.repeat(64) };
  const actor = '77777777-7777-4777-8777-777777777777';

  test('each method dispatches with the authenticated profile; only writes that reach Dataverse get the mapped actor', async () => {
    const cases = [
      ['GET', undefined, getSummaryDraft, { requestId, ownerProfileId: 9, body: undefined }],
      ['POST', createBody, createSummaryDraft, { requestId, ownerProfileId: 9, body: createBody, actingUserSystemId: actor }],
      ['PATCH', { draftId, expectedVersion: 2, text: 'Edited' }, updateSummaryDraft,
        { requestId, ownerProfileId: 9, body: { draftId, expectedVersion: 2, text: 'Edited' } }],
      ['DELETE', { draftId, expectedVersion: 2 }, discardSummaryDraft,
        { requestId, ownerProfileId: 9, body: { draftId, expectedVersion: 2 } }],
    ];
    for (const [method, body, service, expected] of cases) {
      const res = response();
      await summaryDraft({ method, query: { requestId }, body }, res);
      expect(requireAppAccess).toHaveBeenLastCalledWith(expect.anything(), res, 'meeting-tracker');
      expect(service).toHaveBeenCalledWith(expected);
      expect(res.statusCode).toBe(200);
    }
    const res = response();
    await summaryPublish({ method: 'POST', query: { requestId }, body: { draftId, expectedVersion: 2 } }, res);
    expect(publishSummaryDraft).toHaveBeenCalledWith({ requestId, ownerProfileId: 9, actingUserSystemId: actor,
      body: { draftId, expectedVersion: 2 } });
    expect(res.statusCode).toBe(200);
  });

  test.each([
    ['POST with an extra key', 'POST', { ...createBody, profileId: 77 }],
    ['POST without the acknowledgment', 'POST', { expectedCurrentArtifactId: createBody.expectedCurrentArtifactId, expectedCurrentFingerprint: createBody.expectedCurrentFingerprint }],
    ['PATCH with a non-GUID draft', 'PATCH', { draftId: 'x', expectedVersion: 2, text: 'a' }],
    ['PATCH with a zero version', 'PATCH', { draftId, expectedVersion: 0, text: 'a' }],
    ['PATCH with non-string text', 'PATCH', { draftId, expectedVersion: 2, text: 5 }],
    ['DELETE with an extra key', 'DELETE', { draftId, expectedVersion: 2, force: true }],
  ])('rejects %s before service dispatch', async (_label, method, body) => {
    const res = response();
    await summaryDraft({ method, query: { requestId }, body }, res);
    expect(res.statusCode).toBe(400);
    for (const service of [createSummaryDraft, updateSummaryDraft, discardSummaryDraft]) {
      expect(service).not.toHaveBeenCalled();
    }
  });

  test('publish rejects a malformed body and non-POST methods', async () => {
    const bad = response();
    await summaryPublish({ method: 'POST', query: { requestId }, body: { draftId, expectedVersion: '2' } }, bad);
    expect(bad.statusCode).toBe(400);
    const get = response();
    await summaryPublish({ method: 'GET', query: { requestId }, body: {} }, get);
    expect(get.statusCode).toBe(405);
    expect(publishSummaryDraft).not.toHaveBeenCalled();
  });

  test('reports service status and code', async () => {
    createSummaryDraft.mockRejectedValueOnce(Object.assign(new Error('declined'), { code: 'summary_claude_output_refused', httpStatus: 422 }));
    const res = response();
    await summaryDraft({ method: 'POST', query: { requestId }, body: createBody }, res);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'summary_claude_output_refused', error: 'declined' });
  });
});

