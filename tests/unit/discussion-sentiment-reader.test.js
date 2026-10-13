/**
 * Read contract for other apps (plan §4.6, §7): only the accepted, not withdrawn, current row yields a
 * sentiment; Meeting Tracker access is required.
 * @jest-environment node
 */
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/services/app-access-service.js', () => ({ listAppKeysForUser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));
jest.mock('../../lib/services/post-presentation-materials/transcript-summary-service.js', () => ({
  TRANSCRIPT_SUMMARY_DEPENDENCIES: {},
  assertEnabled: jest.fn(),
  bindCurrent: jest.fn(),
  loadVerifiedDiscussionTranscript: jest.fn(),
}));

import { sql } from '@vercel/postgres';
import { listAppKeysForUser } from '../../lib/services/app-access-service.js';
import * as summaryService from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import { requireMeetingTranscriptionEnabled } from '../../lib/services/meeting-tracker-transcription/policy.js';
import { PROMPT_STORE_ERROR_CODES } from '../../lib/services/prompt-store.js';
import { ServiceHttpError } from '../../lib/services/service-http-error.js';
import {
  getDeliberationSentiments, hasMeetingTrackerAccess, DELIBERATION_SENTIMENT_MAX_REQUESTS,
} from '../../lib/services/post-presentation-materials/discussion-sentiment-reader.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '55555555-5555-4555-8555-555555555555';
const ARTIFACT = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);
const RECORD = { schemaVersion: 1, reception: 'positive', enthusiasm: 'high' };
const accepted = (overrides = {}) => ({
  id: '33333333-3333-4333-8333-333333333333', status: 'ready', source_artifact_id: ARTIFACT, source_content_hash: HASH,
  prompt_version: 4, record: RECORD, completed_at: '2026-10-13T10:00:00Z', accepted_at: '2026-10-13T11:00:00Z', withdrawn_at: null,
  ...overrides,
});

let acceptedRows; let bound; let deps; let access;
beforeEach(() => {
  access = true;
  acceptedRows = {};
  bound = { discussion: { reason: 'bound', staffDiscussionTranscript: { wmkf_requestdocumentid: ARTIFACT, wmkf_contenthash: HASH } } };
  summaryService.assertEnabled.mockReset();
  summaryService.bindCurrent.mockReset().mockImplementation(async () => bound);
  deps = {
    hasMeetingTrackerAccess: jest.fn(async () => access),
    loadBinding: jest.fn(async (requestId) => ({ requestId })),
    fetchCurrentPrompt: jest.fn(async () => ({ wmkf_promptversion: 4 })),
    sentiments: { getAcceptedRun: jest.fn(async ({ requestId }) => acceptedRows[requestId] || null) },
  };
});
const read = (ids = [A], ctx = { profileId: 12 }) => getDeliberationSentiments(ids, ctx, deps);

