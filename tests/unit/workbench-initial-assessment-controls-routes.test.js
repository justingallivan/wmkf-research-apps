/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  getUserRole: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, callback) => callback()),
}));
jest.mock('../../lib/services/initial-assessment/controls-service', () => ({
  restoreInitialAssessmentVersion: jest.fn(),
  createInitialAssessmentBoardSnapshot: jest.fn(),
}));

import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import {
  createInitialAssessmentBoardSnapshot,
  restoreInitialAssessmentVersion,
} from '../../lib/services/initial-assessment/controls-service';
import restoreHandler from '../../pages/api/workbench/initial-assessment/restore-version';
import snapshotHandler from '../../pages/api/workbench/initial-assessment/board-snapshot';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function responseHarness() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader: jest.fn((name, value) => { res.headers[name] = value; }),
    status: jest.fn((statusCode) => { res.statusCode = statusCode; return res; }),
    json: jest.fn((body) => { res.body = body; return res; }),
  };
  return res;
}

function access() {
  return {
    profileId: 7,
    session: { user: { dynamicsSystemuserId: ACTOR_ID } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue(access());
  getUserRole.mockResolvedValue('superuser');
  restoreInitialAssessmentVersion.mockResolvedValue({ restored: true, artifact: { artifactId: ARTIFACT_ID } });
  createInitialAssessmentBoardSnapshot.mockResolvedValue({ reused: false, snapshot: { artifactId: 'snapshot' } });
});

it('passes exact restore fences and the linked Dynamics actor to the service', async () => {
  const req = {
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      expectedArtifactId: ARTIFACT_ID,
      targetVersionId: '1.0',
      expectedCurrentVersionId: '2.0',
    },
  };
  const res = responseHarness();
  await restoreHandler(req, res);

  expect(res.statusCode).toBe(200);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers');
  expect(restoreInitialAssessmentVersion).toHaveBeenCalledWith(req.body, {
    actingUserSystemId: ACTOR_ID,
  });
});

it('passes exact snapshot fences and the linked Dynamics actor to the service', async () => {
  const req = {
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      expectedArtifactId: ARTIFACT_ID,
      expectedCurrentVersionId: '2.0',
    },
  };
  const res = responseHarness();
  await snapshotHandler(req, res);

  expect(res.statusCode).toBe(200);
  expect(createInitialAssessmentBoardSnapshot).toHaveBeenCalledWith(req.body, {
    actingUserSystemId: ACTOR_ID,
  });
});

it.each([
  ['restore', restoreHandler, {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }],
  ['snapshot', snapshotHandler, {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    expectedCurrentVersionId: '2.0',
  }],
])('refuses a non-superuser before the %s service', async (_name, handler, body) => {
  getUserRole.mockResolvedValue('read_write');
  const res = responseHarness();
  await handler({ method: 'POST', body }, res);

  expect(res.statusCode).toBe(403);
  expect(restoreInitialAssessmentVersion).not.toHaveBeenCalled();
  expect(createInitialAssessmentBoardSnapshot).not.toHaveBeenCalled();
});

it.each([
  [restoreHandler, {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    targetVersionId: '1.0',
    expectedCurrentVersionId: '2.0',
  }],
  [snapshotHandler, {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    expectedCurrentVersionId: '2.0',
  }],
])('requires a linked Dynamics actor for an authenticated write', async (handler, body) => {
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } });
  const res = responseHarness();
  await handler({ method: 'POST', body }, res);

  expect(res.statusCode).toBe(403);
  expect(restoreInitialAssessmentVersion).not.toHaveBeenCalled();
  expect(createInitialAssessmentBoardSnapshot).not.toHaveBeenCalled();
});

it('rejects extra restore fields before calling the service', async () => {
  const res = responseHarness();
  await restoreHandler({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      expectedArtifactId: ARTIFACT_ID,
      targetVersionId: '1.0',
      expectedCurrentVersionId: '2.0',
      driveId: 'caller-controlled',
    },
  }, res);

  expect(res.statusCode).toBe(400);
  expect(restoreInitialAssessmentVersion).not.toHaveBeenCalled();
});

it('rejects non-POST methods without authenticating', async () => {
  const res = responseHarness();
  await snapshotHandler({ method: 'GET', body: {} }, res);

  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});
