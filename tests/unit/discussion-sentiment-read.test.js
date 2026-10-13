/**
 * Sentiment page read model and error mapping (plan §4.5). Fake store injected through dependencies.
 * @jest-environment node
 */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));
jest.mock('../../lib/services/post-presentation-materials/transcript-summary-service.js', () => ({
  TRANSCRIPT_SUMMARY_DEPENDENCIES: {},
  assertEnabled: jest.fn(),
  bindCurrent: jest.fn(),
  loadVerifiedDiscussionTranscript: jest.fn(),
}));

import * as summaryService from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import { formatTranscriptText } from '../../lib/services/transcription-pilot/transcript-format.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import { PROMPT_STORE_ERROR_CODES } from '../../lib/services/prompt-store.js';
import {
  getDiscussionSentimentStatus, analyzeDiscussionSentiment, acceptDiscussionSentiment,
} from '../../lib/services/post-presentation-materials/discussion-sentiment-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-10-13T12:00:00Z');
const iso = (secondsAgo) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
const readyRow = (overrides = {}) => ({
  id: '33333333-3333-4333-8333-333333333333', request_id: REQUEST_ID, status: 'ready', source_artifact_id: ARTIFACT_ID,
  source_content_hash: HASH, prompt_version: 3, record: { reception: 'mixed' }, failure_code: null,
  created_at: iso(500), completed_at: iso(480), accepted_at: null, accepted_by_profile_id: null, withdrawn_at: null, ...overrides,
});

let bound; let store; let deps; let promptVersion;
beforeEach(() => {
  promptVersion = 3;
  bound = { discussion: { reason: 'bound', staffDiscussionTranscript: { wmkf_requestdocumentid: ARTIFACT_ID, wmkf_contenthash: HASH } } };
  summaryService.assertEnabled.mockReset();
  summaryService.bindCurrent.mockReset().mockImplementation(async () => bound);
  summaryService.loadVerifiedDiscussionTranscript.mockReset();
  store = {
    getLatestRun: jest.fn(async () => null),
    getLatestReadyRun: jest.fn(async () => null),
    getLatestCurrentReadyRun: jest.fn(async () => null),
    getAcceptedRun: jest.fn(async () => null),
    getProfileName: jest.fn(async () => 'Alex Staff'),
    getRun: jest.fn(async () => readyRow()),
    acceptRun: jest.fn(async () => readyRow()),
    reserveRun: jest.fn(async () => ({ run: { id: 'r' } })),
    failRun: jest.fn(async () => ({})),
    recordFailedRun: jest.fn(async () => ({})),
  };
  deps = {
    loadBinding: jest.fn(async () => ({ requestId: REQUEST_ID, siteVisitActivityId: 'visit' })),
    fetchCurrentPrompt: jest.fn(async () => ({ wmkf_promptversion: promptVersion })),
    loadModelOverrides: jest.fn(async () => {}),
    getExecutorBudget: jest.fn(async () => ({})),
    randomUUID: jest.fn(() => '44444444-4444-4444-8444-444444444444'),
    now: () => NOW,
    sentiments: store,
  };
});

const status = () => getDiscussionSentimentStatus({ requestId: REQUEST_ID, ownerProfileId: 12 }, deps);

