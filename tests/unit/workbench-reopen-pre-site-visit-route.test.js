/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/reopen-service', () => ({
  reopenPreSiteVisit: jest.fn(),
}));
jest.mock('../../lib/utils/guarded-reopen-readiness', () => ({
  isGuardedReopenSchemaReady: jest.fn(),
}));

import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { reopenPreSiteVisit } from '../../lib/services/pre-site-visit/reopen-service';
import { isGuardedReopenSchemaReady } from '../../lib/utils/guarded-reopen-readiness';
import handler from '../../pages/api/workbench/pre-site-visit/reopen';
import { PRE_SITE_REOPEN_REASON } from '../../shared/config/requestDocument';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function body(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    clientOperationId: OPERATION_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The handoff was started before the visit was ready.',
    ...overrides,
  };
}

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((value) => { res.body = value; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: PROFILE_ID,
    session: { user: { dynamicsSystemuserId: USER_ID } },
  });
  getUserRole.mockResolvedValue('superuser');
  isGuardedReopenSchemaReady.mockReturnValue(true);
  reopenPreSiteVisit.mockResolvedValue({
    artifact: { artifactId: ARTIFACT_ID, operationStatus: 100000001 },
    reused: false,
    recovered: false,
    inProgress: false,
  });
});

test('rejects non-POST methods before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('requires an authenticated superuser with a linked Dynamics identity', async () => {
  getUserRole.mockResolvedValueOnce('staff');
  const nonAdmin = mockRes();
  await handler({ method: 'POST', body: body() }, nonAdmin);
  expect(nonAdmin.statusCode).toBe(403);

  requireAppAccess.mockResolvedValueOnce({
    profileId: PROFILE_ID,
    session: { user: { dynamicsSystemuserId: null } },
  });
  const unlinked = mockRes();
  await handler({ method: 'POST', body: body() }, unlinked);
  expect(unlinked.statusCode).toBe(403);
  expect(reopenPreSiteVisit).not.toHaveBeenCalled();
});

test('rejects missing and unexpected fields before entering DAL context', async () => {
  for (const invalidBody of [
    { ...body(), force: true },
    { ...body(), reasonNote: undefined },
    null,
  ]) {
    if (invalidBody) {
      Object.keys(invalidBody).forEach((key) => {
        if (invalidBody[key] === undefined) delete invalidBody[key];
      });
    }
    const res = mockRes();
    await handler({ method: 'POST', body: invalidBody }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(withDalContext).not.toHaveBeenCalled();
  expect(reopenPreSiteVisit).not.toHaveBeenCalled();
});

test('fails closed before DAL access while Wave 20 readiness is off', async () => {
  isGuardedReopenSchemaReady.mockReturnValueOnce(false);
  const res = mockRes();

  await handler({ method: 'POST', body: body() }, res);

  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({
    error: 'Guarded reopen is unavailable until its Dataverse schema is verified.',
    code: 'pre_site_reopen_schema_not_ready',
  });
  expect(withDalContext).not.toHaveBeenCalled();
  expect(reopenPreSiteVisit).not.toHaveBeenCalled();
});

test('runs guarded reopen in authenticated DAL context with the session actor', async () => {
  const res = mockRes();
  const requestBody = body();
  await handler({ method: 'POST', body: requestBody }, res);

  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'reviewers');
  expect(getUserRole).toHaveBeenCalledWith(PROFILE_ID);
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-reopen', expect.any(Function));
  expect(reopenPreSiteVisit).toHaveBeenCalledWith(requestBody, { actingUserSystemId: USER_ID });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, recovered: false });
});

test('returns 202 for a safely leased in-progress operation', async () => {
  reopenPreSiteVisit.mockResolvedValueOnce({
    artifact: { artifactId: ARTIFACT_ID, operationStatus: 100000000 },
    reused: true,
    inProgress: true,
  });
  const res = mockRes();
  await handler({ method: 'POST', body: body() }, res);
  expect(res.statusCode).toBe(202);
  expect(res.body).toMatchObject({ success: true, inProgress: true });
});

test('preserves governed conflict codes without exposing internal errors', async () => {
  reopenPreSiteVisit.mockRejectedValueOnce(new ServiceHttpError('Reload and retry.', {
    httpStatus: 409,
    code: 'pre_site_reopen_transition_conflict',
    body: { error: 'Reload and retry.', code: 'pre_site_reopen_transition_conflict' },
  }));
  const res = mockRes();
  await handler({ method: 'POST', body: body() }, res);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'Reload and retry.',
    code: 'pre_site_reopen_transition_conflict',
  });
});
