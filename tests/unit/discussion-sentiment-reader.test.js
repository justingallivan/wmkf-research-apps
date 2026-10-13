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

  test('a request the feature is not enabled for is none; a server failure is not swallowed', async () => {
    acceptedRows[A] = accepted();
    summaryService.assertEnabled.mockImplementationOnce(() => { throw new ServiceHttpError('off', { httpStatus: 404, code: 'post_presentation_not_available' }); });
    expect((await read())[A]).toMatchObject({ status: 'none', sentiment: null });
    deps.loadBinding.mockRejectedValueOnce(new ServiceHttpError('down', { httpStatus: 503, code: 'x' }));
    await expect(read()).rejects.toMatchObject({ httpStatus: 503 });
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
