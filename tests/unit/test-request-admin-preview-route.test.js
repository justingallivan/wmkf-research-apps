/**
 * @jest-environment node
 */

jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/test-requests/admin-preview-service', () => ({
  buildTestRequestAdminPreview: jest.fn(),
  loadTestRequestPreviewSource: jest.fn(),
}));

import { requireSuperuser } from '../../lib/utils/auth';
import {
  buildTestRequestAdminPreview,
  loadTestRequestPreviewSource,
} from '../../lib/services/test-requests/admin-preview-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import handler, { config } from '../../pages/api/admin/test-requests/preview';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSuperuser.mockResolvedValue({ profileId: 7 });
  loadTestRequestPreviewSource.mockResolvedValue({ success: true, mode: 'read-only' });
  buildTestRequestAdminPreview.mockResolvedValue({ success: true, mode: 'read-only', executionEnabled: false });
});

test('uses a bounded JSON body and accepts only GET or POST', async () => {
  expect(config.api.bodyParser.sizeLimit).toBe('32kb');
  const res = mockRes();
  await handler({ method: 'PUT', query: {}, body: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET, POST');
});

test('non-superusers stop before any preview read', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'GET', query: { sourceRequestNumber: '1002001' } }, mockRes());
  expect(loadTestRequestPreviewSource).not.toHaveBeenCalled();
  expect(buildTestRequestAdminPreview).not.toHaveBeenCalled();
});

test('GET accepts only one supported source Request number', async () => {
  let res = mockRes();
  await handler({ method: 'GET', query: { sourceRequestNumber: '1002001', extra: 'x' } }, res);
  expect(res.statusCode).toBe(400);
  expect(loadTestRequestPreviewSource).not.toHaveBeenCalled();

  res = mockRes();
  await handler({ method: 'GET', query: { sourceRequestNumber: '1002001' } }, res);
  expect(res.statusCode).toBe(200);
  expect(loadTestRequestPreviewSource).toHaveBeenCalledWith({ requestNumber: '1002001' });
});

test('POST forwards only bounded browser choices to the service', async () => {
  const body = {
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: ['opaque-inventory-id'],
    testLabel: 'Fixture preview',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  };
  const res = mockRes();
  await handler({ method: 'POST', query: {}, body }, res);
  expect(res.statusCode).toBe(200);
  expect(buildTestRequestAdminPreview).toHaveBeenCalledWith(body);
});

test('POST rejects extra trusted-state fields and invalid source IDs', async () => {
  const validBody = {
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Fixture preview',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  };
  let res = mockRes();
  await handler({ method: 'POST', query: {}, body: { ...validBody, testOrganizationId: SOURCE_ID } }, res);
  expect(res.statusCode).toBe(400);

  res = mockRes();
  await handler({ method: 'POST', query: {}, body: { ...validBody, sourceRequestId: 'not-a-guid' } }, res);
  expect(res.statusCode).toBe(400);
  expect(buildTestRequestAdminPreview).not.toHaveBeenCalled();
});

test('maps typed service failures without leaking unknown error details', async () => {
  loadTestRequestPreviewSource.mockRejectedValueOnce(new ServiceHttpError('Sandbox required.', {
    httpStatus: 503,
    code: 'sandbox_required',
    body: { error: 'Sandbox required.', code: 'sandbox_required' },
  }));
  let res = mockRes();
  await handler({ method: 'GET', query: { sourceRequestNumber: '1002001' } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body.code).toBe('sandbox_required');

  buildTestRequestAdminPreview.mockRejectedValueOnce(new Error('secret internal detail'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  res = mockRes();
  await handler({
    method: 'POST',
    query: {},
    body: {
      sourceRequestId: SOURCE_ID,
      selectedDocumentIds: [],
      testLabel: 'Fixture preview',
      fiscalYear: 'December 2027',
      meetingDate: '2027-12-03',
    },
  }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body.error).not.toContain('secret internal detail');
  consoleError.mockRestore();
});
