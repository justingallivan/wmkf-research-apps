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
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));
const deleteBySuggestion = jest.fn(async () => {});
jest.mock('../../lib/services/review-draft-service', () => ({
  __esModule: true,
  default: { deleteBySuggestion: (...a) => deleteBySuggestion(...a) },
}));

const SUG = '22222222-2222-4222-8222-222222222222';
const REQ = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'su-1';
const REQUEST_DUE = '2099-09-01';
const DEFAULT_EXPIRES = new Date(Date.parse(`${REQUEST_DUE}T23:59:59Z`) + 90 * 24 * 60 * 60 * 1000);

let regenerateToken;
let RegenerateTokenError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/regenerate-token-service');
  regenerateToken = mod.regenerateToken;
  RegenerateTokenError = mod.RegenerateTokenError;
});

beforeEach(() => {
  jest.clearAllMocks();
  getForTokenRegeneration.mockResolvedValue({
    _wmkf_request_value: REQ,
    wmkf_applicantdisposition: null,
    wmkf_accepted: true,
    wmkf_reviewduedateoverride: null,
  });
  getRequestById.mockResolvedValue({ wmkf_reviewduedate: REQUEST_DUE });
  mintAndStore.mockImplementation(async ({ expiresAt }) => ({
    url: 'https://x/t?token=abc',
    expiresAt,
    jti: 'jti-1',
  }));
});

test('success: server derives expiry from request default, returns ISO payload, cleans up draft', async () => {
  const out = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR });
  expect(getRequestById).toHaveBeenCalledWith(REQ, { select: 'wmkf_reviewduedate' });
  expect(mintAndStore).toHaveBeenCalledWith({
    suggestionId: SUG,
    requestId: REQ,
    expiresAt: DEFAULT_EXPIRES,
    actingUserSystemId: ACTOR,
  });
  expect(deleteBySuggestion).toHaveBeenCalledWith(SUG);
  expect(out).toEqual({
    ok: true,
    url: 'https://x/t?token=abc',
    expiresAt: DEFAULT_EXPIRES.toISOString(),
    jti: 'jti-1',
  });
});

test('suggestion override wins over the request default for regenerated-token expiry', async () => {
  const override = '2099-09-15';
  const overrideExpires = new Date(Date.parse(`${override}T23:59:59Z`) + 90 * 24 * 60 * 60 * 1000);
  getForTokenRegeneration.mockResolvedValueOnce({
    _wmkf_request_value: REQ,
    wmkf_applicantdisposition: null,
    wmkf_accepted: true,
    wmkf_reviewduedateoverride: override,
  });

  await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR });

  expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: overrideExpires }));
});

test('draft cleanup failure is BEST-EFFORT — regenerate still succeeds', async () => {
  deleteBySuggestion.mockRejectedValueOnce(new Error('kv down'));
  const out = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null });
  expect(out.ok).toBe(true);
  expect(out.jti).toBe('jti-1');
});

test('applicant-excluded engagement fails closed: 409 { ok:false, reason:"excluded" }, no mint', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({ _wmkf_request_value: REQ, wmkf_applicantdisposition: 100000002 });
  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null }).catch((e) => e);
  expect(err).toBeInstanceOf(RegenerateTokenError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'excluded' });
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(deleteBySuggestion).not.toHaveBeenCalled();
});

test('lookup 404 and missing _wmkf_request_value both → 404 { ok:false, reason:"not_found" }', async () => {
  getForTokenRegeneration.mockRejectedValueOnce(new Error('Get record failed (404)'));
  let err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });

  getForTokenRegeneration.mockResolvedValueOnce({ _wmkf_request_value: null });
  err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({ ok: false, reason: 'not_found' });
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('non-404 lookup failure propagates UNTYPED (shell maps to 500 server_error)', async () => {
  getForTokenRegeneration.mockRejectedValueOnce(new Error('dataverse 503'));
  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null }).catch((e) => e);
  expect(err).not.toBeInstanceOf(RegenerateTokenError);
  expect(err.message).toBe('dataverse 503');
});
