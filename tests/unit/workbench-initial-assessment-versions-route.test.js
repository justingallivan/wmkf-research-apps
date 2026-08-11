/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, callback) => callback()),
}));
jest.mock('../../lib/services/initial-assessment/artifact-service', () => ({
  listInitialAssessmentArtifactVersions: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { listInitialAssessmentArtifactVersions } from '../../lib/services/initial-assessment/artifact-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler from '../../pages/api/workbench/initial-assessment/versions';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-4444-444444444444';

function responseHarness() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader: jest.fn((name, value) => { res.headers[name] = value; }),
    status: jest.fn((statusCode) => {
      res.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((body) => {
      res.body = body;
      return res;
    }),
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: {} } });
  listInitialAssessmentArtifactVersions.mockResolvedValue({
    success: true,
    status: 'current',
    versions: [{ versionId: '2.0', isCurrent: true, lastModifiedBy: 'Justin Gallivan' }],
    hasMore: false,
    limit: 20,
  });
});

it('returns the service version list for a GUID requestId', async () => {
  const res = responseHarness();
  await handler({
    method: 'GET',
    query: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(listInitialAssessmentArtifactVersions).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  });
  expect(res.body.versions[0]).toMatchObject({ versionId: '2.0', isCurrent: true });
});

it('rejects a missing or non-GUID expectedArtifactId before reaching the service', async () => {
  for (const expectedArtifactId of [undefined, "1' or '1'='1"]) {
    const res = responseHarness();
    await handler({
      method: 'GET',
      query: { requestId: REQUEST_ID, ...(expectedArtifactId ? { expectedArtifactId } : {}) },
    }, res);

    expect(res.statusCode).toBe(400);
  }
  expect(listInitialAssessmentArtifactVersions).not.toHaveBeenCalled();
});

it('rejects a non-GUID requestId before reaching the service', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: { requestId: "1' or '1'='1" } }, res);

  expect(res.statusCode).toBe(400);
  expect(listInitialAssessmentArtifactVersions).not.toHaveBeenCalled();
});

it('rejects a missing requestId before reaching the service', async () => {
  const res = responseHarness();
  await handler({ method: 'GET', query: {} }, res);

  expect(res.statusCode).toBe(400);
  expect(listInitialAssessmentArtifactVersions).not.toHaveBeenCalled();
});

it('refuses unauthenticated callers before reaching the service', async () => {
  requireAppAccess.mockResolvedValue(null);
  const res = responseHarness();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);

  expect(listInitialAssessmentArtifactVersions).not.toHaveBeenCalled();
});

it('requires the reviewers app key with the exact request and response objects', async () => {
  const req = {
    method: 'GET',
    query: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
  };
  const res = responseHarness();

  await handler(req, res);

  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
});

it('rejects non-GET methods', async () => {
  const res = responseHarness();
  await handler({ method: 'POST', query: { requestId: REQUEST_ID } }, res);

  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET');
  expect(listInitialAssessmentArtifactVersions).not.toHaveBeenCalled();
});

it('maps a ServiceHttpError to its own status rather than a 500', async () => {
  listInitialAssessmentArtifactVersions.mockRejectedValue(
    new ServiceHttpError('No Ready Initial Assessment artifact exists for this request.', {
      httpStatus: 404,
    }),
  );
  const res = responseHarness();
  await handler({
    method: 'GET',
    query: { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
  }, res);

  expect(res.statusCode).toBe(404);
  expect(listInitialAssessmentArtifactVersions).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  });
});