describe('what a consumer may see', () => {
  test('the accepted, not withdrawn, current row returns its record', async () => {
    acceptedRows[A] = accepted();
    expect(await read()).toEqual({ [A]: { status: 'current', analyzedAt: '2026-10-13T10:00:00Z', promptVersion: 4, sentiment: RECORD } });
  });

  test('no accepted row (an unaccepted result) gives none and no sentiment', async () => {
    expect(await read()).toEqual({ [A]: { status: 'none', analyzedAt: null, promptVersion: null, sentiment: null } });
  });

  test.each([
    ['an unaccepted ready row the store returned', { accepted_at: null }],
    ['a withdrawn row', { withdrawn_at: '2026-10-13T12:00:00Z' }],
    ['a row that is not ready', { status: 'failed', record: null }],
  ])('%s never yields a sentiment (the reader re-checks, not only the store query)', async (_label, overrides) => {
    acceptedRows[A] = accepted(overrides);
    const result = await read();
    expect(result[A]).toMatchObject({ status: 'none', sentiment: null });
  });

  test.each([
    ['a transcript republish (new hash)', { source_content_hash: 'b'.repeat(64) }],
    ['another source artifact', { source_artifact_id: '99999999-9999-4999-8999-999999999999' }],
    ['a prompt version bump', { prompt_version: 3 }],
  ])('%s makes the accepted row out_of_date with no sentiment', async (_label, overrides) => {
    acceptedRows[A] = accepted(overrides);
    const result = await read();
    expect(result[A]).toMatchObject({ status: 'out_of_date', sentiment: null, promptVersion: Number(overrides.prompt_version || 4) });
    expect(result[A].analyzedAt).toBe('2026-10-13T10:00:00Z');
  });

  test('an unbound transcript makes the accepted row out_of_date', async () => {
    acceptedRows[A] = accepted();
    bound = { discussion: { reason: 'discussion_missing' } };
    expect((await read())[A]).toMatchObject({ status: 'out_of_date', sentiment: null });
  });

  test('each request is judged on its own row; duplicates collapse', async () => {
    acceptedRows[A] = accepted();
    acceptedRows[B] = accepted({ accepted_at: null });
    const result = await read([A, B, A.toUpperCase()]);
    expect(Object.keys(result).sort()).toEqual([A, B].sort());
    expect(result[A].sentiment).toEqual(RECORD);
    expect(result[B].sentiment).toBeNull();
  });

  test('the REAL transcription-disabled error (a plain Error with code and httpStatus 503) reads as none for that request only', async () => {
    acceptedRows[A] = accepted(); acceptedRows[B] = accepted();
    summaryService.assertEnabled.mockImplementation((requestId) => {
      if (requestId === A) requireMeetingTranscriptionEnabled(requestId, {}); // real policy.js throw: schema flag unset
    });
    let thrown;
    try { requireMeetingTranscriptionEnabled(A, {}); } catch (error) { thrown = error; }
    expect(thrown).toMatchObject({ code: 'meeting_transcription_disabled', httpStatus: 503 });
    expect(thrown).not.toBeInstanceOf(ServiceHttpError);
    const result = await read([A, B]);
    expect(result[A]).toMatchObject({ status: 'none', sentiment: null });
    expect(result[B]).toMatchObject({ status: 'current', sentiment: RECORD });
  });

  test.each([
    ['post_presentation_not_available', new ServiceHttpError('x', { httpStatus: 404, code: 'post_presentation_not_available' })],
    ['a 4xx ServiceHttpError', new ServiceHttpError('x', { httpStatus: 409, code: 'whatever' })],
    ['meeting_transcript_bundle_schema_not_ready', new ServiceHttpError('x', { httpStatus: 503, code: 'meeting_transcript_bundle_schema_not_ready' })],
  ])('%s reads as none and does not fail the batch', async (_label, error) => {
    acceptedRows[A] = accepted(); acceptedRows[B] = accepted();
    summaryService.assertEnabled.mockImplementation((requestId) => { if (requestId === A) throw error; });
    const result = await read([A, B]);
    expect(result[A].sentiment).toBeNull();
    expect(result[B].sentiment).toEqual(RECORD);
  });

  test('genuine infrastructure failures are not swallowed', async () => {
    deps.loadBinding.mockRejectedValueOnce(new ServiceHttpError('down', { httpStatus: 503, code: 'upstream_down' }));
    await expect(read()).rejects.toMatchObject({ httpStatus: 503, code: 'upstream_down' });
    deps.loadBinding.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(read()).rejects.toThrow('socket hang up');
  });

  test.each([
    ['unseeded', Object.assign(new Error('none'), { code: PROMPT_STORE_ERROR_CODES.NOT_FOUND })],
    ['duplicate', Object.assign(new Error('two'), { code: PROMPT_STORE_ERROR_CODES.DUPLICATE_CURRENT })],
  ])('an %s prompt makes nothing current but does not throw for the batch', async (_label, error) => {
    deps.fetchCurrentPrompt.mockRejectedValue(error);
    acceptedRows[A] = accepted();
    const result = await read([A, B]);
    expect(result[A]).toMatchObject({ status: 'out_of_date', sentiment: null, promptVersion: 4 });
    expect(result[B]).toMatchObject({ status: 'none', sentiment: null });
  });

  test('an unrelated prompt fetch failure still throws', async () => {
    deps.fetchCurrentPrompt.mockRejectedValue(Object.assign(new Error('network'), { httpStatus: 502 }));
    await expect(read()).rejects.toThrow('network');
  });
});

