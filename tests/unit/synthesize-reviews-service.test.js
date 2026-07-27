/**
 * Logic-level unit tests for lib/services/review-manager/synthesize-reviews-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapters + Executor mocked; covers the success payload, all three 409
 * domain shapes (no_submitted_reviews / already_exists / conflict), the
 * writeback-failure 409-vs-502 split with writtenToDynamics:false, and the
 * regeneration gate (populated column + no overwrite refuses BEFORE the LLM).
 */

const findByRequest = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findByRequest: (...a) => findByRequest(...a),
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));
const queryReviewers = jest.fn(async () => ({ records: [] }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  queryReviewers: (...a) => queryReviewers(...a),
}));
const queryAllAnswers = jest.fn(async () => ({ records: [], capped: false }));
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  queryAllAnswers: (...a) => queryAllAnswers(...a),
}));
const executePrompt = jest.fn();
jest.mock('../../lib/services/execute-prompt', () => ({
  executePrompt: (...a) => executePrompt(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'su-1';

let synthesizeReviews;
let SynthesizeReviewsError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/synthesize-reviews-service');
  synthesizeReviews = mod.synthesizeReviews;
  SynthesizeReviewsError = mod.SynthesizeReviewsError;
});

function submittedSuggestion(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: 'person-1',
    wmkf_accepted: true,
    wmkf_reviewreceivedat: '2026-06-01T00:00:00Z',
    wmkf_revieweraffiliation: 'MIT',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findByRequest.mockResolvedValue([submittedSuggestion()]);
  queryReviewers.mockResolvedValue({ records: [{ wmkf_potentialreviewersid: 'person-1', wmkf_name: 'Dr. Jane' }] });
  queryAllAnswers.mockResolvedValue({ records: [], capped: false });
  getRequestById.mockResolvedValue({ wmkf_reviewsynthesisjson: null });
  executePrompt.mockResolvedValue({
    runId: 'run-1',
    blocked: false,
    parsed: { synthesis: { summary: 'good' } },
    writeResults: { results: [{ output: 'synthesis', ok: true }] },
  });
});

test('success: digest reaches the Executor; returns synthesis payload', async () => {
  const out = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: ACTOR });
  expect(out).toEqual({ ok: true, synthesis: { summary: 'good' }, runId: 'run-1', writtenToDynamics: true });
  const call = executePrompt.mock.calls[0][0];
  expect(call.promptName).toBe('review-synthesis.generate');
  expect(call.requestId).toBe(REQ);
  expect(call.overrideVariables.reviews_digest).toContain('Dr. Jane');
  expect(call.forceOverwrite).toBe(false);
  expect(call.actingUserSystemId).toBe(ACTOR);
});

test('confirmed max_tokens truncation retries once with a larger bounded budget', async () => {
  const firstRunId = '33333333-3333-4333-8333-333333333333';
  const truncated = Object.assign(new Error('truncated'), {
    code: 'claude_output_truncated',
    maxTokens: 8000,
    runId: firstRunId,
  });
  executePrompt
    .mockRejectedValueOnce(truncated)
    .mockResolvedValueOnce({
      runId: 'run-2',
      blocked: false,
      parsed: { synthesis: { summary: 'recovered' } },
      writeResults: { results: [{ output: 'synthesis', ok: true }] },
      meta: { retryOfRunId: firstRunId },
    });

  const out = await synthesizeReviews({
    requestId: REQ,
    overwrite: false,
    actingUserSystemId: ACTOR,
  });

  expect(out.runId).toBe('run-2');
  expect(out.retryOfRunId).toBe(firstRunId);
  expect(executePrompt).toHaveBeenCalledTimes(2);
  expect(executePrompt.mock.calls[0][0].maxTokensOverride).toBeUndefined();
  expect(executePrompt.mock.calls[1][0].maxTokensOverride).toBe(16000);
  expect(executePrompt.mock.calls[1][0].semanticAttempt).toBe(2);
  expect(executePrompt.mock.calls[1][0].retryOfRunId).toBe(firstRunId);
  expect(executePrompt.mock.calls[1][0].overrideVariables)
    .toEqual(executePrompt.mock.calls[0][0].overrideVariables);
});

test('retry budget increases to the 32000 cap, then truncation at/above the cap is terminal', async () => {
  const at16000 = Object.assign(new Error('truncated'), {
    code: 'claude_output_truncated',
    maxTokens: 16000,
    runId: null,
  });
  executePrompt
    .mockRejectedValueOnce(at16000)
    .mockResolvedValueOnce({
      runId: 'run-2',
      blocked: false,
      parsed: { synthesis: { summary: 'recovered' } },
      writeResults: { results: [{ output: 'synthesis', ok: true }] },
    });
  await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: ACTOR });
  expect(executePrompt).toHaveBeenCalledTimes(2);
  expect(executePrompt.mock.calls[1][0]).toMatchObject({
    maxTokensOverride: 32000,
    semanticAttempt: 2,
    retryOfRunId: null,
  });

  for (const maxTokens of [32000, 40000]) {
    executePrompt.mockClear();
    const truncated = Object.assign(new Error('truncated'), {
      code: 'claude_output_truncated',
      maxTokens,
      runId: 'failed-run',
    });
    executePrompt.mockRejectedValueOnce(truncated);
    const error = await synthesizeReviews({
      requestId: REQ,
      overwrite: false,
      actingUserSystemId: ACTOR,
    }).catch((err) => err);
    expect(error).toBe(truncated);
    expect(executePrompt).toHaveBeenCalledTimes(1);
  }
});

