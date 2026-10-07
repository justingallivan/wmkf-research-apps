import proposalRankingHandler from '../../pages/api/proposal-ranking';
import proposalRankingAdminSettingsHandler from '../../pages/api/admin/proposal-ranking-facilitator';
import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import { listAppKeysForUser } from '../../lib/services/app-access-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  handleProposalRankingAction,
  handleProposalRankingAdminSettings,
  handleProposalRankingGet,
} from '../../lib/services/proposal-ranking/service';

jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/services/app-access-service', () => ({ listAppKeysForUser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn() }));
jest.mock('../../lib/services/proposal-ranking/service', () => ({
  handleProposalRankingAction: jest.fn(),
  handleProposalRankingAdminSettings: jest.fn(),
  handleProposalRankingGet: jest.fn(),
}));

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(method, { query = {}, body } = {}) {
  return { method, query, body };
}

function expectPrivateHeaders(res) {
  expect(res.headers['Cache-Control']).toBe('private, no-store, max-age=0');
  expect(res.headers.Vary).toBe('Cookie, Authorization');
}

function apiError(message, { status = 400, code = 'invalid_request', retryable = false, current = null, publicMessage = false } = {}) {
  return Object.assign(new Error(message), { status, code, retryable, current, publicMessage });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 'profile-from-session' });
  getUserRole.mockResolvedValue('staff');
  listAppKeysForUser.mockResolvedValue(['proposal-ranking']);
  withDalContext.mockImplementation((_scope, callback) => callback());
  handleProposalRankingGet.mockResolvedValue({ mode: 'waiting', cycleCode: 'J27' });
  handleProposalRankingAction.mockResolvedValue({ mode: 'round', roundId: 'round-1' });
  handleProposalRankingAdminSettings.mockResolvedValue({ systemUserId: 'staff-guid', revision: 'rev-2' });
});

