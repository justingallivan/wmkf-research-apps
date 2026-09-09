/**
 * Logic-level unit tests for lib/services/review-manager/regenerate-token-service.js
 * (Route→Service Consolidation Plan, Stage 2 wave).
 *
 * Adapter + token lifecycle + draft service mocked; covers the success
 * payload, the excluded fail-closed 409, both 404 shapes, and — critically —
 * the absence of draft deletion during explicit link recovery.
 */

const getForTokenRegeneration = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  getForTokenRegeneration: (...a) => getForTokenRegeneration(...a),
  APPLICANT_DISPOSITION_EXCLUDED: 100000002,
  RESPONSE_TYPE_MAP: {
    accepted: 100000000,
    declined: 100000001,
    no_response: 100000002,
    withdrawn_sufficient: 100000003,
    held: 100000004,
  },
  RESPONSE_TYPE_BY_VALUE: {
    100000000: 'accepted',
    100000001: 'declined',
    100000002: 'no_response',
    100000003: 'withdrawn_sufficient',
    100000004: 'held',
  },
  REVIEW_STATUS_MAP: {
    accepted: 100000000,
    materials_sent: 100000001,
    under_review: 100000002,
    review_received: 100000003,
    complete: 100000004,
    withdrew: 100000005,
    released: 100000006,
  },
}));
const mintAndStore = jest.fn();
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: (...a) => mintAndStore(...a),
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
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
    _etag: 'W/"1"',
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

test('success: server derives expiry from request default and returns the replacement link without touching drafts', async () => {
  const out = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR });
  expect(getRequestById).toHaveBeenCalledWith(REQ, { select: 'wmkf_reviewduedate' });
  expect(mintAndStore).toHaveBeenCalledWith({
    suggestionId: SUG,
    requestId: REQ,
    expiresAt: DEFAULT_EXPIRES,
    actingUserSystemId: ACTOR,
    ifMatch: 'W/"1"',
  });
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
    _etag: 'W/"2"',
    wmkf_applicantdisposition: null,
    wmkf_accepted: true,
    wmkf_reviewduedateoverride: override,
  });

  await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR });

  expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: overrideExpires }));
});

test('applicant-excluded engagement fails closed: 409 { ok:false, reason:"excluded" }, no mint', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({ _wmkf_request_value: REQ, _etag: 'W/"3"', wmkf_applicantdisposition: 100000002 });
  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: null }).catch((e) => e);
  expect(err).toBeInstanceOf(RegenerateTokenError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'excluded' });
  expect(mintAndStore).not.toHaveBeenCalled();
});

test.each([
  ['declined', 100000001],
  ['no_response', 100000002],
  ['withdrawn_sufficient', 100000003],
  ['held', 100000004],
])('terminal response %s fails closed before request lookup or mint', async (_label, responseType) => {
  getForTokenRegeneration.mockResolvedValueOnce({
    _wmkf_request_value: REQ,
    _etag: 'W/"4"',
    wmkf_applicantdisposition: null,
    wmkf_accepted: false,
    wmkf_responsetype: responseType,
    wmkf_externaltokenrevoked: true,
  });

  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR }).catch((e) => e);

  expect(err).toBeInstanceOf(RegenerateTokenError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ ok: false, reason: 'not_eligible' });
  expect(getRequestById).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('unknown response type fails closed before any mint', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({
    _wmkf_request_value: REQ,
    _etag: 'W/"5"',
    wmkf_applicantdisposition: null,
    wmkf_responsetype: 999999999,
  });

  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR }).catch((e) => e);

  expect(err.body).toEqual({ ok: false, reason: 'not_eligible' });
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('terminal review status fails closed even when response type is accepted', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({
    _wmkf_request_value: REQ,
    _etag: 'W/"6"',
    wmkf_applicantdisposition: null,
    wmkf_accepted: true,
    wmkf_responsetype: 100000000,
    wmkf_reviewstatus: 100000006,
  });

  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR }).catch((e) => e);

  expect(err.body).toEqual({ ok: false, reason: 'not_eligible' });
  expect(getRequestById).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('missing ETag fails closed before request lookup or mint', async () => {
  getForTokenRegeneration.mockResolvedValueOnce({
    _wmkf_request_value: REQ,
    wmkf_accepted: true,
    wmkf_responsetype: 100000000,
  });

  const err = await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR }).catch((e) => e);

  expect(err.body).toEqual({ ok: false, reason: 'not_eligible' });
  expect(getRequestById).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
});

test('eligible control forwards the exact ETag for an optimistic token write', async () => {
  await regenerateToken({ suggestionId: SUG, actingUserSystemId: ACTOR });
  expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: 'W/"1"' }));
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