test('a second max_tokens truncation is terminal; no third semantic attempt', async () => {
  const truncated = (runId, maxTokens) => Object.assign(new Error('truncated'), {
    code: 'claude_output_truncated',
    maxTokens,
    runId,
  });
  executePrompt
    .mockRejectedValueOnce(truncated('failed-run-1', 8000))
    .mockRejectedValueOnce(truncated('failed-run-2', 16000));

  const error = await synthesizeReviews({
    requestId: REQ,
    overwrite: false,
    actingUserSystemId: ACTOR,
  }).catch((err) => err);

  expect(error.runId).toBe('failed-run-2');
  expect(executePrompt).toHaveBeenCalledTimes(2);
});

test('ordinary malformed JSON and schema failures do not retry', async () => {
  for (const code of ['claude_output_invalid_json', null]) {
    executePrompt.mockClear();
    const error = Object.assign(new Error('not recoverable'), code ? { code } : {});
    executePrompt.mockRejectedValueOnce(error);

    const received = await synthesizeReviews({
      requestId: REQ,
      overwrite: false,
      actingUserSystemId: ACTOR,
    }).catch((err) => err);

    expect(received).toBe(error);
    expect(executePrompt).toHaveBeenCalledTimes(1);
  }
});

test('zero submitted reviews → 409 no_submitted_reviews WITHOUT calling the LLM', async () => {
  findByRequest.mockResolvedValueOnce([submittedSuggestion({ wmkf_accepted: false })]);
  const err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err).toBeInstanceOf(SynthesizeReviewsError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'no_submitted_reviews' });
  expect(executePrompt).not.toHaveBeenCalled();
});

test('regeneration gate: populated column + no overwrite → 409 already_exists with modifiedOn, LLM not called', async () => {
  getRequestById.mockResolvedValueOnce({ wmkf_reviewsynthesisjson: '{"summary":"old"}', modifiedon: '2026-06-02T00:00:00Z' });
  const err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'already_exists', modifiedOn: '2026-06-02T00:00:00Z' });
  expect(executePrompt).not.toHaveBeenCalled();
});

test('overwrite:true bypasses the gate and forwards forceOverwrite', async () => {
  getRequestById.mockResolvedValueOnce({ wmkf_reviewsynthesisjson: '{"summary":"old"}', modifiedon: 'x' });
  const out = await synthesizeReviews({ requestId: REQ, overwrite: true, actingUserSystemId: null });
  expect(out.ok).toBe(true);
  expect(executePrompt.mock.calls[0][0].forceOverwrite).toBe(true);
});

test('result.blocked → 409 conflict with runId + conflicts', async () => {
  executePrompt.mockResolvedValueOnce({ blocked: true, runId: 'run-2', conflicts: ['synthesis'] });
  const err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'conflict', runId: 'run-2', conflicts: ['synthesis'] });
});

test('writeback failure: concurrent_edit → 409; other/missing reason → 502 writeback_failed; both writtenToDynamics:false', async () => {
  executePrompt.mockResolvedValueOnce({
    blocked: false, runId: 'run-3',
    writeResults: { results: [{ output: 'synthesis', ok: false, reason: 'concurrent_edit' }] },
  });
  let err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'concurrent_edit', runId: 'run-3', writtenToDynamics: false });

  executePrompt.mockResolvedValueOnce({ blocked: false, runId: 'run-4', writeResults: { results: [] } });
  err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(502);
  expect(err.body).toEqual({ ok: false, reason: 'writeback_failed', runId: 'run-4', writtenToDynamics: false });
});

test('capped answer query throws UNTYPED (shell maps to 500 server_error)', async () => {
  queryAllAnswers.mockResolvedValueOnce({ records: [], capped: true });
  const err = await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: null }).catch((e) => e);
  expect(err).not.toBeInstanceOf(SynthesizeReviewsError);
  expect(err.message).toMatch(/truncated at the 5000-row cap/);
});

test('chunk boundary: person-name lookup chunks at 25 ids, first call gets ids 0-24 in order, second gets id 25', async () => {
  const personIds = Array.from({ length: 26 }, (_, i) => `person-${i}`);
  findByRequest.mockResolvedValueOnce(
    personIds.map((pid, i) => submittedSuggestion({
      wmkf_appreviewersuggestionid: `sug-${i}`,
      _wmkf_potentialreviewer_value: pid,
    })),
  );
  await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: ACTOR });

  expect(queryReviewers).toHaveBeenCalledTimes(2);
  const firstFilter = queryReviewers.mock.calls[0][0].filter;
  const secondFilter = queryReviewers.mock.calls[1][0].filter;
  expect(firstFilter.split(' or ')).toEqual(
    personIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
  );
  expect(secondFilter.split(' or ')).toEqual(
    personIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
  );
});

test('chunk boundary: answer-text lookup chunks at 20 suggestion ids, first call gets ids 0-19 in order, second gets id 20', async () => {
  const suggestionIds = Array.from({ length: 21 }, (_, i) => `sug-${i}`);
  findByRequest.mockResolvedValueOnce(
    suggestionIds.map((sid) => submittedSuggestion({ wmkf_appreviewersuggestionid: sid })),
  );
  await synthesizeReviews({ requestId: REQ, overwrite: false, actingUserSystemId: ACTOR });

  expect(queryAllAnswers).toHaveBeenCalledTimes(2);
  const firstFilter = queryAllAnswers.mock.calls[0][0].filter;
  const secondFilter = queryAllAnswers.mock.calls[1][0].filter;
  expect(firstFilter.split(' or ')).toEqual(
    suggestionIds.slice(0, 20).map((id) => `_wmkf_appreviewersuggestion_value eq ${id}`),
  );
  expect(secondFilter.split(' or ')).toEqual(
    suggestionIds.slice(20).map((id) => `_wmkf_appreviewersuggestion_value eq ${id}`),
  );
});
