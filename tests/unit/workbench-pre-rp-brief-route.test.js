/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/pre-rp-brief/artifact-service', () => ({
  generatePreRpBrief: jest.fn(),
  getPreRpBriefStatus: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import {
  generatePreRpBrief,
  getPreRpBriefStatus,
} from '../../lib/services/pre-rp-brief/artifact-service';
import handler from '../../pages/api/workbench/pre-rp-brief';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

function post(body = { requestId: REQUEST_ID, clientOperationId: 'op-1' }) {
  return { method: 'POST', body };
}

function get(requestId = REQUEST_ID) {
  return { method: 'GET', query: { requestId } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({
    profileId: '44444444-4444-4444-8444-444444444444',
    session: { user: { dynamicsSystemuserId: '22222222-2222-2222-2222-222222222222' } },
  });
  generatePreRpBrief.mockResolvedValue({
    artifact: {
      artifactId: '33333333-3333-3333-3333-333333333333',
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      file: { webUrl: 'https://sharepoint.test/brief.docx' },
    },
    reused: false,
  });
  getPreRpBriefStatus.mockResolvedValue({ currentArtifact: null, pendingArtifact: null });
});

test('rejects methods other than GET/POST before authentication', async () => {
  const res = mockRes();
  await handler({ method: 'DELETE' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('reads current/pending status without invoking generation', async () => {
  const res = mockRes();
  await handler(get(), res);
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-rp-brief', expect.any(Function));
  expect(getPreRpBriefStatus).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(generatePreRpBrief).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, currentArtifact: null, pendingArtifact: null });
});

test('rejects an invalid GET request id before reading status', async () => {
  const res = mockRes();
  await handler(get('not-a-guid'), res);
  expect(res.statusCode).toBe(400);
  expect(getPreRpBriefStatus).not.toHaveBeenCalled();
});

test('short-circuits an unauthorized caller before generation', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler(post(), mockRes());
  expect(generatePreRpBrief).not.toHaveBeenCalled();
});

test.each([
  [null, 'missing body'],
  [{ requestId: REQUEST_ID, clientOperationId: 'op-1', extra: 'field' }, 'extra field'],
  [{ requestId: 'not-a-guid', clientOperationId: 'op-1' }, 'invalid request id'],
  [{ requestId: REQUEST_ID, clientOperationId: '' }, 'empty clientOperationId'],
])('rejects %s (%s) before generation', async (body) => {
  const res = mockRes();
  await handler(post(body), res);
  expect(res.statusCode).toBe(400);
  expect(generatePreRpBrief).not.toHaveBeenCalled();
});

test('generates through the durable service and returns the governed artifact identity', async () => {
  const res = mockRes();
  await handler(post(), res);
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-rp-brief', expect.any(Function));
  expect(generatePreRpBrief).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    clientOperationId: 'op-1',
    actingUserSystemId: '22222222-2222-2222-2222-222222222222',
  });
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({
    success: true,
    artifact: { operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY },
  });
});

test('returns 202 when generation is still in progress', async () => {
  generatePreRpBrief.mockResolvedValueOnce({
    artifact: { operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING },
    reused: true,
  });
  const res = mockRes();
  await handler(post(), res);
  expect(res.statusCode).toBe(202);
  expect(res.body.success).toBe(true);
});

test('maps governed service errors', async () => {
  generatePreRpBrief.mockRejectedValueOnce(new ServiceHttpError(
    'Add the abstract on the Reviews tab first.',
    { httpStatus: 409, code: 'pre_rp_brief_abstract_missing' },
  ));
  const res = mockRes();
  await handler(post(), res);
  expect(res.statusCode).toBe(409);
  expect(res.body).toEqual({
    error: 'Add the abstract on the Reviews tab first.',
    code: 'pre_rp_brief_abstract_missing',
  });
});
