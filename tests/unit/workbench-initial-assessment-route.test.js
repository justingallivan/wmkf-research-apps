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
  generateInitialAssessment: jest.fn(),
  listInitialAssessmentArtifacts: jest.fn(),
  listInitialAssessmentCycles: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import {
  generateInitialAssessment,
  listInitialAssessmentArtifacts,
} from '../../lib/services/initial-assessment/artifact-service';
import handler from '../../pages/api/workbench/initial-assessment';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

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
  requireAppAccess.mockResolvedValue({
    session: { user: { dynamicsSystemuserId: '77777777-7777-7777-7777-777777777777' } },
  });
  generateInitialAssessment.mockResolvedValue({
    artifact: { operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY },
    reused: true,
  });
  listInitialAssessmentArtifacts.mockResolvedValue({
    success: true,
    artifacts: [{
      artifactId: '44444444-4444-4444-4444-444444444444',
      file: {
        itemId: 'stable-item',
        versionId: '2.0',
        metadataStatus: 'current',
      },
    }],
    latestAttempts: [],
  });
});

it('returns the service current-metadata status for a request-scoped GET', async () => {
  const res = responseHarness();
  await handler({
    method: 'GET',
    query: { requestId: REQUEST_ID },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(listInitialAssessmentArtifacts).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    cycleCode: null,
  });
  expect(res.body.artifacts[0].file).toMatchObject({
    itemId: 'stable-item',
    versionId: '2.0',
    metadataStatus: 'current',
  });
});

it('rejects unexpected POST keys before calling the producer', async () => {
  const res = responseHarness();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID, force: true },
  }, res);

  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'POST body must contain only requestId' });
  expect(generateInitialAssessment).not.toHaveBeenCalled();
});

it('accepts the closed requestId-only POST contract', async () => {
  const res = responseHarness();
  await handler({
    method: 'POST',
    body: { requestId: REQUEST_ID },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(generateInitialAssessment).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: '77777777-7777-7777-7777-777777777777',
  });
});
