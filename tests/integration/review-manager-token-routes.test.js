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

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: jest.fn(),
  },
}));

jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: jest.fn(),
  revoke: jest.fn(),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

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
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('returns 403 when caller lacks review-manager app access', async () => {
    mockAuthenticatedUser(1, ['reviewer-finder']);
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('mints a replacement token for the requested suggestion and linked request', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: 'suggestion-1',
      _wmkf_request_value: 'request-1',
    });
    const expiresAt = new Date(Date.now() + 60_000);
    mintAndStore.mockResolvedValue({
      url: 'https://app.example/external/review/new-token',
      expiresAt,
      jti: 'jti-1',
    });

    const req = createMockReq({
      method: 'POST',
      body: { suggestionId: 'suggestion-1', expiresAt: expiresAt.toISOString() },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(DynamicsService.getRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      'suggestion-1',
      { select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_applicantdisposition' },
    );
    expect(mintAndStore).toHaveBeenCalledWith({
      suggestionId: 'suggestion-1',
      requestId: 'request-1',
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
  });

  it('rejects a past expiresAt before minting', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    const req = createMockReq({
      method: 'POST',
      body: { suggestionId: 'suggestion-1', expiresAt: new Date(Date.now() - 60_000).toISOString() },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  it('mints for a caller holding only the additive reviewers grant', async () => {
    mockAuthenticatedUser(4, ['reviewers']);
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: 'suggestion-1',
      _wmkf_request_value: 'request-1',
      wmkf_applicantdisposition: null,
    });
    const expiresAt = new Date(Date.now() + 60_000);
    mintAndStore.mockResolvedValue({ url: 'https://app.example/x', expiresAt, jti: 'jti-1' });

    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mintAndStore).toHaveBeenCalled();
  });

  it('refuses (409) to regenerate a token for an applicant-excluded suggestion', async () => {
    mockAuthenticatedUser(2, ['review-manager']);
    // 100000001 = APPLICANT_DISPOSITION_EXCLUDED (lib/dataverse/adapters/reviewer-suggestion).
    DynamicsService.getRecord.mockResolvedValue({
      wmkf_appreviewersuggestionid: 'suggestion-1',
      _wmkf_request_value: 'request-1',
      wmkf_applicantdisposition: 100000001,
    });

    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'excluded' });
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
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a token for callers with review-manager access', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    revoke.mockResolvedValue(undefined);
    const req = createMockReq({ method: 'POST', body: { suggestionId: 'suggestion-1' } });
    const res = createMockRes();

    await handler(req, res);

    expect(revoke).toHaveBeenCalledWith('suggestion-1', { actingUserSystemId: null });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('rejects missing suggestionId before revoking', async () => {
    mockAuthenticatedUser(3, ['review-manager']);
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(revoke).not.toHaveBeenCalled();
  });
});

