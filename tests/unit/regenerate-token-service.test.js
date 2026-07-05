/**
 * Logic-level unit tests for lib/services/review-manager/regenerate-token-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapter + token lifecycle + draft service mocked; covers the success
 * payload, the excluded fail-closed 409, both 404 shapes, and — critically —
 * the BEST-EFFORT post-mint draft cleanup (a delete failure never fails the
 * regenerate).
 */

const getForTokenRegeneration = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  getForTokenRegeneration: (...a) => getForTokenRegeneration(...a),
  APPLICANT_DISPOSITION_EXCLUDED: 100000002,
}));
const mintAndStore = jest.fn();
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
}));
const deleteBySuggestion = jest.fn(async () => {});
jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true,
  default: { deleteBySuggestion: (...a) => deleteBySuggestion(...a) },
}));

const SUG = '22222222-2222-4222-8222-222222222222';
const REQ = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'su-1';
const EXPIRES = new Date('2027-01-01T00:00:00Z');

let regenerateToken;
let RegenerateTokenError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/regenerate-token-service');
  regenerateToken = mod.regenerateToken;
  RegenerateTokenError = mod.RegenerateTokenError;
});

beforeEach(() => {
  jest.clearAllMocks();
  getForTokenRegeneration.mockResolvedValue({ _wmkf_request_value: REQ, wmkf_applicantdisposition: null });
  mintAndStore.mockResolvedValue({ url: 'https://x/t?token=abc', expiresAt: EXPIRES, jti: 'jti-1' });
});

test('success: mints with looked-up requestId, returns ISO expiry payload, cleans up draft', async () => {
  const out = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: ACTOR });
  expect(mintAndStore).toHaveBeenCalledWith({ suggestionId: SUG, requestId: REQ, expiresAt: EXPIRES, actingUserSystemId: ACTOR });
  expect(deleteBySuggestion).toHaveBeenCalledWith(SUG);
  expect(out).toEqual({ ok: true, url: 'https://x/t?token=abc', expiresAt: '2027-01-01T00:00:00.000Z', jti: 'jti-1' });
});

test('draft cleanup failure is BEST-EFFORT — regenerate still succeeds', async () => {
  deleteBySuggestion.mockRejectedValueOnce(new Error('kv down'));
  const out = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: null });
  expect(out.ok).toBe(true);
  expect(out.jti).toBe('jti-1');
});

test('applicant-excluded engagement fails closed: 409 { ok:false, reason:"excluded" }, no mint', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({ _wmkf_request_value: REQ, wmkf_applicantdisposition: 100000002 });
  const err = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: null }).catch((e) => e);
  expect(err).toBeInstanceOf(RegenerateTokenError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'excluded' });
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(deleteBySuggestion).not.toHaveBeenCalled();
});

test('lookup 404 and missing _wmkf_request_value both → 404 { ok:false, reason:"not_found" }', async () => {
  getForTokenRegeneration.mockRejectedValueOnce(new Error('Get record failed (404)'));
  let err = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });

  getForTokenRegeneration.mockResolvedValueOnce({ _wmkf_request_value: null });
  err = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('non-404 lookup failure propagates UNTYPED (shell maps to 500 server_error)', async () => {
  getForTokenRegeneration.mockRejectedValueOnce(new Error('dataverse 503'));
  const err = await regenerateToken({ suggestionId: SUG, expiresAt: EXPIRES, actingUserSystemId: null }).catch((e) => e);
  expect(err).not.toBeInstanceOf(RegenerateTokenError);
  expect(err.message).toBe('dataverse 503');
});
