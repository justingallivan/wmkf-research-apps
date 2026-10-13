/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));
jest.mock('../../lib/services/post-presentation-materials/presentation-transcript-service.js', () => ({ generatePresentationTranscript: jest.fn() }));

import {
  runPresentationTranscriptRegenerationTick, classifyGenerationError, TICK_WORK_MS,
} from '../../lib/services/meeting-tracker-transcription/presentation-transcript-regeneration-worker.js';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111', request_id: '22222222-2222-4222-8222-222222222222',
  transcript_artifact_id: '33333333-3333-4333-8333-333333333333', transcript_fingerprint: 'c'.repeat(64),
  actor_profile_id: 12, acting_user_system_id: '44444444-4444-4444-8444-444444444444', attempts: 1,
};
const httpError = (httpStatus, code, extra = {}) => Object.assign(new Error(code || 'x'), { httpStatus, code, ...extra });

function harness({ claims = [ROW], generate = jest.fn(async () => ({})), moves = {} } = {}) {
  const queue = claims.map(row => ({ row, leaseToken: 'lease' }));
  const deps = {
    recoverExpiredPresentationTranscriptRegenerations: jest.fn(async () => 0),
    claimPresentationTranscriptRegeneration: jest.fn(async () => queue.shift() || null),
    markPresentationTranscriptRegenerationDone: jest.fn(async () => ('done' in moves ? moves.done : { id: ROW.id })),
    supersedePresentationTranscriptRegeneration: jest.fn(async () => moves.superseded ?? { id: ROW.id }),
    failPresentationTranscriptRegeneration: jest.fn(async () => moves.failed ?? { id: ROW.id }),
    retryPresentationTranscriptRegeneration: jest.fn(async () => moves.retry ?? { state: 'pending' }),
    generate, now: () => 1_000, log: jest.fn(),
  };
  return deps;
}
const tick = (deps, opts = {}) => runPresentationTranscriptRegenerationTick({ deadlineMs: 1_000 + TICK_WORK_MS, ...opts }, deps);
const FENCE = { id: ROW.id, leaseToken: 'lease' };

test('calls the generator as the stored actor with the stored expectations, then marks the row done', async () => {
  const deps = harness();
  const result = await tick(deps);
  expect(deps.generate).toHaveBeenCalledWith({ requestId: ROW.request_id, ownerProfileId: 12, actingUserSystemId: ROW.acting_user_system_id,
    body: { expectedCurrentArtifactId: ROW.transcript_artifact_id, expectedCurrentFingerprint: ROW.transcript_fingerprint } });
  expect(deps.markPresentationTranscriptRegenerationDone).toHaveBeenCalledWith(FENCE);
  expect(result).toMatchObject({ outcome: 'worked', worked: 1, results: [{ outcome: 'done', code: null }] });
});

test('reclaims expired leases before claiming', async () => {
  const deps = harness({ claims: [] });
  const order = [];
  deps.recoverExpiredPresentationTranscriptRegenerations.mockImplementation(async () => { order.push('recover'); return 0; });
  deps.claimPresentationTranscriptRegeneration.mockImplementation(async () => { order.push('claim'); return null; });
  expect(await tick(deps)).toMatchObject({ outcome: 'idle', worked: 0 });
  expect(order).toEqual(['recover', 'claim']);
});

