/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/site-visit-transition-service', () => ({
  startSiteVisitStage: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { startSiteVisitStage } from '../../lib/services/pre-site-visit/site-visit-transition-service';
import handler from '../../pages/api/workbench/pre-site-visit/start-site-visit';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: { user: { dynamicsSystemuserId: USER_ID } },
  });
  startSiteVisitStage.mockResolvedValue({
    artifact: { artifactId: ARTIFACT_ID, lifecycleState: 100000001 },
    reused: false,
  });
});

test('rejects non-POST methods before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('rejects unexpected or invalid mutation input', async () => {
  for (const body of [
    { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, force: true },
    { requestId: 'not-a-guid', expectedArtifactId: ARTIFACT_ID },
    { requestId: REQUEST_ID },
  ]) {
    const res = mockRes();
    await handler({ method: 'POST', body }, res);
    expect(res.statusCode).toBe(400);
  }
  expect(startSiteVisitStage).not.toHaveBeenCalled();
});

test('runs the transition inside authenticated DAL context with the session actor', async () => {
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
  }, res);

  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('workbench-start-site-visit', expect.any(Function));
  expect(startSiteVisitStage).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: USER_ID,
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true, reused: false });
});

test('maps governed transition errors without losing the machine code', async () => {
  startSiteVisitStage.mockRejectedValueOnce(new ServiceHttpError('Reload and retry.', {
    httpStatus: 409,
    code: 'site_visit_transition_conflict',
    body: { error: 'Reload and retry.', code: 'site_visit_transition_conflict' },
  }));
  const res = mockRes();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
  }, res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'Reload and retry.',
    code: 'site_visit_transition_conflict',
  });
});