describe('getDiscussionSentimentStatus', () => {
  test('no bound transcript reads as no_transcript and reads no sentiment rows', async () => {
    bound = { discussion: { reason: 'discussion_missing' } };
    expect(await status()).toMatchObject({ state: 'no_transcript', run: null, accepted: null });
    expect(store.getLatestRun).not.toHaveBeenCalled();
    expect(summaryService.assertEnabled).toHaveBeenCalledWith(REQUEST_ID, 12, null, deps, { needsActor: false });
  });

  test('no runs is not_analyzed', async () => {
    expect(await status()).toMatchObject({ state: 'not_analyzed', run: null, runCurrent: false });
  });

  test('a current ready run is current, and it is looked up by the exact source and prompt version', async () => {
    store.getLatestCurrentReadyRun.mockResolvedValue(readyRow());
    store.getLatestReadyRun.mockResolvedValue(readyRow());
    const result = await status();
    expect(result).toMatchObject({ state: 'current', runCurrent: true, run: { status: 'ready', record: { reception: 'mixed' } } });
    expect(store.getLatestCurrentReadyRun).toHaveBeenCalledWith({
      requestId: REQUEST_ID, sourceArtifactId: ARTIFACT_ID, sourceContentHash: HASH, promptVersion: 3,
    });
  });

  test('a ready run for an older source or prompt version is out_of_date and not flagged current', async () => {
    store.getLatestReadyRun.mockResolvedValue(readyRow({ prompt_version: 2 }));
    expect(await status()).toMatchObject({ state: 'out_of_date', runCurrent: false });
    promptVersion = 3;
    store.getLatestReadyRun.mockResolvedValue(readyRow({ source_content_hash: 'b'.repeat(64) }));
    expect(await status()).toMatchObject({ state: 'out_of_date', runCurrent: false });
  });

  test('a live generating run is analyzing, an abandoned one is not', async () => {
    store.getLatestRun.mockResolvedValue({ id: 'g', status: 'generating', created_at: iso(60) });
    expect((await status()).state).toBe('analyzing');
    store.getLatestRun.mockResolvedValue({ id: 'g', status: 'generating', created_at: iso(400) });
    expect((await status()).state).toBe('not_analyzed');
  });

  test('a re-analysis in progress still shows the current result', async () => {
    store.getLatestRun.mockResolvedValue({ id: 'g', status: 'generating', created_at: iso(30) });
    store.getLatestCurrentReadyRun.mockResolvedValue(readyRow());
    store.getLatestReadyRun.mockResolvedValue(readyRow());
    expect(await status()).toMatchObject({ state: 'analyzing', runCurrent: true });
  });

  test('a newer failed run after a ready run is reported; an older failure is not', async () => {
    store.getLatestReadyRun.mockResolvedValue(readyRow());
    store.getLatestRun.mockResolvedValue({ id: 'f', status: 'failed', created_at: iso(10), completed_at: iso(5) });
    expect((await status()).lastRunFailed).toBe(true);
    store.getLatestRun.mockResolvedValue({ id: 'f', status: 'failed', created_at: iso(900), completed_at: iso(890) });
    expect((await status()).lastRunFailed).toBe(false);
  });

  test('the accepted run is described with the accepting staff name and no record, and its own currentness', async () => {
    store.getAcceptedRun.mockResolvedValue(readyRow({ accepted_at: iso(100), accepted_by_profile_id: 9, prompt_version: 2 }));
    const result = await status();
    expect(store.getProfileName).toHaveBeenCalledWith({ profileId: 9 });
    expect(result.accepted).toEqual({ id: readyRow().id, acceptedAt: iso(100), acceptedByName: 'Alex Staff', current: false });
    expect(JSON.stringify(result.accepted)).not.toContain('reception');
  });

  test.each([PROMPT_STORE_ERROR_CODES.NOT_FOUND, PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT])(
    'a %s prompt error is a typed 409 in read and accept', async (code) => {
      deps.fetchCurrentPrompt.mockRejectedValue(Object.assign(new Error('raw adapter text'), { code }));
      await expect(status()).rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_prompt_not_ready' });
      await expect(acceptDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, runId: readyRow().id }, deps))
        .rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_prompt_not_ready' });
      expect(store.acceptRun).not.toHaveBeenCalled();
    });

  test('an unrelated prompt fetch failure is not mislabeled as not-ready', async () => {
    deps.fetchCurrentPrompt.mockRejectedValue(Object.assign(new Error('network'), { httpStatus: 502 }));
    await expect(status()).rejects.toMatchObject({ httpStatus: 502 });
    await expect(status()).rejects.not.toMatchObject({ code: 'sentiment_prompt_not_ready' });
  });
});

describe('analyze error mapping', () => {
  const analyze = () => analyzeDiscussionSentiment({ requestId: REQUEST_ID, ownerProfileId: 12, actingUserSystemId: '77777777-7777-4777-8777-777777777777' }, deps);

  test('the loader refusals keep their code and status but speak of analyzing, not summarizing', async () => {
    const cases = [
      ['staff_discussion_transcript_not_ready', 409, 'Generate the staff discussion transcript for the confirmed presentation end before summarizing.'],
      ['staff_discussion_transcript_integrity_failed', 409, 'The staff discussion transcript could not be verified. Generate it again, then summarize.'],
      ['staff_discussion_transcript_too_long', 422, 'The staff discussion transcript is too long to summarize in one request.'],
    ];
    for (const [code, httpStatus, message] of cases) {
      summaryService.loadVerifiedDiscussionTranscript.mockRejectedValueOnce(
        new ServiceHttpError(message, { httpStatus, code, body: { error: message, code } }));
      const error = await analyze().then(() => null, (thrown) => thrown);
      expect(error).toMatchObject({ code, httpStatus });
      expect(error.message).not.toMatch(/summar/i);
      expect(error.body.error).toBe(error.message);
    }
  });

  test('an unlisted loader error passes through unchanged', async () => {
    const original = new ServiceHttpError('too big', { httpStatus: 422, code: 'staff_discussion_transcript_empty', body: { error: 'too big' } });
    summaryService.loadVerifiedDiscussionTranscript.mockRejectedValueOnce(original);
    await expect(analyze()).rejects.toBe(original);
  });

  test('a missing current prompt during the run fails the run with a typed 409', async () => {
    const content = { text: '', utterances: [{ speaker: '1', start: 1000, end: 2000, text: 'hello there everyone' }] };
    summaryService.loadVerifiedDiscussionTranscript.mockResolvedValue({
      discussionRow: { wmkf_requestdocumentid: ARTIFACT_ID, wmkf_contenthash: HASH }, utteranceCount: 1,
      transcriptText: formatTranscriptText(content, {}, { layout: 'turn' }), speakerNames: {}, discussionContent: content,
    });
    deps.executePrompt = jest.fn(async () => { throw Object.assign(new Error('adapter'), { code: PROMPT_STORE_ERROR_CODES.NOT_FOUND }); });
    await expect(analyze()).rejects.toMatchObject({ httpStatus: 409, code: 'sentiment_prompt_not_ready' });
    expect(store.failRun).toHaveBeenCalledWith({ id: '44444444-4444-4444-8444-444444444444', failureCode: PROMPT_STORE_ERROR_CODES.NOT_FOUND });
  });
});
