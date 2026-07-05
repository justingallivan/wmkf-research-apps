/**
 * S333 bypass-strip Stage 0 characterization (BYPASS_STRIP_PLAN.md sites
 * 44-46, 48, lib/external/*.js). Each of these IS the post-token-verification
 * seam (or, for site 48, a wrap whose sole caller establishes no ambient
 * context) — external requests reach them before any Dataverse restriction
 * context exists. Drives the real dynamics-context machinery (no
 * dynamics-context mock) and asserts hasTrustedDalContext() === true inside
 * each wrapped adapter call:
 *   44 read-ratings-by-suggestion (review-answer-snapshot.js)
 *   45 grantee-token-verify (verify-grantee-token.js)
 *   46 external-token-verify (verify-suggestion-token.js)
 *   48 external-token-revoke (token-lifecycle.js revoke())
 *
 * Stage 4b (2026-07-05): site 48's local wrap was pushed up to
 * pages/api/review-manager/revoke-token.js (the sole caller, which
 * established no context of its own) and removed from revoke() itself; its
 * sub-test below now wraps the call exactly as the route does.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/review-answer.js', () => ({
  readRatingsBySuggestion: jest.fn(),
}));
jest.mock('../../lib/services/external-token', () => ({
  verifyToken: jest.fn(),
  hashToken: jest.fn(),
  mintToken: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
}));
jest.mock('../../lib/services/grantee-deliverable-record', () => ({
  getDeliverableForRequest: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  getForExternalVerification: jest.fn(),
  APPLICANT_DISPOSITION_EXCLUDED: 'excluded',
  getForTokenStatus: jest.fn(),
  setExternalToken: jest.fn(),
  revokeExternalToken: jest.fn(),
  extendExternalTokenExpiry: jest.fn(),
}));

const { hasTrustedDalContext, withDalContext } = require('../../lib/dataverse/core/context');
const reviewAnswerAdapter = require('../../lib/dataverse/adapters/review-answer.js');
const { verifyToken } = require('../../lib/services/external-token');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request.js');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion.js');

describe('lib/external DAL context (S333 characterization, sites 44-46, 48)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('negative control: no trusted context exists before any call', () => {
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 44 — readRatingsBySuggestion runs inside a trusted context', async () => {
    const { readRatingsBySuggestion } = require('../../lib/external/review-answer-snapshot.js');
    const seen = { inside: null };
    reviewAnswerAdapter.readRatingsBySuggestion.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      return { impact: 1, risk: 2, overallRating: 3 };
    });

    await readRatingsBySuggestion('11111111-1111-1111-1111-111111111111');

    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 45 — verifyGranteeToken runs the request/deliverable read inside a trusted context', async () => {
    const { verifyGranteeToken } = require('../../lib/external/verify-grantee-token.js');
    const seen = { inside: null };
    verifyToken.mockResolvedValue({ valid: true, payload: { aud: 'grantee', subject: 'req-1' } });
    grantRequestAdapter.getById.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      return { akoya_requestid: 'req-1', akoya_requestnum: '1002794' };
    });

    const out = await verifyGranteeToken('jwt-token');

    expect(out.ok).toBe(true);
    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 46 — verifySuggestionToken runs the suggestion read inside a trusted context', async () => {
    const { verifySuggestionToken } = require('../../lib/external/verify-suggestion-token.js');
    const seen = { inside: null };
    verifyToken.mockResolvedValue({ valid: true, payload: { suggestionId: 'sug-1' } });
    reviewerSuggestionAdapter.getForExternalVerification.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
      return {
        wmkf_appreviewersuggestionid: 'sug-1',
        wmkf_externaltokenhash: null,
        wmkf_externaltokenrevoked: false,
        wmkf_externaltokenexpires: new Date(Date.now() + 86400000).toISOString(),
      };
    });

    await verifySuggestionToken('jwt-token');

    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });

  test('site 48 — token-lifecycle revoke runs the write inside the CALLER-established context (route push-up)', async () => {
    const { revoke } = require('../../lib/external/token-lifecycle.js');
    const seen = { inside: null };
    reviewerSuggestionAdapter.revokeExternalToken.mockImplementation(async () => {
      seen.inside = hasTrustedDalContext();
    });

    // Matches pages/api/review-manager/revoke-token.js:
    // withDalContext('external-token-revoke', () => revoke(suggestionId, ...))
    await withDalContext('external-token-revoke', () => revoke('sug-1'));

    expect(seen.inside).toBe(true);
    expect(hasTrustedDalContext()).toBe(false);
  });
});