describe('Proposal Ranking API route authorization and envelopes', () => {
  test('requires an explicit app grant even when the authenticated actor is a superuser', async () => {
    getUserRole.mockResolvedValue('superuser');
    listAppKeysForUser.mockResolvedValue([]);
    const res = responseRecorder();

    await proposalRankingHandler(request('GET', { query: { cycleCode: 'J27' } }), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('access_denied');
    expectPrivateHeaders(res);
    expect(handleProposalRankingGet).not.toHaveBeenCalled();
    expect(handleProposalRankingAction).not.toHaveBeenCalled();
  });

  test('uses the authenticated session actor for a POST, not identity fields in the body', async () => {
    const body = { action: 'save', profileId: 'forged-profile', systemUserId: 'forged-user', order: ['request-1'] };
    const res = responseRecorder();

    await proposalRankingHandler(request('POST', { body }), res);

    expect(res.statusCode).toBe(200);
    expect(handleProposalRankingAction).toHaveBeenCalledWith({
      action: 'save',
      body,
      profileId: 'profile-from-session',
      isSuperuser: false,
    });
    expectPrivateHeaders(res);
  });

  test('delegates closed action and schema rejection through the private error envelope', async () => {
    handleProposalRankingAction.mockRejectedValue(apiError('Unsupported action.', { code: 'invalid_action', publicMessage: true }));
    const res = responseRecorder();

    await proposalRankingHandler(request('POST', { body: { action: 'delete-everything', extra: true } }), res);

    expect(handleProposalRankingAction).toHaveBeenCalledWith({
      action: 'delete-everything',
      body: { action: 'delete-everything', extra: true },
      profileId: 'profile-from-session',
      isSuperuser: false,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: {
      code: 'invalid_action',
      message: 'Unsupported action.',
      retryable: false,
      current: null,
    } });
    expectPrivateHeaders(res);
  });

  test('hides dependency details and prevents caching on service failures', async () => {
    const failure = apiError('private database detail', {
      status: 503,
      code: 'dependency_unavailable',
      retryable: true,
      current: { state: 'unavailable' },
    });
    handleProposalRankingGet.mockRejectedValue(failure);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseRecorder();

    await proposalRankingHandler(request('GET', { query: { cycleCode: 'J27' } }), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toEqual({
      code: 'dependency_unavailable',
      message: 'Proposal Ranking could not complete this request. Please retry or contact an administrator.',
      retryable: true,
      current: { state: 'unavailable' },
    });
    expectPrivateHeaders(res);
    log.mockRestore();
  });

  test('admin settings GET and PUT require superuser plus app grant and save with session profile', async () => {
    getUserRole.mockResolvedValue('superuser');
    const getRes = responseRecorder();
    await proposalRankingAdminSettingsHandler(request('GET'), getRes);
    expect(getRes.statusCode).toBe(200);
    expect(handleProposalRankingAdminSettings).toHaveBeenCalledWith({
      method: 'GET', body: undefined, profileId: 'profile-from-session',
    });
    expectPrivateHeaders(getRes);

    handleProposalRankingAdminSettings.mockClear();
    const body = { systemUserId: 'staff-guid', revision: 'rev-1' };
    const putRes = responseRecorder();
    await proposalRankingAdminSettingsHandler(request('PUT', { body }), putRes);
    expect(putRes.statusCode).toBe(200);
    expect(handleProposalRankingAdminSettings).toHaveBeenCalledWith({
      method: 'PUT', body, profileId: 'profile-from-session',
    });
    expectPrivateHeaders(putRes);
  });

  test('admin settings errors keep the structured private response envelope', async () => {
    getUserRole.mockResolvedValue('superuser');
    handleProposalRankingAdminSettings.mockRejectedValue(apiError('Revision changed.', {
      status: 409,
      code: 'conflict',
      current: { revision: 'rev-3' },
      publicMessage: true,
    }));
    const res = responseRecorder();

    await proposalRankingAdminSettingsHandler(request('PUT', {
      body: { systemUserId: 'staff-guid', revision: 'rev-2' },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toEqual({
      code: 'conflict',
      message: 'Revision changed.',
      retryable: false,
      current: { revision: 'rev-3' },
    });
    expectPrivateHeaders(res);
  });

  test.each([
    { route: 'main', status: 412, code: 'dataverse_precondition_failed', raw: 'raw Dataverse ETag mismatch with private row values' },
    { route: 'main', status: 403, code: 'dataverse_forbidden', raw: 'raw adapter says app-role GUID lacks write permission' },
    { route: 'main', status: 400, code: 'dataverse_bad_request', raw: 'raw Dataverse rejected an internal column name' },
    { route: 'admin', status: 403, code: 'dataverse_forbidden', raw: 'raw adapter says app-role GUID lacks write permission' },
  ])('sanitizes raw $route adapter errors while preserving HTTP $status and code', async ({ route, status, code, raw }) => {
    const failure = apiError(raw, { status, code, current: { etag: 'safe-current' } });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = responseRecorder();

    if (route === 'main') {
      handleProposalRankingAction.mockRejectedValue(failure);
      await proposalRankingHandler(request('POST', { body: { action: 'transfer' } }), res);
      expect(res.body.error.message).toBe('Proposal Ranking could not complete this request. Please retry or contact an administrator.');
    } else {
      getUserRole.mockResolvedValue('superuser');
      handleProposalRankingAdminSettings.mockRejectedValue(failure);
      await proposalRankingAdminSettingsHandler(request('PUT', {
        body: { systemUserId: 'staff-guid', revision: 'rev-1' },
      }), res);
      expect(res.body.error.message).toBe('Proposal Ranking settings could not complete this request. Please retry or contact an administrator.');
    }

    expect(res.statusCode).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.message).not.toContain(raw);
    expect(res.body.error.current).toEqual({ etag: 'safe-current' });
    expectPrivateHeaders(res);
    log.mockRestore();
  });

  test('does not call settings service for non-superusers, missing grants, or extra PUT fields', async () => {
    getUserRole.mockResolvedValue('staff');
    let res = responseRecorder();
    await proposalRankingAdminSettingsHandler(request('GET'), res);
    expect(res.statusCode).toBe(403);
    expect(handleProposalRankingAdminSettings).not.toHaveBeenCalled();

    getUserRole.mockResolvedValue('superuser');
    listAppKeysForUser.mockResolvedValue([]);
    res = responseRecorder();
    await proposalRankingAdminSettingsHandler(request('PUT', { body: { systemUserId: 'staff-guid', revision: 'rev-1' } }), res);
    expect(res.statusCode).toBe(403);
    expect(handleProposalRankingAdminSettings).not.toHaveBeenCalled();

    listAppKeysForUser.mockResolvedValue(['proposal-ranking']);
    res = responseRecorder();
    await proposalRankingAdminSettingsHandler(request('PUT', { body: { systemUserId: 'staff-guid', revision: 'rev-1', profileId: 'spoofed' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(handleProposalRankingAdminSettings).not.toHaveBeenCalled();
    expectPrivateHeaders(res);
  });
});
