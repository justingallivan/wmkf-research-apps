/**
 * Route-level tests for GET/PUT /api/external/review/[token]/draft.
 *
 * The route is public; verifySuggestionToken is the authorization boundary and
 * the engagement gate (real computeEngagementState) decides whether a draft
 * write is allowed. We mock the token verifier, rate limiter, and the Postgres
 * draft service, and let the gate logic run for real.
 */

import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { verifySuggestionToken } from '../../lib/external/verify-suggestion-token';
import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
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
jest.mock('../../lib/services/review-draft-service', () => ({
  getBySuggestion: jest.fn(),
  upsertDraftJson: jest.fn(),
}));
// PUT loads the question set from Dataverse for the key whitelist; mock the
// fetcher to return the static fields so the whitelist behaves as before.
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  return {
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    questionSetVersion: jest.fn(() => 'testver'),
  };
});

const SUGGESTION_ID = '550e8400-e29b-41d4-a716-446655440000';
const DEFAULT_PAYLOAD = { ops: ['download_proposal', 'upload_review'] };

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_reviewstatus: 100000001, // materials sent → stage2b
    wmkf_reviewreceivedat: null,
    wmkf_accepted: true,
    wmkf_declined: false,
    ...overrides,
  };
}

let handler;
beforeAll(async () => {
  const mod = await import('../../pages/api/external/review/[token]/draft');
  handler = mod.default;
});

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
});

describe('shared guards', () => {
  it('405s a non GET/PUT method', async () => {
    const req = createMockReq({ method: 'POST', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('429s when rate limited', async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 30 });
    const req = createMockReq({ method: 'GET', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(429);
    expect(res._headers['Retry-After']).toBe('30');
  });

  it('401s on token failure and records the outcome', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'hash_mismatch' });
    const req = createMockReq({ method: 'GET', query: { token: 'bad' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res._data).toMatchObject({ ok: false, reason: 'hash_mismatch' });
    expect(recordTokenOutcome).toHaveBeenCalledWith(req, 'bad', false);
  });

  it('404s when the token is not found', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const req = createMockReq({ method: 'GET', query: { token: 'x' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
  });

  it('403s GET and PUT when the verified token ops does not include upload_review', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion(),
      payload: { ops: ['download_proposal'] },
    });
    for (const opts of [
      { method: 'GET', query: { token: 't' } },
      { method: 'PUT', query: { token: 't' }, body: { draftJson: { riskLevel: 3 } } },
    ]) {
      const req = createMockReq(opts);
      const res = createMockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res._data).toMatchObject({ ok: false, reason: 'op_not_permitted' });
    }
    expect(ReviewDraftService.getBySuggestion).not.toHaveBeenCalled();
    expect(ReviewDraftService.upsertDraftJson).not.toHaveBeenCalled();
  });

  it('403s when the verified token has a missing/malformed ops array', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion(),
      payload: {},
    });
    const req = createMockReq({ method: 'GET', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res._data).toMatchObject({ ok: false, reason: 'op_not_permitted' });
    expect(ReviewDraftService.getBySuggestion).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns the saved draft in the authoring stage', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    ReviewDraftService.getBySuggestion.mockResolvedValue({ draft_json: { riskLevel: 3 } });
    const req = createMockReq({ method: 'GET', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data).toEqual({ ok: true, draftJson: { riskLevel: 3 }, submitted: false });
  });

  it('returns null draft when none saved', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    ReviewDraftService.getBySuggestion.mockResolvedValue(null);
    const req = createMockReq({ method: 'GET', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res._data).toEqual({ ok: true, draftJson: null, submitted: false });
  });

  it('returns an empty draft once submitted, without reading the draft store', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ wmkf_reviewreceivedat: '2026-01-01T00:00:00Z' }),
      payload: DEFAULT_PAYLOAD,
    });
    const req = createMockReq({ method: 'GET', query: { token: 't' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res._data).toEqual({ ok: true, draftJson: null, submitted: true });
    expect(ReviewDraftService.getBySuggestion).not.toHaveBeenCalled();
  });
});

describe('PUT (autosave)', () => {
  it('400s when draftJson is missing or not an object', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    for (const body of [{}, { draftJson: 'x' }, { draftJson: [] }, { draftJson: null }]) {
      const req = createMockReq({ method: 'PUT', query: { token: 't' }, body });
      const res = createMockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(400);
    }
    expect(ReviewDraftService.upsertDraftJson).not.toHaveBeenCalled();
  });

  it('saves a sanitized, whitelisted draft in the authoring stage', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    ReviewDraftService.upsertDraftJson.mockResolvedValue({ id: 9, updated_at: 'TS' });
    const req = createMockReq({
      method: 'PUT',
      query: { token: 't' },
      body: {
        draftJson: {
          riskLevel: 3,
          impactAreas: [4, '1', 999, 1, 4],
          affiliation: 'X University',
          bogusKey: 'dropme',
        },
      },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._data).toEqual({ ok: true, draftId: 9, updatedAt: 'TS' });
    // Unknown keys dropped; known schema keys preserved.
    expect(ReviewDraftService.upsertDraftJson).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      draftJson: {
        riskLevel: 3,
        impactAreas: [1, 4],
        affiliation: 'X University',
      },
    });
  });

  it('persists a richtext answer ONLY as sanitized HTML', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    ReviewDraftService.upsertDraftJson.mockResolvedValue({ id: 12, updated_at: 'TS' });
    const req = createMockReq({
      method: 'PUT',
      query: { token: 't' },
      body: { draftJson: { foreseenImpacts: '<p>real impact</p><img src=x onerror=alert(1)><script>steal()</script>' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const persisted = ReviewDraftService.upsertDraftJson.mock.calls[0][0].draftJson;
    expect(persisted.foreseenImpacts).toContain('<p>real impact</p>');
    expect(persisted.foreseenImpacts).not.toMatch(/onerror|<img|<script|steal\(/i);
  });

  it('400 answer_too_long when a richtext answer exceeds maxLength (no write)', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: true, suggestion: suggestion(), payload: DEFAULT_PAYLOAD });
    // foreseenImpacts maxLength is 50000.
    const huge = 'a'.repeat(50001);
    const req = createMockReq({
      method: 'PUT', query: { token: 't' }, body: { draftJson: { foreseenImpacts: huge } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res._data).toMatchObject({ reason: 'answer_too_long' });
    expect(res._data.fields[0]).toMatchObject({ key: 'foreseenImpacts', maxLength: 50000 });
    expect(ReviewDraftService.upsertDraftJson).not.toHaveBeenCalled();
  });

  it('409 review_received_locked once submitted (no write)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ wmkf_reviewreceivedat: '2026-01-01T00:00:00Z' }),
      payload: DEFAULT_PAYLOAD,
    });
    const req = createMockReq({
      method: 'PUT', query: { token: 't' }, body: { draftJson: { riskLevel: 3 } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'review_received_locked' });
    expect(ReviewDraftService.upsertDraftJson).not.toHaveBeenCalled();
  });

  it('409 materials_not_sent before the authoring stage (no write)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ok: true,
      suggestion: suggestion({ wmkf_reviewstatus: null, wmkf_accepted: false }),
      payload: DEFAULT_PAYLOAD,
    });
    const req = createMockReq({
      method: 'PUT', query: { token: 't' }, body: { draftJson: { riskLevel: 3 } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(409);
    expect(res._data).toMatchObject({ reason: 'materials_not_sent' });
    expect(ReviewDraftService.upsertDraftJson).not.toHaveBeenCalled();
  });
});
