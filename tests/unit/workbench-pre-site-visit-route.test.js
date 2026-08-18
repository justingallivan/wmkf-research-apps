/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-site-visit/artifact-service', () => ({
  generatePreSiteVisitArtifact: jest.fn(),
  getPreSiteVisitArtifactStatus: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  generatePreSiteVisitArtifact,
  getPreSiteVisitArtifactStatus,
} from '../../lib/services/pre-site-visit/artifact-service';
import handler from '../../pages/api/workbench/pre-site-visit';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function post(body = { requestId: REQUEST_ID }) {
  return { method: 'POST', body };
}

function get(requestId = REQUEST_ID) {
  return { method: 'GET', query: { requestId } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    session: { user: { dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222' } },
  });
  generatePreSiteVisitArtifact.mockResolvedValue({
    artifact: {
      artifactId: '33333333-3333-3333-3333-333333333333',
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      file: {
        name: '1002379 Pre-Site Visit.docx',
        webUrl: 'https://sharepoint.test/pre-site.docx',
      },
    },
    reused: false,
    recovered: false,
  });
  getPreSiteVisitArtifactStatus.mockResolvedValue({
    currentArtifact: null,
    pendingArtifact: null,
  });
});
test('rejects methods other than GET/POST before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);

  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('reads current/pending status without invoking generation', async () => {
  const currentArtifact = {
    artifactId: '33333333-3333-3333-8333-333333333333',
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
  };
  getPreSiteVisitArtifactStatus.mockResolvedValueOnce({
    currentArtifact,
    pendingArtifact: null,
  });
  const res = mockRes();

  await handler(get(), res);

  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit', expect.any(Function));
  expect(getPreSiteVisitArtifactStatus).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, currentArtifact, pendingArtifact: null });
});

test('rejects an invalid GET request id before reading status', async () => {
  const res = mockRes();
  await handler(get('not-a-guid'), res);

  expect(res.statusCode).toBe(400);
  expect(getPreSiteVisitArtifactStatus).not.toHaveBeenCalled();
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test('short-circuits an unauthorized caller before generation', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler(post(), mockRes());

  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test.each([
  [null, 'missing body'],
  [{ requestId: REQUEST_ID, model: 'claude-opus-4-8' }, 'extra model override'],
  [{ requestId: 'not-a-guid' }, 'invalid request id'],
])('rejects %s (%s) before generation', async (body) => {
  const res = mockRes();
  await handler(post(body), res);

  expect(res.statusCode).toBe(400);
  expect(generatePreSiteVisitArtifact).not.toHaveBeenCalled();
});

test('generates through the durable service and returns the governed artifact identity', async () => {
  const res = mockRes();
  await handler(post(), res);

  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit', expect.any(Function));
  expect(generatePreSiteVisitArtifact).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    actingUserSystemId: '22222222-2222-2222-2222-222222222222',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    success: true,
    artifact: {
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      file: { webUrl: 'https://sharepoint.test/pre-site.docx' },
    },
  });
});

test('returns 202 when another owned generation is still active', async () => {
  generatePreSiteVisitArtifact.mockResolvedValueOnce({
    artifact: { operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING },
    reused: true,
    recovered: false,
  });
  const res = mockRes();
  await handler(post(), res);

  expect(res.statusCode).toBe(202);
  expect(res.body.success).toBe(true);
});

test('maps governed service errors', async () => {
  generatePreSiteVisitArtifact.mockRejectedValueOnce(new ServiceHttpError(
    'The governed prompt is unavailable.',
    { httpStatus: 409, code: 'prompt_unavailable' },
  ));
  const res = mockRes();
  await handler(post(), res);

  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'The governed prompt is unavailable.',
    code: 'prompt_unavailable',
  });
});