describe('outcome table', () => {
  test('409 meeting_transcript_current_changed -> superseded, no retry', async () => {
    const deps = harness({ generate: jest.fn(async () => { throw httpError(409, 'meeting_transcript_current_changed'); }) });
    const result = await tick(deps);
    expect(deps.supersedePresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: 'meeting_transcript_current_changed' });
    expect(deps.retryPresentationTranscriptRegeneration).not.toHaveBeenCalled();
    expect(deps.failPresentationTranscriptRegeneration).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toBe('superseded');
  });

  test('supervised-test-mode refusal (also a 409) -> failed, not superseded', async () => {
    const deps = harness({ generate: jest.fn(async () => { throw httpError(409, 'meeting_transcription_supervised_test_unsupported'); }) });
    const result = await tick(deps);
    expect(deps.failPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: 'meeting_transcription_supervised_test_unsupported' });
    expect(deps.supersedePresentationTranscriptRegeneration).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toBe('failed');
  });

  test.each([
    ['another 409 (site visit changed)', httpError(409, 'meeting_transcript_site_visit_changed')],
    ['404 not available', httpError(404, 'post_presentation_not_available')],
    ['403 actor required', httpError(403, 'post_presentation_actor_required')],
    ['422', httpError(422, 'presentation_end_invalid')],
  ])('%s -> failed with its code, no retry', async (_label, error) => {
    const deps = harness({ generate: jest.fn(async () => { throw error; }) });
    await tick(deps);
    expect(deps.failPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: error.code });
    expect(deps.retryPresentationTranscriptRegeneration).not.toHaveBeenCalled();
  });

  test.each([
    ['502 Graph', httpError(502, 'presentation_transcript_registry_unconfirmed')],
    ['503 not ready', httpError(503, 'post_presentation_schema_not_ready')],
    ['Graph status field', Object.assign(new Error('x'), { status: 504, code: 'graph_timeout' })],
    ['network error with no status', Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })],
    ['timeout abort', Object.assign(new Error('t'), { name: 'AbortError' })],
    ['flagged transient', Object.assign(new Error('t'), { isTransient: true })],
    ['no response', Object.assign(new Error('t'), { noResponse: true })],
    ['429 throttled', httpError(429, 'graph_throttled')],
    ['slot busy (a crashed worker\'s material lease)', httpError(409, 'post_presentation_slot_busy', { body: { retryable: true } })],
    ['any error flagged retryable', httpError(409, 'some_other_code', { body: { retryable: true } })],
  ])('%s -> retry (pending with backoff, or failed at the cap, decided by the store)', async (_label, error) => {
    const deps = harness({ generate: jest.fn(async () => { throw error; }) });
    const result = await tick(deps);
    expect(deps.retryPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: expect.stringMatching(/^[a-z0-9_]{1,80}$/) });
    expect(deps.failPresentationTranscriptRegeneration).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toBe('pending');
  });

  test('a retry the store turns into failed (attempt cap) reports failed with the last code', async () => {
    const deps = harness({ generate: jest.fn(async () => { throw httpError(503, 'post_presentation_schema_not_ready'); }), moves: { retry: { state: 'failed' } } });
    const result = await tick(deps);
    expect(deps.retryPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: 'post_presentation_schema_not_ready' });
    expect(result.results[0]).toEqual({ outcome: 'failed', code: 'post_presentation_schema_not_ready' });
  });

  test('a recovered row whose generator hits slot_busy goes back to pending, and fails only at the attempt cap', async () => {
    const busy = () => { throw httpError(409, 'post_presentation_slot_busy', { body: { retryable: true } }); };
    const early = harness({ generate: jest.fn(async () => busy()) });
    expect((await tick(early)).results[0]).toEqual({ outcome: 'pending', code: 'post_presentation_slot_busy' });
    expect(early.failPresentationTranscriptRegeneration).not.toHaveBeenCalled();
    const capped = harness({ claims: [{ ...ROW, attempts: 3 }], generate: jest.fn(async () => busy()), moves: { retry: { state: 'failed' } } });
    expect((await tick(capped)).results[0]).toEqual({ outcome: 'failed', code: 'post_presentation_slot_busy' });
    expect(capped.retryPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: 'post_presentation_slot_busy' });
  });

  test('current_changed and supervised-test keep their meaning', () => {
    expect(classifyGenerationError(httpError(409, 'meeting_transcript_current_changed', { body: { retryable: true } })).kind).toBe('superseded');
    expect(classifyGenerationError(httpError(409, 'meeting_transcription_supervised_test_unsupported', { body: { retryable: true } })).kind).toBe('failed');
  });

  test('a transient error with an unusable code is stored under a safe fallback code', async () => {
    const deps = harness({ generate: jest.fn(async () => { throw Object.assign(new Error('x'), { status: 500, code: 'Bad Code With Spaces' }); }) });
    await tick(deps);
    expect(deps.retryPresentationTranscriptRegeneration).toHaveBeenCalledWith({ ...FENCE, failureCode: 'presentation_transcript_regeneration_transient' });
  });

  test('a lost lease (null move) is reported and not treated as an outcome', async () => {
    const deps = harness({ moves: { done: null } });
    expect((await tick(deps)).results[0].outcome).toBe('lease_lost');
  });
});

describe('scheduling', () => {
  test('stops claiming when less than one generation of time remains', async () => {
    const deps = harness({ claims: [ROW, { ...ROW, id: '99999999-9999-4999-8999-999999999999' }] });
    deps.now = () => 1_000 + TICK_WORK_MS - 1_000;
    const result = await tick(deps);
    expect(result.worked).toBe(1);
    expect(deps.claimPresentationTranscriptRegeneration).toHaveBeenCalledTimes(1);
  });

  test('works several due rows in one tick while time remains, up to the cap', async () => {
    const claims = Array.from({ length: 8 }, (_, i) => ({ ...ROW, id: `11111111-1111-4111-8111-11111111111${i}` }));
    const deps = harness({ claims });
    expect((await tick(deps)).worked).toBe(5);
  });

  test('a missing table (migration 081 not applied) idles quietly instead of failing the tick', async () => {
    const deps = harness();
    deps.recoverExpiredPresentationTranscriptRegenerations.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    expect(await tick(deps)).toEqual({ outcome: 'schema_not_ready', worked: 0, results: [] });
  });

  test('any other store error fails the tick so the cron reports it', async () => {
    const deps = harness();
    deps.claimPresentationTranscriptRegeneration.mockRejectedValue(new Error('connection lost'));
    await expect(tick(deps)).rejects.toThrow('connection lost');
  });
});

describe('classifyGenerationError', () => {
  test('only 409 with the current-changed code is superseded', () => {
    expect(classifyGenerationError(httpError(409, 'meeting_transcript_current_changed')).kind).toBe('superseded');
    expect(classifyGenerationError(httpError(500, 'meeting_transcript_current_changed')).kind).not.toBe('superseded');
  });
  test('a coded 4xx is failed; a bare 400 without code is failed', () => {
    expect(classifyGenerationError(httpError(400, undefined)).kind).toBe('failed');
    expect(classifyGenerationError(httpError(401, 'profile_required')).kind).toBe('failed');
  });
});
