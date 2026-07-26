/**
 * Route-level tests for POST /api/external/review/[token]/submit.
 *
 * The route is public; verifySuggestionToken is the authorization boundary and
 * computeEngagementState (real) is the stage gate. We mock the token verifier,
 * rate limiter, Dynamics (executeChangeset + entity-set resolve), the restriction
 * bypass, and the draft service — and let sanitize/validate/build run for real so
 * the full submit pipeline is exercised end-to-end.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { verifySuggestionToken } from '../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { DynamicsService } from '../../lib/services/dynamics-service';
import ReviewDraftService from '../../lib/services/review-draft-service';

jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(),
  // Inline twin of the real tokenHasOp (fail-closed on missing/malformed ops).
  // Not jest.requireActual: loading the real module pulls in jose's ESM build,
  // which this jest environment cannot parse (see project-jsdom-serverless-esm-incompat).
  // The real predicate is unit-tested in tests/unit/verify-suggestion-token.test.js.
  tokenHasOp: (verified, op) =>
    Array.isArray(verified?.payload?.ops) && verified.payload.ops.includes(op),
}));
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
  // core/changeset.js#runChangeset asserts a trusted DAL context (Stage 7,
  // docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md); this route's own bypass above
  // is mocked to a no-op passthrough, so the assertion is mocked too — the
  // route establishes a real context in production.
  assertTrustedDalContext: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveEntitySetName: jest.fn(async () => 'wmkf_appreviewanswers'),
    executeChangeset: jest.fn(async () => ({ ok: true, operations: [] })),
    getRecord: jest.fn(async () => ({ _etag: 'W/"fresh"' })),
  },
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  deleteBySuggestion: jest.fn(async () => 1),
}));
// The route loads the question set from Dataverse; mock the fetcher to return the
// static schema fields so the submit pipeline behaves exactly as before.
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  return {
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    getAuthoritativeQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    questionSetVersion: jest.fn(() => 'testver'),
  };
});

const SUGGESTION_ID = '550e8400-e29b-41d4-a716-446655440000';
const ETAG = 'W/"1234567"';

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _etag: ETAG,
    wmkf_reviewstatus: 100000001, // materials sent → stage2b
    wmkf_reviewreceivedat: null,
    wmkf_accepted: true,
    wmkf_declined: false,
    ...overrides,
  };
}

function validAnswers(overrides = {}) {
  return {
    affiliation: 'Professor of Physics, Example University',
    priorWork: '<p>Distinct prior work.</p>',
    foreseenImpacts: '<p>Significant impact.</p>',
    impactAreas: [1, 3],
    riskLevel: 2,
    riskDetail: '<p>Technical risks.</p>',
    methodsAppropriate: '<p>Methods appropriate.</p>',
    teamCapacity: '<p>Strong team.</p>',
    questionsForPi: '<p>No issues.</p>',
    traditionalFunding: '<p>Unlikely elsewhere.</p>',
    overallAssessment: 4,
    additionalComments: '',
    ...overrides,
  };
}

let handler;
beforeAll(async () => {
  const mod = await import('../../pages/api/external/review/[token]/submit');
  handler = mod.default;
});

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
  verifySuggestionToken.mockResolvedValue({
    ok: true,
    suggestion: suggestion(),
    payload: { ops: ['download_proposal', 'upload_review'] },
  });
  DynamicsService.resolveEntitySetName.mockResolvedValue('wmkf_appreviewanswers');
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
  DynamicsService.getRecord.mockResolvedValue({ _etag: 'W/"fresh"' });
  ReviewDraftService.deleteBySuggestion.mockResolvedValue(1);
});

function post(body) {
  const req = createMockReq({ method: 'POST', query: { token: 't' }, body });
  const res = createMockRes();
  return { req, res };
}

describe('shared guards', () => {
  it('405s a non-POST method', async () => {
    const { req, res } = post({});
    req.method = 'GET';
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('429s when rate limited', async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const { req, res } = post({});
    await handler(req, res);
    expect(res.statusCode).toBe(429);
    expect(res._headers['Retry-After']).toBe('30');
  });

  it('401s on token failure and records the outcome', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'hash_mismatch' });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(recordTokenOutcome).toHaveBeenCalledWith(req, 't', false);
  });

  it('404s when the token is not found', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('403s when the verified token ops does not include upload_review', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion(),
      payload: { ops: ['download_proposal'] },
    });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._data).toMatchObject({ ok: false, reason: 'op_not_permitted' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('403s when the verified token has a missing/malformed ops array', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion(),
      payload: {},
    });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._data).toMatchObject({ ok: false, reason: 'op_not_permitted' });
  });
});

describe('finality + stage gates', () => {
  it('409s review_received_locked when already submitted (does not write)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ wmkf_reviewreceivedat: '2026-06-01T00:00:00Z' }),
      payload: { ops: ['download_proposal', 'upload_review'] },
    });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'review_received_locked' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('409s materials_not_sent outside the authoring stage', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ wmkf_reviewstatus: 100000000, wmkf_accepted: false }),
      payload: { ops: ['download_proposal', 'upload_review'] },
    });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'materials_not_sent' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('400s with errors when a required answer is empty (and does not write)', async () => {
    const { req, res } = post({ answers: validAnswers({ foreseenImpacts: '<p></p>' }) });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data.reason).toBe('validation');
    expect(res._data.errors.join(' ')).toMatch(/Q2.*required/);
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('400s a removed/out-of-range rating value', async () => {
    const { req, res } = post({ answers: validAnswers({ riskLevel: 99 }) });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data.errors.join(' ')).toMatch(/invalid choice/);
  });

  it('409s set_changed when the client submits a stale setVersion (does not write)', async () => {
    // The mocked questionSetVersion returns 'testver'; submit a different one.
    const { req, res } = post({ answers: validAnswers(), setVersion: 'stale-version' });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data.reason).toBe('set_changed');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('proceeds normally when setVersion matches (or is omitted)', async () => {
    const { req, res } = post({ answers: validAnswers(), setVersion: 'testver' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('happy path — atomic write', () => {
  it('writes one changeset (11 answer upserts + parent PATCH), deletes the draft, returns receivedAt', async () => {
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._data.ok).toBe(true);
    expect(typeof res._data.receivedAt).toBe('string');

    expect(DynamicsService.executeChangeset).toHaveBeenCalledTimes(1);
    const [operations] = DynamicsService.executeChangeset.mock.calls[0];
    expect(operations).toHaveLength(12); // 11 answers + parent

    const answerOps = operations.slice(0, 11);
    const parentOp = operations[11];

    // Answer ops upsert by the alternate-key URL (lookup attr = guid, questionkey quoted).
    for (const op of answerOps) {
      expect(op.method).toBe('PATCH');
      expect(op.url).toMatch(
        /^wmkf_appreviewanswers\(_wmkf_appreviewersuggestion_value=550e8400-e29b-41d4-a716-446655440000,wmkf_questionkey='[^']+'\)$/,
      );
      expect(op.url).not.toContain('If-Match'); // no per-answer If-Match
    }

    // Parent op PATCHes the suggestion by GUID, guarded by If-Match, carrying
    // affiliation + receivedat. Post-Phase-E the rating columns are NOT written —
    // ratings live only in the answer snapshot rows.
    expect(parentOp).toMatchObject({
      method: 'PATCH',
      url: `wmkf_appreviewersuggestions(${SUGGESTION_ID})`,
      ifMatch: ETAG,
    });
    expect(parentOp.body).toMatchObject({
      wmkf_revieweraffiliation: 'Professor of Physics, Example University',
      wmkf_reviewreceivedat: res._data.receivedAt,
    });
    expect(parentOp.body.wmkf_reviewerimpact).toBeUndefined();
    expect(parentOp.body.wmkf_reviewerrisk).toBeUndefined();
    expect(parentOp.body.wmkf_revieweroverallrating).toBeUndefined();
    // The snapshot carries exactly the two ratings plus the categorical answer.
    const ratingAnswerOps = answerOps.filter((o) => /wmkf_questionkey='(riskLevel|overallAssessment)'/.test(o.url));
    expect(ratingAnswerOps).toHaveLength(2);
    const categoricalOp = answerOps.find((o) => o.url.includes("wmkf_questionkey='impactAreas'"));
    expect(categoricalOp.body).toMatchObject({
      wmkf_answervalue: null,
      wmkf_questiontype: 'multiselect',
      wmkf_answertext: 'Provide enabling tools to the community; Result in publications of broad interest',
    });
    expect(JSON.parse(categoricalOp.body.wmkf_answervalues)).toEqual([
      { value: 1, label: 'Provide enabling tools to the community' },
      { value: 3, label: 'Result in publications of broad interest' },
    ]);

    expect(ReviewDraftService.deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
  });

  it('server-sanitizes rich-text answers before writing (stored-XSS boundary)', async () => {
    const { req, res } = post({
      answers: validAnswers({ priorWork: '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>' }),
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const [operations] = DynamicsService.executeChangeset.mock.calls[0];
    const priorWork = operations.find((o) => o.url.includes("wmkf_questionkey='priorWork'"));
    expect(priorWork.body.wmkf_answerhtml).not.toMatch(/<script|onerror|<img/i);
    expect(priorWork.body.wmkf_answerhtml).toContain('ok');
  });

  it('succeeds even if the post-commit draft delete fails (non-fatal)', async () => {
    ReviewDraftService.deleteBySuggestion.mockRejectedValue(new Error('pg down'));
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data.ok).toBe(true);
  });

  it('200 envelope pinned exactly: { ok: true, receivedAt } and nothing else', async () => {
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data).toEqual({ ok: true, receivedAt: expect.any(String) });
    expect(Object.keys(res._data).sort()).toEqual(['ok', 'receivedAt']);
  });
});

describe('concurrency envelopes (Stage 5 Phase A gap fill)', () => {
  it('412 from the changeset → 409 conflict with the reload message; draft NOT deleted', async () => {
    DynamicsService.executeChangeset.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toEqual({
      ok: false,
      reason: 'conflict',
      message: 'This review changed since you opened it. Please reload and try again.',
    });
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('no verify-time etag + racing submit committed → 409 review_received_locked (fallback finality re-read)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ _etag: null }),
      payload: { ops: ['download_proposal', 'upload_review'] },
    });
    // getForSubmitFinalityCheck re-read shows the race winner's receivedat.
    DynamicsService.getRecord.mockResolvedValue({ _etag: 'W/"fresh"', wmkf_reviewreceivedat: '2026-07-01T00:00:00Z' });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data.reason).toBe('review_received_locked');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('no etag anywhere → 409 conflict (NO_ETAG fail-closed, nothing written)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ _etag: null }),
      payload: { ops: ['download_proposal', 'upload_review'] },
    });
    DynamicsService.getRecord.mockResolvedValue({ wmkf_reviewreceivedat: null, _etag: null });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data.reason).toBe('conflict');
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });
});

describe('concurrency + failure mapping', () => {
  it('409 conflict when the changeset If-Match fails (412)', async () => {
    const err = new Error('precondition failed');
    err.status = 412;
    DynamicsService.executeChangeset.mockRejectedValue(err);
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'conflict' });
    // Draft is NOT deleted on a failed (rolled-back) write.
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('500 when the changeset fails for any other reason (no draft delete)', async () => {
    const err = new Error('boom');
    err.status = 400;
    DynamicsService.executeChangeset.mockRejectedValue(err);
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });
});

describe('fail-closed on missing parent etag (Codex P1)', () => {
  it('re-reads for a fresh etag when the verified suggestion lacks one, then writes guarded', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion({ _etag: undefined }), payload: { ops: ['download_proposal', 'upload_review'] } });
    DynamicsService.getRecord.mockResolvedValue(suggestion({ _etag: 'W/"reread"' }));
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUGGESTION_ID, expect.any(Object),
    );
    const [operations] = DynamicsService.executeChangeset.mock.calls[0];
    expect(operations[operations.length - 1].ifMatch).toBe('W/"reread"');
  });

  it('409 conflict (and no write) when no etag can be obtained even after a re-read', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion({ _etag: undefined }), payload: { ops: ['download_proposal', 'upload_review'] } });
    DynamicsService.getRecord.mockResolvedValue({}); // no _etag, no receivedat
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'conflict' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('409 review_received_locked when the fallback re-read finds a concurrent commit (Codex P1b)', async () => {
    // _etag absent at verify time → fallback re-read; that re-read must ALSO
    // re-check finality, or a racing submit that committed in between would hand
    // us a fresh (non-stale) etag and we'd overwrite the submitted review.
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion({ _etag: undefined }), payload: { ops: ['download_proposal', 'upload_review'] } });
    DynamicsService.getRecord.mockResolvedValue({ _etag: 'W/"fresh"', wmkf_reviewreceivedat: '2026-06-28T11:59:00Z' });
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'review_received_locked' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('missing-etag fallback rejects a terminal transition instead of acquiring its fresh ETag', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ _etag: undefined }),
      payload: { ops: ['download_proposal', 'upload_review'] },
    });
    DynamicsService.getRecord.mockResolvedValue(suggestion({
      _etag: 'W/"terminal"',
      wmkf_reviewstatus: 100000006,
      wmkf_reviewreceivedat: null,
    }));

    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'engagement_ended' });
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  it('re-read selects both the etag and receivedat (so the finality re-check is possible)', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion({ _etag: undefined }), payload: { ops: ['download_proposal', 'upload_review'] } });
    DynamicsService.getRecord.mockResolvedValue(suggestion({ _etag: 'W/"reread"' }));
    const { req, res } = post({ answers: validAnswers() });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const selectArg = DynamicsService.getRecord.mock.calls[0][2].select;
    expect(selectArg).toContain('wmkf_reviewreceivedat');
    expect(selectArg).toContain('wmkf_reviewstatus');
  });
});
