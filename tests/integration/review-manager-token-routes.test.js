/**
 * Route-level regression tests for staff-managed external reviewer token
 * lifecycle endpoints.
 */

import {
  mockUnauthenticated,
  mockAuthenticatedUser,
  createMockReq,
  createMockRes,
  clearAppAccessCache,
} from '../helpers/auth-mock';

import { DynamicsService } from '../../lib/services/dynamics-service';
import { mintAndStore, revoke } from '../../lib/external/token-lifecycle';
import ReviewDraftService from '../../lib/services/review-draft-service';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
  },
}));

jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: jest.fn(),
  revoke: jest.fn(),
}));

jest.mock('../../lib/services/review-draft-service', () => ({
  deleteBySuggestion: jest.fn(async () => 1),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));

// regenerate-token GUID-validates suggestionId before it becomes a Dataverse
// record-id selector (S259 trust-boundary hardening). Fixtures must be GUID-shaped
// or every test 400s before reaching the lifecycle logic it means to exercise.
const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_DUE = '2099-09-01';

beforeEach(() => {
  clearAppAccessCache();
  jest.clearAllMocks();
});

describe('/api/review-manager/regenerate-token', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/review-manager/regenerate-token');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('rejects non-POST methods with 405, Allow: POST, and the full envelope', async () => {
    // Method check runs before the auth gate, so no session/access mock is needed here.
    const req = createMockReq({ method: 'GET', body: {} });
    const res = createMockRes();

    await handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'method_not_allowed' });
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('returns 403 when caller lacks review-manager app access', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('mints a replacement token for the requested suggestion and linked request', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockImplementation(async (entitySet) => {
      if (entitySet === 'akoya_requests') return { wmkf_reviewduedate: REQUEST_DUE };
      return {
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_request_value: REQUEST_ID,
        wmkf_accepted: true,
        wmkf_reviewduedateoverride: null,
      };
    });
    const expiresAt = new Date(
      Date.parse(`${REQUEST_DUE}T23:59:59Z`) + 90 * 24 * 60 * 60 * 1000,
    );
    mintAndStore.mockResolvedValue({
      url: 'https://app.example/external/review/new-token',
      expiresAt,
      jti: 'jti-1',
    });

    const req = createMockReq({
      method: 'POST',
      body: { suggestionId: SUGGESTION_ID },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      { select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_applicantdisposition,wmkf_accepted,wmkf_reviewduedateoverride' },
    );
    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'akoya_requests',
      REQUEST_ID,
      { select: 'wmkf_reviewduedate' },
    );
    expect(mintAndStore).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      expiresAt,
      actingUserSystemId: null,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      url: 'https://app.example/external/review/new-token',
      expiresAt: expiresAt.toISOString(),
      jti: 'jti-1',
    });
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: 2,
      callerSystemId: null,
      suggestionIds: [SUGGESTION_ID],
    });
    // Recovery replaces token authority without discarding work already autosaved
    // against the stable reviewer engagement.
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('does not touch the saved draft while issuing a replacement token', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID, _wmkf_request_value: REQUEST_ID,
    });
    mintAndStore.mockResolvedValue({ url: 'https://app.example/x', expiresAt: new Date(Date.now() + 60_000), jti: 'j' });

    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied past expiresAt and derives a safe server expiry', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockImplementation(async (entitySet) => {
      if (entitySet === 'akoya_requests') return { wmkf_reviewduedate: REQUEST_DUE };
      return {
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_request_value: REQUEST_ID,
        wmkf_accepted: true,
      };
    });
    const serverExpiry = new Date(
      Date.parse(`${REQUEST_DUE}T23:59:59Z`) + 90 * 24 * 60 * 60 * 1000,
    );
    mintAndStore.mockResolvedValue({ url: 'https://app.example/x', expiresAt: serverExpiry, jti: 'j' });
    const req = createMockReq({
      method: 'POST',
      body: { suggestionId: SUGGESTION_ID, expiresAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: serverExpiry,
    }));
  });

  it('mints for a caller holding only the additive reviewers grant', async () => {
    mockAuthenticatedUser(4, ['reviewers']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      wmkf_applicantdisposition: null,
    });
    const expiresAt = new Date(Date.now() + 60_000);
    mintAndStore.mockResolvedValue({ url: 'https://app.example/x', expiresAt, jti: 'jti-1' });

    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mintAndStore).toHaveBeenCalled();
  });

  it('refuses (409) to regenerate a token for an applicant-excluded suggestion', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    // 100000001 = APPLICANT_DISPOSITION_EXCLUDED (lib/dataverse/adapters/reviewer-suggestion).
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      wmkf_applicantdisposition: 100000001,
    });

    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'excluded' });
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('rejects a non-GUID suggestionId with 400 before any Dataverse lookup', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'not-a-guid' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
  });
});

describe('/api/review-manager/revoke-token', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/review-manager/revoke-token');
    handler = mod.default;
  });

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated();
    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a token for callers with review-manager access', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    revoke.mockResolvedValue(undefined);
    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(revoke).toHaveBeenCalledWith(SUGGESTION_ID, { actingUserSystemId: null });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    // Revoke is a leak/compromise action → drop any in-progress draft.
    expect(ReviewDraftService.deleteBySuggestion).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: 3,
      callerSystemId: null,
      suggestionIds: [SUGGESTION_ID],
    });
  });

  it('still returns 200 if the post-revoke draft cleanup fails (non-fatal)', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    revoke.mockResolvedValue(undefined);
    ReviewDraftService.deleteBySuggestion.mockRejectedValueOnce(new Error('pg down'));
    const req = createMockReq({ method: 'POST', body: { suggestionId: SUGGESTION_ID } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects missing suggestionId before revoking', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rejects a non-GUID suggestionId with 400 before revoking or touching the draft', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'not-a-guid' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(revoke).not.toHaveBeenCalled();
    expect(ReviewDraftService.deleteBySuggestion).not.toHaveBeenCalled();
  });
});