describe('access and input limits', () => {
  test('without Meeting Tracker access nothing is read and the call is 403', async () => {
    access = false;
    acceptedRows[A] = accepted();
    await expect(read()).rejects.toMatchObject({ httpStatus: 403, code: 'sentiment_read_forbidden' });
    expect(deps.fetchCurrentPrompt).not.toHaveBeenCalled();
    expect(deps.loadBinding).not.toHaveBeenCalled();
    expect(deps.sentiments.getAcceptedRun).not.toHaveBeenCalled();
  });

  test('the access check gets the context profile id, and a missing context is refused', async () => {
    await read([A], { profileId: 12 });
    expect(deps.hasMeetingTrackerAccess).toHaveBeenCalledWith(12);
    access = false;
    await expect(getDeliberationSentiments([A], undefined, deps)).rejects.toMatchObject({ httpStatus: 403 });
  });

  test('access is checked before the ids are validated', async () => {
    access = false;
    await expect(read(['nope'])).rejects.toMatchObject({ httpStatus: 403 });
  });

  test.each([[['not-a-guid']], ['string'], [[A, 5]], [null]])('invalid ids %j are 400', async (ids) => {
    await expect(read(ids)).rejects.toMatchObject({ httpStatus: 400, code: 'sentiment_read_invalid_request_ids' });
  });

  test('more than the cap is refused and exactly the cap is allowed', async () => {
    const make = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await expect(read(make(DELIBERATION_SENTIMENT_MAX_REQUESTS + 1))).rejects.toMatchObject({ httpStatus: 400 });
    expect(Object.keys(await read(make(DELIBERATION_SENTIMENT_MAX_REQUESTS)))).toHaveLength(DELIBERATION_SENTIMENT_MAX_REQUESTS);
    expect(await read([])).toEqual({});
  });
});

describe('hasMeetingTrackerAccess (live profile check, then the existing grant lookup)', () => {
  const profile = (over = {}) => ({ rows: [{ is_active: true, is_superuser: false, ...over }] });
  beforeEach(() => { sql.mockReset().mockResolvedValue(profile()); listAppKeysForUser.mockReset().mockResolvedValue(['meeting-tracker']); });

  test('the meeting-tracker grant passes; another app grant does not', async () => {
    expect(await hasMeetingTrackerAccess(12)).toBe(true);
    expect(listAppKeysForUser).toHaveBeenCalledWith(12, { throwOnError: true });
    listAppKeysForUser.mockResolvedValue(['proposal-ranking']);
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
  });

  test('a superuser passes without a grant lookup', async () => {
    sql.mockResolvedValue(profile({ is_superuser: true }));
    expect(await hasMeetingTrackerAccess(12)).toBe(true);
    expect(listAppKeysForUser).not.toHaveBeenCalled();
  });

  test('an inactive or missing profile is refused even with the grant or the superuser role', async () => {
    sql.mockResolvedValue(profile({ is_active: false }));
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    sql.mockResolvedValue(profile({ is_active: false, is_superuser: true }));
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    sql.mockResolvedValue({ rows: [] });
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    sql.mockResolvedValue(profile({ is_active: null }));
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    expect(listAppKeysForUser).not.toHaveBeenCalled();
  });

  test('a lookup failure or a bad profile id fails closed', async () => {
    listAppKeysForUser.mockRejectedValue(new Error('dataverse down'));
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    sql.mockRejectedValue(new Error('postgres down'));
    expect(await hasMeetingTrackerAccess(12)).toBe(false);
    expect(await hasMeetingTrackerAccess(null)).toBe(false);
    expect(await hasMeetingTrackerAccess('12')).toBe(false);
  });
});
